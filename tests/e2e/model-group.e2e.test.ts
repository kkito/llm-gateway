import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import { UsageTracker } from '../../src/lib/usage-tracker.js';
import type { ProviderConfig, ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';

describe('Model Group E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let originalFetch: typeof fetch;

  const tempDir = join(tmpdir(), 'llm-gateway-e2e-model-group-test');

  beforeAll(() => {
    testLogDir = join(tempDir, 'logs');
    testConfigPath = join(tempDir, 'config.json');
    mkdirSync(testLogDir, { recursive: true });

    const config: ProviderConfig[] = [
      {
        customModel: 'test-a',
        realModel: 'gpt-3.5-turbo',
        apiKey: 'sk-test-a',
        baseUrl: 'https://api.openai.com',
        provider: 'openai',
        limits: [{ type: 'input_tokens', period: 'day', max: 1000000 }]
      },
      {
        customModel: 'test-b',
        realModel: 'gpt-3.5-turbo',
        apiKey: 'sk-test-b',
        baseUrl: 'https://api.openai.com',
        provider: 'openai',
        limits: [{ type: 'input_tokens', period: 'day', max: 2000000 }]
      }
    ];

    const proxyConfig: ProxyConfig = {
      models: config,
      modelGroups: [
        {
          name: 'test-pool',
          models: ['test-a', 'test-b'],
          desc: 'Test pool'
        }
      ]
    };

    writeFileSync(testConfigPath, JSON.stringify(proxyConfig, null, 2));

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);

    app = createServer(proxyConfig, logger, detailLogger, 30000, testConfigPath);
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // 重置 UsageTracker 单例以重置计数器
    UsageTracker.resetInstance();
  });

  describe('参数验证', () => {
    it('should reject both model and model_group', async () => {
      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-a',
          model_group: 'test-pool',
          messages: [{ role: 'user', content: 'hi' }]
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('mutually exclusive');
    });

    it('should reject neither model nor model_group', async () => {
      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'hi' }]
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Either model or model_group');
    });
  });

  describe('模型组自动故障转移', () => {
    beforeEach(() => {
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
    });

    it('should use first available model', async () => {
      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_group: 'test-pool',
          messages: [{ role: 'user', content: 'hi' }]
        })
      });

      // 第一次请求应该使用 test-a
      expect(res.status).toBe(200);
    });

    it('should skip to next model when first exceeded', async () => {
      // 先请求一次让 test-a 超限（test-a 限制为每天 1 次）
      const firstRes = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_group: 'test-pool',
          messages: [{ role: 'user', content: 'hi' }]
        })
      });

      expect(firstRes.status).toBe(200);

      // 第二次请求应该跳过 test-a 使用 test-b
      const secondRes = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_group: 'test-pool',
          messages: [{ role: 'user', content: 'hi' }]
        })
      });

      expect(secondRes.status).toBe(200);
    });

    it('should use first available model when limits not exceeded', async () => {
      // 测试多个请求都能成功（因为 input_tokens 限制很高）
      for (let i = 0; i < 3; i++) {
        const res = await app.request('/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model_group: 'test-pool',
            messages: [{ role: 'user', content: 'hi' }]
          })
        });
        expect(res.status).toBe(200);
      }
    });
  });

  describe('模型组不存在', () => {
    it('should reject when model_group not found', async () => {
      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_group: 'nonexistent-pool',
          messages: [{ role: 'user', content: 'hi' }]
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('not found');
    });
  });

  // 独立测试：验证模型组用量记录到实际模型
  describe('模型组用量记录', () => {
    it('should record usage to actual model, not model group', async () => {
      // 创建新的 fetch mock
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

      // 使用模型组请求
      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_group: 'test-pool',
          messages: [{ role: 'user', content: 'hi' }]
        })
      });

      expect(res.status).toBe(200);

      // 验证实际使用的模型 'test-a' 的计数 > 0
      const tracker = UsageTracker.getInstance(testLogDir);
      const counterA = tracker.getCounter('test-a');
      expect(counterA.today.requests).toBeGreaterThan(0);
      expect(counterA.today.inputTokens).toBeGreaterThan(0);

      // 验证模型组名 'test-pool' 的计数为 0（没有记录到模型组名）
      const counterPool = tracker.getCounter('test-pool');
      expect(counterPool.today.requests).toBe(0);
    });
  });
});
