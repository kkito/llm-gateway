import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { userAuthMiddleware, getCurrentUser } from '../../../src/user/middleware/auth.js';

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
