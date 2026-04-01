import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig, ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';

describe('Rate Limit E2E 测试', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    testLogDir = join(tmpdir(), 'test-rate-limit-e2e-' + Date.now());
    testConfigPath = join(testLogDir, 'config.json');

    if (!existsSync(testLogDir)) {
      mkdirSync(testLogDir, { recursive: true });
    }

    // 创建测试模型配置 - 带有限制
    const testModels: ProviderConfig[] = [
      {
        customModel: 'test-limited',
        realModel: 'gpt-4',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai',
        inputPricePer1M: 10.0,
        outputPricePer1M: 30.0,
        cachedPricePer1M: 0,
        limits: [
          { type: 'requests', period: 'day', max: 3 },
          { type: 'input_tokens', period: 'day', max: 5000 },
          { type: 'cost', period: 'month', max: 100 }
        ]
      },
      {
        customModel: 'test-unlimited',
        realModel: 'gpt-3.5-turbo',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai'
      }
    ];

    // 创建测试 ProxyConfig 对象
    const testConfig: ProxyConfig = {
      models: testModels
    };

    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);

    app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    try {
      if (existsSync(testLogDir)) {
        rmSync(testLogDir, { recursive: true, force: true });
      }
    } catch {}
  });

  beforeEach(() => {
    // 清理日志文件以重置计数器
    const files = ['proxy-' + new Date().toISOString().split('T')[0] + '.log'];
    for (const file of files) {
      const filePath = join(testLogDir, file);
      if (existsSync(filePath)) {
        rmSync(filePath);
      }
    }
  });

  describe('请求次数限制', () => {
    it('应该允许在限制内的请求', async () => {
      // Mock fetch 返回成功响应
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: 'test',
              choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
            }),
          clone: function () {
            return this;
          },
          body: null
        })
      ) as any;

      // 发送 3 次请求（限制为 3）
      for (let i = 0; i < 3; i++) {
        const response = await app.request('/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'test-limited',
            messages: [{ role: 'user', content: 'Hello' }]
          })
        });

        expect(response.status).toBe(200);
      }
    });

    it('应该拒绝超过限制的第 4 次请求', async () => {
      // Mock fetch
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: 'test',
              choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
            }),
          clone: function () {
            return this;
          },
          body: null
        })
      ) as any;

      // 先发送 3 次请求
      for (let i = 0; i < 3; i++) {
        await app.request('/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'test-limited',
            messages: [{ role: 'user', content: 'Hello' }]
          })
        });
      }

      // 第 4 次应该被拒绝
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-limited',
          messages: [{ role: 'user', content: 'Hello' }]
        })
      });

      expect(response.status).toBe(429);
      const body = await response.json();
      expect(body.error.message).toContain('Daily request count limit (3) reached');
    });
  });

  describe('无限制模型', () => {
    it('应该允许无限制模型的请求', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: 'test',
              choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
            }),
          clone: function () {
            return this;
          },
          body: null
        })
      ) as any;

      // 发送多次请求都应该成功
      for (let i = 0; i < 10; i++) {
        const response = await app.request('/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'test-unlimited',
            messages: [{ role: 'user', content: 'Hello' }]
          })
        });

        expect(response.status).toBe(200);
      }
    });
  });

  describe('错误响应格式', () => {
    it('应该返回正确的 429 错误格式', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: 'test',
              choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 10000, completion_tokens: 5000, total_tokens: 15000 }
            }),
          clone: function () {
            return this;
          },
          body: null
        })
      ) as any;

      // 发送一次大 token 请求，触发 input_tokens 限制
      await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-limited',
          messages: [{ role: 'user', content: 'Hello' }]
        })
      });

      // 第二次应该触发限制
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-limited',
          messages: [{ role: 'user', content: 'Hello' }]
        })
      });

      expect(response.status).toBe(429);
      const body = await response.json();
      expect(body.error).toBeDefined();
      expect(body.error.type).toBe('rate_limit_error');
      expect(body.error.code).toBe('rate_limit_exceeded');
      expect(body.error.param).toBe(null);
    });
  });
});
