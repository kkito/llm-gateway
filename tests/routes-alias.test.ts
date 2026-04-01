/**
 * 路由 Alias 测试 - 验证多个路径别名都能正常工作
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { ProviderConfig, ProxyConfig } from '../src/config.js';
import type { Logger } from '../src/logger.js';
import type { DetailLogger } from '../src/detail-logger.js';
import { createChatCompletionsRoute } from '../src/routes/chat-completions.js';
import { createMessagesRoute } from '../src/routes/messages.js';

// Mock fetch
global.fetch = vi.fn();

// 简化的 Mock Logger
const mockLogger = { log: () => {} } as unknown as Logger;
const mockDetailLogger = {
  logRequest: () => {},
  logUpstreamRequest: () => {},
  logStreamResponse: () => {},
  logConvertedResponse: () => {}
} as unknown as DetailLogger;

describe('Route Aliases', () => {
  const proxyConfig: ProxyConfig = {
    models: [
      {
        customModel: 'gpt-4',
        realModel: 'gpt-4',
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1'
      }
    ]
  };

  const mockResponse = {
    id: 'chatcmpl-123',
    model: 'gpt-4',
    choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
  };

  beforeEach(() => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
      clone: function() { return this; },
      body: null
    } as any);
  });

  describe('/v1/chat/completions aliases', () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.route('', createChatCompletionsRoute(proxyConfig, mockLogger, mockDetailLogger, 30000, '/tmp'));
    });

    it.each([
      '/v1/chat/completions',
      '/chat/completions',
      '/v1/v1/chat/completions'
    ])('should handle %s', async (path) => {
      const response = await app.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] })
      });

      expect(response.status).toBe(200);
    });
  });

  describe('/v1/messages aliases', () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.route('', createMessagesRoute(proxyConfig, mockLogger, mockDetailLogger, 30000, '/tmp'));
    });

    it.each([
      '/v1/messages',
      '/messages',
      '/v1/v1/messages'
    ])('should handle %s', async (path) => {
      const response = await app.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] })
      });

      expect(response.status).toBe(200);
    });
  });
});
