import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { userAuthMiddleware, getCurrentUser, loginUserSession, userSessions } from '../../../src/user/middleware/auth.js';

// Mock config
vi.mock('../../../src/config.js', () => ({
  loadFullConfig: vi.fn(),
  getConfigPath: vi.fn(() => '/test/config.json')
}));

import { loadFullConfig } from '../../../src/config.js';

describe('userAuthMiddleware', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    vi.clearAllMocks();
  });

  it('should allow access when userApiKeys is not configured', async () => {
    vi.mocked(loadFullConfig).mockReturnValue({ models: [] });
    
    app.use('*', userAuthMiddleware);
    app.get('/test', (c) => c.json({ success: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('should allow access when userApiKeys is empty', async () => {
    vi.mocked(loadFullConfig).mockReturnValue({ models: [], userApiKeys: [] });
    
    app.use('*', userAuthMiddleware);
    app.get('/test', (c) => c.json({ success: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('should reject access when API key is missing', async () => {
    vi.mocked(loadFullConfig).mockReturnValue({
      models: [],
      userApiKeys: [{ name: '用户 A', apikey: 'sk-lg-test12345678901234' }]
    });
    
    app.use('*', userAuthMiddleware);
    app.get('/test', (c) => c.json({ success: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.message).toBe('Missing API Key');
  });

  it('should reject access with invalid API key', async () => {
    vi.mocked(loadFullConfig).mockReturnValue({
      models: [],
      userApiKeys: [{ name: '用户 A', apikey: 'sk-lg-valid12345678901234' }]
    });
    
    app.use('*', userAuthMiddleware);
    app.get('/test', (c) => c.json({ success: true }));

    const res = await app.request('/test', {
      headers: { 'Authorization': 'Bearer sk-lg-invalid' }
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.message).toBe('Invalid API Key');
  });

  it('should allow access with valid API key', async () => {
    vi.mocked(loadFullConfig).mockReturnValue({
      models: [],
      userApiKeys: [{ name: '用户 A', apikey: 'sk-lg-valid12345678901234' }]
    });

    app.use('*', userAuthMiddleware);
    app.get('/test', (c) => c.json({ success: true }));

    const res = await app.request('/test', {
      headers: { 'Authorization': 'Bearer sk-lg-valid12345678901234' }
    });
    expect(res.status).toBe(200);
  });
});

describe('getCurrentUser', () => {
  it('should get user from Authorization header', async () => {
    vi.mocked(loadFullConfig).mockReturnValue({
      models: [],
      userApiKeys: [{ name: '用户 A', apikey: 'sk-lg-valid12345678901234' }]
    });

    let capturedUser: any = null;
    const testApp = new Hono();
    testApp.get('/test', (c) => {
      capturedUser = getCurrentUser(c);
      return c.json({ user: capturedUser });
    });

    await testApp.request('/test', {
      headers: { 'Authorization': 'Bearer sk-lg-valid12345678901234' }
    });
    expect(capturedUser).toEqual({ name: '用户 A', apikey: 'sk-lg-valid12345678901234' });
  });

  it('should get user from x-api-key header', async () => {
    vi.mocked(loadFullConfig).mockReturnValue({
      models: [],
      userApiKeys: [{ name: '用户 A', apikey: 'sk-lg-valid12345678901234' }]
    });

    let capturedUser: any = null;
    const testApp = new Hono();
    testApp.get('/test', (c) => {
      capturedUser = getCurrentUser(c);
      return c.json({ user: capturedUser });
    });

    await testApp.request('/test', {
      headers: { 'x-api-key': 'sk-lg-valid12345678901234' }
    });
    expect(capturedUser).toEqual({ name: '用户 A', apikey: 'sk-lg-valid12345678901234' });
  });

  it('should get user from session', async () => {
    const userApiKey = { name: '用户 A', apikey: 'sk-lg-valid12345678901234' };
    userSessions.clear();
    userSessions.set('test-session-id', userApiKey);
    vi.mocked(loadFullConfig).mockReturnValue({
      models: [],
      userApiKeys: [userApiKey]
    });

    let capturedUser: any = null;
    const testApp = new Hono();
    testApp.get('/test', (c) => {
      capturedUser = getCurrentUser(c);
      return c.json({ user: capturedUser });
    });

    await testApp.request('/test', {
      headers: { 'Cookie': 'user_session=test-session-id' }
    });
    expect(capturedUser).toEqual(userApiKey);
  });

  it('should return null when no auth provided', async () => {
    vi.mocked(loadFullConfig).mockReturnValue({
      models: [],
      userApiKeys: []
    });

    let capturedUser: any = null;
    const testApp = new Hono();
    testApp.get('/test', (c) => {
      capturedUser = getCurrentUser(c);
      return c.json({ user: capturedUser });
    });

    await testApp.request('/test');
    expect(capturedUser).toBeNull();
  });
});

describe('loginUserSession', () => {
  it('should create session for valid API key', () => {
    vi.mocked(loadFullConfig).mockReturnValue({
      models: [],
      userApiKeys: [{ name: '用户 A', apikey: 'sk-lg-valid12345678901234' }]
    });
    const sessionId = loginUserSession('sk-lg-valid12345678901234');
    expect(sessionId).toBeDefined();
    expect(userSessions.has(sessionId!)).toBe(true);
  });

  it('should return null for invalid API key', () => {
    vi.mocked(loadFullConfig).mockReturnValue({
      models: [],
      userApiKeys: [{ name: '用户 A', apikey: 'sk-lg-valid12345678901234' }]
    });
    const sessionId = loginUserSession('sk-lg-invalid');
    expect(sessionId).toBeNull();
  });
});
