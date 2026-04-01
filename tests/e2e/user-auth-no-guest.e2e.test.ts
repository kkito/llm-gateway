import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig, UserApiKey, ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, rmSync, mkdirSync } from 'fs';
import { userSessions } from '../../src/user/middleware/auth.js';

const PORT = 4098;
const BASE_URL = `http://localhost:${PORT}`;

describe('User Auth - No Guest User E2E', () => {
  let testLogDir: string;
  let testConfigPath: string;
  let originalFetch: typeof fetch;

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

  beforeAll(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(createMockOpenAINonStreamResponse('Hello from mock'));
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    userSessions.clear();
  });

  describe('未配置 userApiKeys 时 - 开放访问（无 Guest 用户概念）', () => {
    it('应该允许直接访问 /user/main 而无需登录（不显示 Guest）', async () => {
      // 创建没有配置 userApiKeys 的服务器
      testLogDir = join(tmpdir(), 'test-no-guest-' + Date.now());
      testConfigPath = join(testLogDir, 'config.json');

      // 确保目录存在
      mkdirSync(testLogDir, { recursive: true });

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
      writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const logger = new Logger(testLogDir);
      const detailLogger = new DetailLogger(testLogDir);
      const noAuthApp = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);

      try {
        const response = await noAuthApp.request('/user/main');

        // 应该直接返回 200，而不是重定向到登录页
        expect(response.status).toBe(200);
        
        const html = await response.text();
        
        // 不应该包含 "Guest" 字样
        expect(html).not.toContain('Guest');
        expect(html).not.toContain('guest');
        
        // 应该包含 LLM Gateway 标题
        expect(html).toContain('LLM Gateway');
      } finally {
        rmSync(testLogDir, { recursive: true, force: true });
      }
    });

    it('应该允许直接访问 /user/stats 而无需登录', async () => {
      testLogDir = join(tmpdir(), 'test-no-guest-stats-' + Date.now());
      testConfigPath = join(testLogDir, 'config.json');

      // 确保目录存在
      mkdirSync(testLogDir, { recursive: true });

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
      writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const logger = new Logger(testLogDir);
      const detailLogger = new DetailLogger(testLogDir);
      const noAuthApp = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);

      try {
        const response = await noAuthApp.request('/user/stats');

        // 应该直接返回 200，而不是重定向到登录页
        expect(response.status).toBe(200);
      } finally {
        rmSync(testLogDir, { recursive: true, force: true });
      }
    });

    it('应该允许调用 API 而无需 API Key', async () => {
      testLogDir = join(tmpdir(), 'test-no-guest-api-' + Date.now());
      testConfigPath = join(testLogDir, 'config.json');

      // 确保目录存在
      mkdirSync(testLogDir, { recursive: true });

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
      writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const logger = new Logger(testLogDir);
      const detailLogger = new DetailLogger(testLogDir);
      const noAuthApp = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);

      try {
        const response = await noAuthApp.request('/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'test-openai', messages: [] })
        });
        
        // 不应该返回 401
        expect(response.status).not.toBe(401);
      } finally {
        rmSync(testLogDir, { recursive: true, force: true });
      }
    });
  });

  describe('配置 userApiKeys 后 - 必须登录才能访问', () => {
    let app: Hono;
    const testApiKey = 'sk-lg-test1234567890123456';

    beforeEach(() => {
      testLogDir = join(tmpdir(), 'test-with-auth-' + Date.now());
      testConfigPath = join(testLogDir, 'config.json');

      // 确保目录存在
      mkdirSync(testLogDir, { recursive: true });

      const testModels: ProviderConfig[] = [
        {
          customModel: 'test-openai',
          realModel: 'gpt-4',
          apiKey: 'sk-test-openai-key',
          baseUrl: 'https://api.openai.com/v1',
          provider: 'openai'
        }
      ];

      const testUserApiKeys: UserApiKey[] = [
        { name: '测试用户', apikey: testApiKey }
      ];

      const testConfig: ProxyConfig = {
        models: testModels,
        userApiKeys: testUserApiKeys
      };

      writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const logger = new Logger(testLogDir);
      const detailLogger = new DetailLogger(testLogDir);
      app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);
    });

    afterEach(() => {
      rmSync(testLogDir, { recursive: true, force: true });
    });

    it('应该重定向 /user/main 到登录页（未登录时）', async () => {
      const response = await app.request('/user/main');
      
      // 应该重定向到登录页
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/user/login');
    });

    it('应该重定向 /user/stats 到登录页（未登录时）', async () => {
      const response = await app.request('/user/stats');
      
      // 应该重定向到登录页
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/user/login');
    });

    it('应该返回 401 当调用 API 而无 API Key 时', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test-openai', messages: [] })
      });
      
      expect(response.status).toBe(401);
      const data = await response.json() as any;
      expect(data.error.message).toBe('Missing API Key');
    });

    it('应该允许登录后访问 /user/main', async () => {
      // 先登录
      const loginResponse = await app.request('/user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `apikey=${testApiKey}`
      });

      expect(loginResponse.status).toBe(302);
      const sessionId = loginResponse.headers.get('Set-Cookie')?.match(/user_session=([^;]+)/)?.[1];
      expect(sessionId).toBeTruthy();

      // 使用 Session 访问首页
      const mainResponse = await app.request('/user/main', {
        headers: {
          Cookie: `user_session=${sessionId}`
        }
      });

      expect(mainResponse.status).toBe(200);
      const html = await mainResponse.text();
      
      // 应该显示用户名称，而不是 Guest
      expect(html).toContain('测试用户');
      expect(html).not.toContain('Guest');
    });
  });
});
