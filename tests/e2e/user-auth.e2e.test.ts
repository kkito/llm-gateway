import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig, UserApiKey, ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, rmSync } from 'fs';
import { userSessions } from '../../src/user/middleware/auth.js';

const PORT = 4099;
const BASE_URL = `http://localhost:${PORT}`;

// Mock 上游 API 响应
const createMockOpenAINonStreamResponse = (text: string) => {
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

describe('User Authentication E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let testApiKey: string;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    testLogDir = join(tmpdir(), 'test-user-auth-' + Date.now());
    testConfigPath = join(testLogDir, 'config.json');

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);

    // 创建测试模型配置
    const testModels: ProviderConfig[] = [
      {
        customModel: 'test-openai',
        realModel: 'gpt-4',
        apiKey: 'sk-test-openai-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai'
      }
    ];

    // 创建测试用户 API Keys
    const testUserApiKeys: UserApiKey[] = [
      { name: '测试用户', apikey: 'sk-lg-test1234567890123456' }
    ];

    // 创建测试 ProxyConfig 对象
    const testConfig: ProxyConfig = {
      models: testModels,
      userApiKeys: testUserApiKeys
    };

    // 创建临时配置文件
    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);

    // 设置测试 API Key
    testApiKey = 'sk-lg-test1234567890123456';

    // 保存原始 fetch 并 mock
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(createMockOpenAINonStreamResponse('Hello from mock'));
  });

  afterAll(() => {
    // 恢复原始 fetch
    globalThis.fetch = originalFetch;

    // 清理测试目录
    try {
      rmSync(testLogDir, { recursive: true, force: true });
    } catch (e) {
      // 忽略清理错误
    }
  });

  beforeEach(() => {
    // 清空所有 Session
    userSessions.clear();
    vi.clearAllMocks();
  });

  // 1. 未启用认证时的开放访问
  it('should allow access without auth when userApiKeys is not configured', async () => {
    // 创建没有配置 userApiKeys 的服务器
    const noAuthLogDir = join(tmpdir(), 'test-no-auth-' + Date.now());
    const noAuthConfigPath = join(noAuthLogDir, 'config.json');

    // 确保目录存在
    const { mkdirSync } = await import('fs');
    mkdirSync(noAuthLogDir, { recursive: true });

    const testModels: ProviderConfig[] = [
      {
        customModel: 'test-openai',
        realModel: 'gpt-4',
        apiKey: 'sk-test-openai-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai'
      }
    ];

    const testConfig: ProxyConfig = { models: testModels };
    writeFileSync(noAuthConfigPath, JSON.stringify(testConfig, null, 2));

    const logger = new Logger(noAuthLogDir);
    const detailLogger = new DetailLogger(noAuthLogDir);
    const noAuthApp = createServer(testConfig, logger, detailLogger, 30000, noAuthConfigPath);

    try {
      const response = await noAuthApp.request('/user/main');
      expect(response.status).toBe(200);
    } finally {
      rmSync(noAuthLogDir, { recursive: true, force: true });
    }
  });

  // 2. 启用认证后的访问控制
  it('should require API key when userApiKeys is configured', async () => {
    const response = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test-openai', messages: [] })
    });
    expect(response.status).toBe(401);
    const data = await response.json() as any;
    expect(data.error.message).toBe('Missing API Key');
  });

  // 3. API Key 登录流程
  it('should login with valid API key', async () => {
    const response = await app.request('/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `apikey=${testApiKey}`
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/user/main');
    
    // 检查是否设置了 Session Cookie
    const setCookie = response.headers.get('Set-Cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('user_session=');
  });

  // 4. 无效 API Key 登录失败
  it('should reject login with invalid API key', async () => {
    const response = await app.request('/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'apikey=invalid-api-key'
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('无效的 API Key');
  });

  // 5. 用户统计页面访问 - 未登录重定向
  it('should redirect to login when accessing stats page without auth', async () => {
    const response = await app.request('/user/stats');
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/user/login');
  });

  // 6. 用户统计页面访问 - 登录后可访问
  it('should access stats page only when logged in', async () => {
    // 先登录获取 Session
    const loginResponse = await app.request('/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `apikey=${testApiKey}`
    });
    
    const sessionId = loginResponse.headers.get('Set-Cookie')?.match(/user_session=([^;]+)/)?.[1];
    expect(sessionId).toBeTruthy();

    // 使用 Session Cookie 访问统计页面
    const statsResponse = await app.request('/user/stats', {
      headers: {
        Cookie: `user_session=${sessionId}`
      }
    });
    
    expect(statsResponse.status).toBe(200);
    const html = await statsResponse.text();
    expect(html).toContain('使用统计');
  });

  // 7. API 调用认证 - 有效 API Key
  it('should call API with valid API key', async () => {
    const response = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${testApiKey}`
      },
      body: JSON.stringify({ model: 'test-openai', messages: [{ role: 'user', content: 'Hello' }] })
    });
    // 应通过认证（可能因模型配置返回其他错误，但不应该是 401）
    expect(response.status).not.toBe(401);
  });

  // 8. API 调用认证 - 无效 API Key
  it('should reject API call with invalid API key', async () => {
    const response = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid-api-key'
      },
      body: JSON.stringify({ model: 'test-openai', messages: [] })
    });
    expect(response.status).toBe(401);
    const data = await response.json() as any;
    expect(data.error.message).toBe('Invalid API Key');
  });

  // 9. 登录页面访问
  it('should allow access to login page without auth', async () => {
    const response = await app.request('/user/login');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('用户登录');
  });

  // 10. 用户首页访问 - 已登录
  it('should access user main page when logged in', async () => {
    // 先登录获取 Session
    const loginResponse = await app.request('/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `apikey=${testApiKey}`
    });
    
    const sessionId = loginResponse.headers.get('Set-Cookie')?.match(/user_session=([^;]+)/)?.[1];
    expect(sessionId).toBeTruthy();

    // 使用 Session Cookie 访问用户首页
    const mainResponse = await app.request('/user/main', {
      headers: {
        Cookie: `user_session=${sessionId}`
      }
    });
    
    expect(mainResponse.status).toBe(200);
    const html = await mainResponse.text();
    expect(html).toContain('LLM Gateway');
  });

  // 11. 登出功能
  it('should logout and clear session', async () => {
    // 先登录获取 Session
    const loginResponse = await app.request('/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `apikey=${testApiKey}`
    });
    
    const sessionId = loginResponse.headers.get('Set-Cookie')?.match(/user_session=([^;]+)/)?.[1];
    expect(sessionId).toBeTruthy();

    // 验证 Session 存在
    expect(userSessions.has(sessionId!)).toBe(true);

    // 登出
    const logoutResponse = await app.request('/user/logout', {
      headers: {
        Cookie: `user_session=${sessionId}`
      }
    });
    
    expect(logoutResponse.status).toBe(302);
    expect(logoutResponse.headers.get('Location')).toBe('/user/login');
    
    // 验证 Session 已被清除
    expect(userSessions.has(sessionId!)).toBe(false);
    
    // 验证 Cookie 已被清除
    const setCookie = logoutResponse.headers.get('Set-Cookie');
    expect(setCookie).toContain('user_session=;');
  });

  // 12. 使用 x-api-key header 认证
  it('should authenticate with x-api-key header', async () => {
    const response = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': testApiKey
      },
      body: JSON.stringify({ model: 'test-openai', messages: [{ role: 'user', content: 'Hello' }] })
    });
    expect(response.status).not.toBe(401);
  });

  // 13. 空 API Key 登录失败
  it('should reject login with empty API key', async () => {
    const response = await app.request('/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'apikey='
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('请输入 API Key');
  });
});
