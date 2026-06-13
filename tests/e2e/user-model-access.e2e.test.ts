import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig, UserApiKey, ProxyConfig, ModelGroup } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, rmSync, mkdirSync, readFileSync } from 'fs';
import { sessions } from '../../src/admin/middleware/auth.js';
import { userSessions } from '../../src/user/middleware/auth.js';

const ADMIN_PASSWORD = 'admin123';

describe('User Model Access E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let adminSessionCookie: string;
  let originalFetch: typeof fetch;

  const createMockResponse = (text: string) => {
    return new Response(JSON.stringify({
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  beforeAll(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse('Hello from mock'));
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(async () => {
    sessions.clear();
    userSessions.clear();

    testLogDir = join(tmpdir(), 'test-model-access-' + Date.now());
    testConfigPath = join(testLogDir, 'config.json');

    mkdirSync(testLogDir, { recursive: true });

    const testModels: ProviderConfig[] = [
      {
        customModel: 'gpt-4',
        realModel: 'gpt-4',
        apiKey: 'sk-test-openai',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai'
      },
      {
        customModel: 'claude-3',
        realModel: 'claude-3-opus',
        apiKey: 'sk-test-anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        provider: 'anthropic'
      },
    ];

    const testModelGroups: ModelGroup[] = [
      { name: 'all-models', models: ['gpt-4', 'claude-3'] }
    ];

    const testConfig: ProxyConfig = {
      models: testModels,
      modelGroups: testModelGroups,
      adminPassword: '946ef222d5a6fafae845a03be3b747667c15d97d7fbe8fade1b150809fff144d',
      userApiKeys: [
        { name: '受限用户', apikey: 'sk-lg-restricted1234567', allowedModels: ['gpt-4'] },
        { name: '无限用户', apikey: 'sk-lg-unlimited12345678' },
      ]
    };

    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);
    app = createServer(testConfig, logger, detailLogger, 30000, testLogDir);

    const loginResponse = await app.request('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=admin123'
    });
    adminSessionCookie = loginResponse.headers.get('Set-Cookie') || '';
  });

  afterEach(() => {
    rmSync(testLogDir, { recursive: true, force: true });
  });

  it('should allow access to model in allowedModels', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-lg-restricted1234567'
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hello' }]
      })
    });
    expect(res.status).toBe(200);
  });

  it('should deny access to model not in allowedModels with 403', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-lg-restricted1234567'
      },
      body: JSON.stringify({
        model: 'claude-3',
        messages: [{ role: 'user', content: 'hello' }]
      })
    });
    expect(res.status).toBe(403);
    const data = await res.json() as any;
    expect(data.error.type).toBe('permission_error');
  });

  it('should allow unlimited user to access any model', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-lg-unlimited12345678'
      },
      body: JSON.stringify({
        model: 'claude-3',
        messages: [{ role: 'user', content: 'hello' }]
      })
    });
    expect(res.status).toBe(200);
  });

  it('should handle model_group requests without restriction', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-lg-restricted1234567'
      },
      body: JSON.stringify({
        model_group: 'all-models',
        messages: [{ role: 'user', content: 'hello' }]
      })
    });
    expect(res.status).toBe(200);
  });

  it('should not find any models on user home page when user has no matching models', async () => {
    const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
    config.userApiKeys!.push({
      name: '无匹配用户',
      apikey: 'sk-lg-nomatch1234567890',
      allowedModels: ['nonexistent-model']
    });
    writeFileSync(testConfigPath, JSON.stringify(config, null, 2));

    const loginRes = await app.request('/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'apikey=sk-lg-nomatch1234567890'
    });
    const cookie = loginRes.headers.get('Set-Cookie') || '';

    const homeRes = await app.request('/user/main', {
      headers: { 'Cookie': cookie }
    });
    const html = await homeRes.text();
    expect(homeRes.status).toBe(200);
    expect(html).not.toContain('gpt-4');
    expect(html).not.toContain('claude-3');
  });
});
