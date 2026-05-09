import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { createServer, resetServerGlobalState } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig, ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { UsageTracker } from '../../src/lib/usage-tracker.js';

describe('Default Params E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    // 重置全局状态，确保测试环境干净
    resetServerGlobalState();
    UsageTracker.resetInstance();
    
    testLogDir = join(tmpdir(), 'test-e2e-default-params-' + Date.now());
    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);

    // 创建测试模型配置 - 使用 defaultParams
    const testModels: ProviderConfig[] = [
      {
        customModel: 'test-gpt',
        realModel: 'gpt-4',
        apiKey: 'sk-test-openai-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai',
        defaultParams: { temperature: 0.5, max_tokens: 2048 }
      },
      {
        customModel: 'test-claude',
        realModel: 'claude-sonnet-4-20250514',
        apiKey: 'sk-ant-test-key',
        baseUrl: 'https://api.anthropic.com/v1',
        provider: 'anthropic',
        defaultParams: {
          temperature: 0.7,
          extra_body: { thinking: { type: 'disabled' }, top_k: 50 }
        }
      }
    ];

    const testConfig: ProxyConfig = { models: testModels };
    app = createServer(testConfig, logger, detailLogger, 30000);

    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  describe('OpenAI route - defaultParams merging', () => {
    it('should merge defaultParams with user request params (user wins)', async () => {
      let capturedBody: any;

      globalThis.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (options?.body) {
          capturedBody = JSON.parse(options.body as string);
        }
        return new Response(JSON.stringify({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Hello' },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      });

      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-test-openai-key'
        },
        body: JSON.stringify({
          model: 'test-gpt',
          messages: [{ role: 'user', content: 'Hello' }],
          temperature: 0.8,  // 用户参数应覆盖默认值
          stream: false
        })
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.choices[0].message.content).toBe('Hello');

      // 验证参数合并：用户参数优先级更高
      expect(capturedBody.temperature).toBe(0.8);  // 用户值
      expect(capturedBody.max_tokens).toBe(2048);   // 默认值保留
    });

    it('should use defaultParams when user does not provide params', async () => {
      let capturedBody: any;

      globalThis.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (options?.body) {
          capturedBody = JSON.parse(options.body as string);
        }
        return new Response(JSON.stringify({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      });

      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-test-openai-key'
        },
        body: JSON.stringify({
          model: 'test-gpt',
          messages: [{ role: 'user', content: 'Hi' }],
          stream: false
        })
      });

      expect(response.status).toBe(200);

      // 验证默认参数被应用
      expect(capturedBody.temperature).toBe(0.5);
      expect(capturedBody.max_tokens).toBe(2048);
    });
  });

  describe('Anthropic route - defaultParams merging', () => {
    it('should deeply merge extra_body in defaultParams (user wins)', async () => {
      let capturedBody: any;

      globalThis.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (options?.body) {
          capturedBody = JSON.parse(options.body as string);
        }
        return new Response(JSON.stringify({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 10 }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      });

      const response = await app.request('/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'sk-ant-test-key'
        },
        body: JSON.stringify({
          model: 'test-claude',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 4096,
          extra_body: { thinking: { type: 'enabled' } }  // 应覆盖默认的 disabled
        })
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.content[0].text).toBe('Hello');

      // 验证深度合并：用户参数覆盖默认，但保留其他默认值
      expect(capturedBody.extra_body.thinking.type).toBe('enabled');  // 用户值
      expect(capturedBody.extra_body.top_k).toBe(50);                  // 保留默认值
      expect(capturedBody.max_tokens).toBe(4096);                      // 用户值
    });

    it('should use defaultParams extra_body when user does not provide extra_body', async () => {
      let capturedBody: any;

      globalThis.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (options?.body) {
          capturedBody = JSON.parse(options.body as string);
        }
        return new Response(JSON.stringify({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 5 }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      });

      const response = await app.request('/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'sk-ant-test-key'
        },
        body: JSON.stringify({
          model: 'test-claude',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 2048
        })
      });

      expect(response.status).toBe(200);

      // 验证默认 extra_body 被应用
      expect(capturedBody.extra_body.thinking.type).toBe('disabled');
      expect(capturedBody.extra_body.top_k).toBe(50);
      expect(capturedBody.temperature).toBe(0.7);
    });
  });

  describe('Error handling', () => {
    it('should return 404 for unknown model', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-test-openai-key'
        },
        body: JSON.stringify({
          model: 'unknown-model',
          messages: [{ role: 'user', content: 'Hello' }]
        })
      });

      expect(response.status).toBe(404);
      const json = await response.json() as any;
      expect(json.error.message).toBe('Model not found');
    });
  });
});
