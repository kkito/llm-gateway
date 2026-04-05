/**
 * 路由测试 - 测试 Proxy 路由的 SSE 流式处理
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

  it('should handle streaming request to Anthropic provider with SSE conversion', async () => {
    // 模拟 Anthropic SSE 流式响应
    const anthropicSSEChunks = [
      'event: message_start\ndata: {"type": "message_start", "message": {"id": "msg_123", "role": "assistant", "usage": {"input_tokens": 10, "output_tokens": 0}}}\n\n',
      'event: content_block_start\ndata: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}\n\n',
      'event: content_block_delta\ndata: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hello"}}\n\n',
      'event: content_block_delta\ndata: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "!"}}\n\n',
      'event: content_block_stop\ndata: {"type": "content_block_stop", "index": 0}\n\n',
      'event: message_delta\ndata: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"input_tokens": 10, "output_tokens": 20}}\n\n',
      'event: message_stop\ndata: {"type": "message_stop"}\n\n'
    ];

    // 创建 ReadableStream 模拟流式响应
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of anthropicSSEChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      }
    });

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
      clone: function() { return this; }
    } as any);

    const response = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-3-sonnet',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1024,
        stream: true
      })
    });

    expect(response.status).toBe(200);
    
    // 读取流式响应
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const receivedChunks: string[] = [];
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedChunks.push(decoder.decode(value));
    }
    
    // 验证接收到的 chunk 是 OpenAI 格式
    expect(receivedChunks.length).toBeGreaterThan(0);
    const firstChunk = receivedChunks[0];
    expect(firstChunk).toContain('data:');
    expect(firstChunk).toContain('"delta"');
  });

  it('should handle tool_use streaming from Anthropic', async () => {
    const anthropicSSEChunks = [
      'event: message_start\ndata: {"type": "message_start", "message": {"id": "msg_123", "role": "assistant", "usage": {"input_tokens": 10, "output_tokens": 0}}}\n\n',
      'event: content_block_start\ndata: {"type": "content_block_start", "index": 0, "content_block": {"type": "tool_use", "id": "toolu_123", "name": "get_weather", "input": {}}}\n\n',
      'event: content_block_delta\ndata: {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": "{\\"location\\":"}}\n\n',
      'event: content_block_delta\ndata: {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": " \\"Tokyo\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type": "content_block_stop", "index": 0}\n\n',
      'event: message_delta\ndata: {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"input_tokens": 10, "output_tokens": 20}}\n\n',
      'event: message_stop\ndata: {"type": "message_stop"}\n\n'
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of anthropicSSEChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      }
    });

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
      clone: function() { return this; }
    } as any);

    const response = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-3-sonnet',
        messages: [{ role: 'user', content: 'Weather in Tokyo?' }],
        max_tokens: 1024,
        stream: true,
        tools: [{
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: { location: { type: 'string' } } }
          }
        }]
      })
    });

    expect(response.status).toBe(200);
    
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const receivedChunks: string[] = [];
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedChunks.push(decoder.decode(value));
    }
    
    // 验证包含 tool_calls
    const allContent = receivedChunks.join('');
    expect(allContent).toContain('tool_calls');
    expect(allContent).toContain('get_weather');
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

  it('should handle streaming request to OpenAI provider with SSE conversion', async () => {
    // 模拟 OpenAI SSE 流式响应
    const openAISSEChunks = [
      'data: {"id": "chatcmpl-123", "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": null}]}\n\n',
      'data: {"id": "chatcmpl-123", "choices": [{"index": 0, "delta": {"content": "Hello"}, "finish_reason": null}]}\n\n',
      'data: {"id": "chatcmpl-123", "choices": [{"index": 0, "delta": {"content": "!"}, "finish_reason": null}]}\n\n',
      'data: {"id": "chatcmpl-123", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 10, "completion_tokens": 20}}\n\n',
      'data: [DONE]\n\n'
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of openAISSEChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      }
    });

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
      clone: function() { return this; }
    } as any);

    const response = await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1024,
        stream: true
      })
    });

    expect(response.status).toBe(200);
    
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const receivedChunks: string[] = [];
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedChunks.push(decoder.decode(value));
    }
    
    // 验证接收到的 chunk 是 Anthropic 格式（包含 event 和 type）
    expect(receivedChunks.length).toBeGreaterThan(0);
    const allContent = receivedChunks.join('');
    expect(allContent).toContain('event:');
    expect(allContent).toContain('"type":');
  });

  it('should handle tool_calls streaming from OpenAI', async () => {
    const openAISSEChunks = [
      'data: {"id": "chatcmpl-123", "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": null}]}\n\n',
      'data: {"id": "chatcmpl-123", "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "id": "call_123", "type": "function", "function": {"name": "get_weather", "arguments": "{\\"loc"}}]}, "finish_reason": null}]}\n\n',
      'data: {"id": "chatcmpl-123", "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "id": "call_123", "type": "function", "function": {"name": "get_weather", "arguments": "ation\\": \\"Tokyo\\"}"}}]}, "finish_reason": null}]}\n\n',
      'data: {"id": "chatcmpl-123", "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}], "usage": {"prompt_tokens": 10, "completion_tokens": 20}}\n\n',
      'data: [DONE]\n\n'
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of openAISSEChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      }
    });

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
      clone: function() { return this; }
    } as any);

    const response = await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-4',
        messages: [{ role: 'user', content: 'Weather in Tokyo?' }],
        max_tokens: 1024,
        stream: true
      })
    });

    expect(response.status).toBe(200);
    
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const receivedChunks: string[] = [];
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedChunks.push(decoder.decode(value));
    }
    
    // 验证包含 tool_use
    const allContent = receivedChunks.join('');
    expect(allContent).toContain('tool_use');
    expect(allContent).toContain('get_weather');
  });
});
