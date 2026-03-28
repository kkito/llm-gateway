/**
 * SSE 流式透传测试 - 测试格式一致时的 SSE 直接透传逻辑
 * 
 * 场景：当请求格式与 Provider 格式一致时，SSE 应该直接透传，不做转换
 * 例如：Anthropic 请求 → Anthropic Provider，OpenAI 请求 → OpenAI Provider
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { ProviderConfig } from '../../src/config.js';
import type { Logger } from '../../src/logger.js';
import type { DetailLogger } from '../../src/detail-logger.js';
import { createChatCompletionsRoute } from '../../src/routes/chat-completions.js';
import { createMessagesRoute } from '../../src/routes/messages.js';

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

// ==================== OpenAI → OpenAI 透传测试 ====================

describe('SSE 透传 - OpenAI 请求到 OpenAI Provider', () => {
  let app: Hono;
  const config: ProviderConfig[] = [
    {
      customModel: 'openai/gpt-4',
      realModel: 'gpt-4',
      provider: 'openai',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1'
    }
  ];

  beforeEach(() => {
    app = new Hono();
    const logger = new MockLogger() as unknown as Logger;
    const detailLogger = new MockDetailLogger() as unknown as DetailLogger;

    app.route('', createChatCompletionsRoute(config, logger, detailLogger, 30000));
  });

  it('应直接透传 OpenAI SSE 格式，不做转换', async () => {
    // 模拟上游返回的原始 OpenAI SSE 响应
    const originalOpenAISSEChunks = [
      'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"content":"你"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"content":"好"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"content":"！"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20}}\n\n',
      'data: [DONE]\n\n'
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of originalOpenAISSEChunks) {
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
        model: 'openai/gpt-4',
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

    // 验证：SSE 被正确透传，每个 chunk 都保持 OpenAI 格式
    expect(receivedChunks.length).toBeGreaterThan(0);
    
    // 验证每个 chunk 都包含 SSE 结束符 \n\n
    for (const chunk of receivedChunks) {
      expect(chunk).toMatch(/\n\n$/);
    }

    // 验证内容格式
    const allContent = receivedChunks.join('');
    expect(allContent).toContain('data:');
    expect(allContent).toContain('"delta"');
    expect(allContent).toContain('"choices"');
    
    // 验证增量内容正确传递（不应该堆叠）
    expect(allContent).toContain('"content":"你"');
    expect(allContent).toContain('"content":"好"');
    expect(allContent).toContain('"content":"！"');
  });

  it('应确保每个 SSE chunk 都以双换行符结尾', async () => {
    // 模拟上游返回的 chunk 可能不带 \n\n
    const upstreamChunks = [
      'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"role":"assistant"}}]}',
      'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"content":"测试"}}]}',
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of upstreamChunks) {
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
        model: 'openai/gpt-4',
        messages: [{ role: 'user', content: 'Test' }],
        stream: true
      })
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const receivedChunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedChunks.push(decoder.decode(value));
    }

    // 验证：即使上游 chunk 没有 \n\n，输出也应该有
    for (const chunk of receivedChunks) {
      expect(chunk).toMatch(/\n\n$/);
    }
  });
});

// ==================== Anthropic → Anthropic 透传测试 ====================

describe('SSE 透传 - Anthropic 请求到 Anthropic Provider', () => {
  let app: Hono;
  const config: ProviderConfig[] = [
    {
      customModel: 'anthropic/claude-3-sonnet',
      realModel: 'claude-3-sonnet-20240229',
      provider: 'anthropic',
      apiKey: 'test-key',
      baseUrl: 'https://api.anthropic.com'
    }
  ];

  beforeEach(() => {
    app = new Hono();
    const logger = new MockLogger() as unknown as Logger;
    const detailLogger = new MockDetailLogger() as unknown as DetailLogger;

    app.route('', createMessagesRoute(config, logger, detailLogger, 30000));
  });

  it('应直接透传 Anthropic SSE 格式，不做转换', async () => {
    // 模拟上游返回的原始字节流（注意：不带 \n\n，因为 TCP 流是按字节传输的）
    // split('\n\n') 会分割并移除分隔符，代码需要重新添加 \n\n
    const rawUpstreamChunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","role":"assistant","usage":{"input_tokens":10,"output_tokens":0}}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你"}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":10,"output_tokens":20}}',
      'event: message_stop\ndata: {"type":"message_stop"}'
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of rawUpstreamChunks) {
          // 模拟真实网络：每个 SSE 事件以 \n\n 结尾
          controller.enqueue(new TextEncoder().encode(chunk + '\n\n'));
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

    // 验证：SSE 被正确透传，每个 chunk 都保持 Anthropic 格式
    expect(receivedChunks.length).toBeGreaterThan(0);
    
    // 关键验证：每个输出 chunk 都必须以 \n\n 结尾（这是代码添加的）
    for (const chunk of receivedChunks) {
      expect(chunk).toMatch(/\n\n$/);
    }

    // 验证内容格式
    const allContent = receivedChunks.join('');
    expect(allContent).toContain('event:');
    expect(allContent).toContain('data:');
    expect(allContent).toContain('"type":"content_block_delta"');
    
    // 验证增量内容正确传递（不应该堆叠）
    expect(allContent).toContain('"text":"你"');
    expect(allContent).toContain('"text":"好"');
  });

  it('应确保 Anthropic SSE 的 event 和 data 行都正确保留', async () => {
    // 模拟 LongCat 等上游返回的标准 Anthropic SSE 格式
    const longcatSSEChunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_longcat_001","model":"LongCat-Flash-Chat"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"我"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"是"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"LongCat"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of longcatSSEChunks) {
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
        model: 'anthropic/claude-3-sonnet',
        messages: [{ role: 'user', content: '介绍你自己' }],
        stream: true
      })
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const receivedChunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedChunks.push(decoder.decode(value));
    }

    // 验证 event 行被正确保留
    const allContent = receivedChunks.join('');
    expect(allContent).toContain('event: message_start');
    expect(allContent).toContain('event: content_block_delta');
    expect(allContent).toContain('event: message_stop');
    
    // 验证 data 行被正确保留
    expect(allContent).toContain('data: {"type":"message_start"');
    expect(allContent).toContain('data: {"type":"content_block_delta"');
    
    // 验证没有重复添加 event 前缀
    const eventCount = (allContent.match(/event:/g) || []).length;
    const dataCount = (allContent.match(/data:/g) || []).length;
    expect(eventCount).toBe(dataCount); // event 和 data 数量应该一致
  });

  it('应正确处理 content_block_delta 增量，不堆叠内容', async () => {
    // 这是关键测试：验证每次只返回增量，而不是累积内容
    const incrementalChunks = [
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"你"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"好"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"，"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"世"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"界"}}\n\n',
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of incrementalChunks) {
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
        model: 'anthropic/claude-3-sonnet',
        messages: [{ role: 'user', content: '打招呼' }],
        stream: true
      })
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const receivedChunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedChunks.push(decoder.decode(value));
    }

    // 解析每个 chunk，验证 delta.text 是增量而非累积
    const deltaTexts: string[] = [];
    for (const chunk of receivedChunks) {
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const data = JSON.parse(line.slice(5));
            if (data.delta?.text) {
              deltaTexts.push(data.delta.text);
            }
          } catch {
            // ignore
          }
        }
      }
    }

    // 验证每个 delta 都是单个字符（增量），而不是累积字符串
    expect(deltaTexts).toEqual(['你', '好', '，', '世', '界']);
    
    // 验证没有堆叠（堆叠的话会是 "你", "你好", "你好，", ...）
    expect(deltaTexts.some(t => t.length > 2)).toBe(false);
  });

  it('应处理 LongCat 风格的累积 delta（上游行为，非 proxy 问题）', async () => {
    // 注意：根据 longcat_raw_sse.log，LongCat 上游返回的 delta.text 是累积的
    // 这是上游的实现方式，proxy 应该透传
    const longcatCumulativeChunks = [
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"你好"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"你好呀"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"你好呀！"}}\n\n',
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of longcatCumulativeChunks) {
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
        model: 'anthropic/claude-3-sonnet',
        messages: [{ role: 'user', content: '打招呼' }],
        stream: true
      })
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const receivedChunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedChunks.push(decoder.decode(value));
    }

    // 解析每个 chunk，验证 delta.text 被原样透传（包括累积行为）
    const deltaTexts: string[] = [];
    for (const chunk of receivedChunks) {
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const data = JSON.parse(line.slice(5));
            if (data.delta?.text) {
              deltaTexts.push(data.delta.text);
            }
          } catch {
            // ignore
          }
        }
      }
    }

    // LongCat 的累积 delta 应该被原样透传
    expect(deltaTexts).toEqual(['你好', '你好呀', '你好呀！']);
    
    // 验证 SSE 格式正确，没有重复的 event: 行
    const allContent = receivedChunks.join('');
    const eventCount = (allContent.match(/event:/g) || []).length;
    const dataCount = (allContent.match(/data:\s*\{/g) || []).length;
    expect(eventCount).toBe(dataCount);
  });

  it('应验证代码简化：移除不必要的 event: 检查逻辑', async () => {
    // 这个测试验证代码简化的价值
    // 
    // 旧代码逻辑：
    //   if (!sseLine.includes('event:')) { 尝试添加 event: }
    //   if (!sseLine.endsWith('\n\n')) { sseLine += '\n\n'; }
    //
    // 新代码逻辑：
    //   sseLine += '\n\n';
    //
    // 由于 LongCat 等上游返回的 SSE 本身就包含 event: 行，
    // 旧代码的 if 检查实际上不会触发，行为与新代码一致。
    // 
    // 改动的价值：
    // 1. 代码更简洁（从 15 行减少到 5 行）
    // 2. 意图更明确（直接透传）
    // 3. 减少潜在的边界情况错误
    
    const stream = new ReadableStream({
      start(controller) {
        // 模拟标准的 Anthropic SSE 格式（包含 event: 和 data:）
        controller.enqueue(new TextEncoder().encode(
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"测试"}}\n\n'
        ));
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
        model: 'anthropic/claude-3-sonnet',
        messages: [{ role: 'user', content: 'Test' }],
        stream: true
      })
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullResponse += decoder.decode(value);
    }

    // 验证输出格式正确
    expect(fullResponse).toContain('event: content_block_delta');
    expect(fullResponse).toContain('data: {"type":"content_block_delta"');
    
    // 验证没有重复的 event: 行
    const lines = fullResponse.split('\n').filter(l => l.trim());
    let eventLineCount = 0;
    for (const line of lines) {
      if (line.startsWith('event:')) eventLineCount++;
    }
    expect(eventLineCount).toBe(1);
  });
});

// ==================== 边界情况测试 ====================

describe('SSE 透传 - 边界情况', () => {
  it('应正确处理不完整的 SSE 块（缓冲区累积）', async () => {
    const config: ProviderConfig[] = [
      {
        customModel: 'openai/gpt-4',
        realModel: 'gpt-4',
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1'
      }
    ];

    const app = new Hono();
    const logger = new MockLogger() as unknown as Logger;
    const detailLogger = new MockDetailLogger() as unknown as DetailLogger;

    app.route('', createChatCompletionsRoute(config, logger, detailLogger, 30000));

    // 模拟一个 SSE 块被分成多个 TCP 包到达
    const incompleteChunk1 = 'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"content":"部';
    const incompleteChunk2 = '分"},"finish_reason":null}]}\n\n';

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(incompleteChunk1));
        controller.enqueue(new TextEncoder().encode(incompleteChunk2));
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
        model: 'openai/gpt-4',
        messages: [{ role: 'user', content: 'Test' }],
        stream: true
      })
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const receivedChunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedChunks.push(decoder.decode(value));
    }

    // 验证缓冲区正确累积了不完整的 chunk
    const allContent = receivedChunks.join('');
    expect(allContent).toContain('"content":"部分"');
    expect(allContent).toMatch(/\n\n$/);
  });

  it('应正确处理空的 SSE 块', async () => {
    const config: ProviderConfig[] = [
      {
        customModel: 'anthropic/claude-3-sonnet',
        realModel: 'claude-3-sonnet-20240229',
        provider: 'anthropic',
        apiKey: 'test-key',
        baseUrl: 'https://api.anthropic.com'
      }
    ];

    const app = new Hono();
    const logger = new MockLogger() as unknown as Logger;
    const detailLogger = new MockDetailLogger() as unknown as DetailLogger;

    app.route('', createMessagesRoute(config, logger, detailLogger, 30000));

    // 模拟包含空块的 SSE 流
    const chunksWithEmpty = [
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      '\n\n', // 空块
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"测试"}}\n\n',
      '   \n\n', // 只有空格的块
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunksWithEmpty) {
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
        model: 'anthropic/claude-3-sonnet',
        messages: [{ role: 'user', content: 'Test' }],
        stream: true
      })
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const receivedChunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedChunks.push(decoder.decode(value));
    }

    // 验证有效内容被正确传递
    const allContent = receivedChunks.join('');
    expect(allContent).toContain('"text":"测试"');
    
    // 验证空块被过滤（不应该有连续的 \n\n\n\n）
    expect(allContent).not.toMatch(/\n\n\n\n/);
  });
});
