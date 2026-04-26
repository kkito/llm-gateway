import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig, ApiKey, ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, rmSync } from 'fs';

describe('Admin Model Test E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    testLogDir = join(tmpdir(), 'test-model-test-' + Date.now());
    testConfigPath = join(testLogDir, 'config.json');

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);

    const testModels: ProviderConfig[] = [
      {
        customModel: 'test-gpt4',
        realModel: 'gpt-4',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai',
      },
    ];

    const testApiKeys: ApiKey[] = [
      {
        id: 'key-1',
        name: 'OpenAI Key',
        key: 'sk-resolved-key-123',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
    ];

    const testConfig: ProxyConfig = {
      models: testModels,
      apiKeys: testApiKeys,
    };

    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    rmSync(testLogDir, { recursive: true, force: true });
  });

  describe('POST /admin/models/test', () => {
    it('should reject when required fields are missing', async () => {
      const response = await app.request('/admin/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain('必填字段');
    });

    it('should reject when API Key is not provided and model has no saved config', async () => {
      // realModel 不匹配任何已保存的模型，所以兜底也找不到
      const response = await app.request('/admin/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          realModel: 'brand-new-model',
          message: '你好',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain('API Key');
    });

    it('should accept manual apiKey and return successful response', async () => {
      globalThis.fetch = async (url: string | URL, init?: RequestInit) => {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              model: 'gpt-4',
              choices: [{ message: { content: '你好，我是一个 AI 助手。' } }],
              usage: { prompt_tokens: 10, completion_tokens: 20 },
            }),
        } as Response;
      };

      const response = await app.request('/admin/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-manual-key',
          realModel: 'gpt-4',
          message: '你好',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.model).toBe('gpt-4');
      expect(data.content).toBe('你好，我是一个 AI 助手。');
      expect(data.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20 });
    });

    it('should resolve apiKeyId from config when apiKey is not provided', async () => {
      globalThis.fetch = async (url: string | URL, init?: RequestInit) => {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              model: 'gpt-4',
              choices: [{ message: { content: 'Resolved key works.' } }],
            }),
        } as Response;
      };

      const response = await app.request('/admin/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKeyId: 'key-1',
          realModel: 'gpt-4',
          message: '测试',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.content).toBe('Resolved key works.');
    });

    it('should reject when apiKeyId does not exist in config', async () => {
      const response = await app.request('/admin/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKeyId: 'nonexistent-key',
          realModel: 'nonexistent-model',
          message: '测试',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain('API Key');
    });

    it('should fallback to saved model config when apiKey is not provided', async () => {
      // 测试已有的 test-gpt4 模型，它的 apiKey 是 'sk-test-key'
      globalThis.fetch = async (url: string | URL, init?: RequestInit) => {
        // 验证使用的 API Key 是从模型配置中读取的
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers['Authorization']).toContain('sk-test-key');
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              model: 'gpt-4',
              choices: [{ message: { content: 'From saved config.' } }],
            }),
        } as Response;
      };

      const response = await app.request('/admin/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          realModel: 'gpt-4',
          message: '测试',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.content).toBe('From saved config.');
    });

    it('should handle HTTP error from upstream API', async () => {
      globalThis.fetch = async (url: string | URL, init?: RequestInit) => {
        return {
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }),
        } as Response;
      };

      const response = await app.request('/admin/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'invalid-key',
          realModel: 'gpt-4',
          message: '你好',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain('401');
      expect(data.rawResponse).toContain('Invalid API key');
    });

    it('should handle network errors', async () => {
      globalThis.fetch = async (url: string | URL, init?: RequestInit) => {
        throw new Error('fetch failed');
      };

      const response = await app.request('/admin/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test-key',
          realModel: 'gpt-4',
          message: '你好',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain('网络错误');
    });

    it('should handle timeout errors', async () => {
      globalThis.fetch = async (url: string | URL, init?: RequestInit) => {
        const error = new Error('timeout');
        error.name = 'AbortError';
        throw error;
      };

      const response = await app.request('/admin/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test-key',
          realModel: 'gpt-4',
          message: '你好',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain('请求超时');
    });
  });
});
