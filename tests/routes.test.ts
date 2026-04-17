/**
 * 路由测试 - 测试 Proxy 路由的非流式处理
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { ProviderConfig, ProxyConfig } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { DetailLogger } from '../src/detail-logger.js';
import { createChatCompletionsRoute } from '../src/routes/chat-completions/index.js';
import { createMessagesRoute } from '../src/routes/messages/index.js';

// Mock fetch
global.fetch = vi.fn();

// ==================== Mock 工具类 ====================

class MockLogger {
  log(entry: any) {
    // no-op
  }
}

class MockDetailLogger {
  logRequest(id: string, body: any) {
    // no-op
  }

  logUpstreamRequest(id: string, body: any) {
    // no-op
  }

  logStreamResponse(id: string, chunks: string[]) {
    // no-op
  }

  logConvertedResponse(id: string, response: any) {
    // no-op
  }
}

// ==================== /v1/chat/completions 路由测试 ====================

describe('createChatCompletionsRoute', () => {
  let app: Hono;
  const proxyConfig: ProxyConfig = {
    models: [
      {
        customModel: 'anthropic/claude-3-sonnet',
        realModel: 'claude-3-sonnet-20240229',
        provider: 'anthropic',
        apiKey: 'test-key',
        baseUrl: 'https://api.anthropic.com'
      },
      {
        customModel: 'openai/gpt-4',
        realModel: 'gpt-4',
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1'
      }
    ]
  };

  beforeEach(() => {
    app = new Hono();
    const logger = new MockLogger() as unknown as Logger;
    const detailLogger = new MockDetailLogger() as unknown as DetailLogger;

    app.route('', createChatCompletionsRoute(proxyConfig, logger, detailLogger, 30000, '/tmp'));
  });

  it('should handle non-streaming request to Anthropic provider', async () => {
    const mockAnthropicResponse = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-3-sonnet-20240229',
      content: [{ type: 'text', text: 'Hello!' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 20
      }
    };

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockAnthropicResponse,
      clone: function() {
        return {
          json: async () => mockAnthropicResponse,
          body: new ReadableStream({
            start(controller) {
              controller.close();
            }
          })
        };
      },
      body: new ReadableStream({
        start(controller) {
          controller.close();
        }
      })
    } as any);

    const response = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-3-sonnet',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1024,
        stream: false
      })
    });

    expect(response.status).toBe(200);
    const data = await response.json() as any;
    expect(data.choices[0].message.content).toBe('Hello!');
    expect(data.usage.prompt_tokens).toBe(10);
  });
});

// ==================== /v1/messages 路由测试 ====================

describe('createMessagesRoute', () => {
  let app: Hono;
  const proxyConfig: ProxyConfig = {
    models: [
      {
        customModel: 'anthropic/claude-3-sonnet',
        realModel: 'claude-3-sonnet-20240229',
        provider: 'anthropic',
        apiKey: 'test-key',
        baseUrl: 'https://api.anthropic.com'
      },
      {
        customModel: 'openai/gpt-4',
        realModel: 'gpt-4',
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1'
      }
    ]
  };

  beforeEach(() => {
    app = new Hono();
    const logger = new MockLogger() as unknown as Logger;
    const detailLogger = new MockDetailLogger() as unknown as DetailLogger;

    app.route('', createMessagesRoute(proxyConfig, logger, detailLogger, 30000, '/tmp'));
  });

  it('should handle non-streaming request to OpenAI provider', async () => {
    const mockOpenAIResponse = {
      id: 'chatcmpl-123',
      model: 'gpt-4',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Hello!'
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30
      }
    };

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockOpenAIResponse,
      clone: function() { return this; },
      body: null
    } as any);

    const response = await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1024,
        stream: false
      })
    });

    expect(response.status).toBe(200);
    const data = await response.json() as any;
    expect(data.content).toEqual([{ type: 'text', text: 'Hello!' }]);
    expect(data.usage.input_tokens).toBe(10);
  });
});
