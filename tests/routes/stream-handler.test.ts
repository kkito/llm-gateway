import { describe, it, expect, vi } from 'vitest';
import { handleStream, type StreamHandlerOptions } from '../../src/routes/chat-completions/stream-handler.js';

// ==================== Mock Helpers ====================

function createMockHonoContext(): any {
  const headers = new Headers();
  return {
    header: (name: string, value: string) => headers.set(name, value),
    body: (stream: ReadableStream) => new Response(stream, { headers }),
    json: (data: any, status: number) => new Response(JSON.stringify(data), { status }),
  };
}

function createMockLogger(): any {
  return { log: vi.fn() };
}

function createMockDetailLogger(): any {
  return {
    logStreamResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
  };
}

function createMockRateLimiter(): any {
  return { recordUsage: vi.fn() };
}

function createOpenAIStreamChunks(text: string, usage?: any): ReadableStream {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

  // Initial chunk
  parts.push(encoder.encode(`data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`));

  // Content chunks
  for (const char of text) {
    parts.push(encoder.encode(`data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: { content: char }, finish_reason: null }] })}\n\n`));
  }

  // Final chunk with usage
  if (usage) {
    parts.push(encoder.encode(`data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\n`));
  } else {
    parts.push(encoder.encode(`data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`));
  }

  return new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

function createAnthropicStreamChunks(text: string, usage?: any): ReadableStream {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

  // message_start
  parts.push(encoder.encode(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_123', role: 'assistant', usage: { input_tokens: 10, output_tokens: 0 } } })}\n\n`));

  // content_block_start
  parts.push(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`));

  // content deltas
  for (const char of text) {
    parts.push(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: char } })}\n\n`));
  }

  // content_block_stop
  parts.push(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`));

  // message_delta with usage
  parts.push(encoder.encode(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 10, output_tokens: 20, ...usage } })}\n\n`));

  // message_stop
  parts.push(encoder.encode(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`));

  return new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

// ==================== Tests ====================

describe('handleStream', () => {
  it('returns c.body with a ReadableStream', () => {
    const c = createMockHonoContext();
    const stream = createOpenAIStreamChunks('Hello');
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
      model: 'gpt-4',
      actualModel: 'gpt-4',
      requestId: 'req-123',
      logEntry: {},
      rateLimiter: createMockRateLimiter(),
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    const res = handleStream(options);
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(ReadableStream);
  });

  it('handles OpenAI passthrough with SSE formatting', async () => {
    const c = createMockHonoContext();
    const usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };
    const stream = createOpenAIStreamChunks('Hi', usage);
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
      model: 'gpt-4',
      actualModel: 'gpt-4',
      requestId: 'req-123',
      logEntry: {},
      rateLimiter: createMockRateLimiter(),
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    const res = handleStream(options);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    // All chunks should have data: prefix
    chunks.forEach((chunk) => expect(chunk).toMatch(/^data:/));
    // Last chunk should have usage
    const lastChunk = chunks[chunks.length - 1];
    const parsed = JSON.parse(lastChunk.slice(5).trim());
    expect(parsed.usage).toBeDefined();
    expect(parsed.usage.prompt_tokens).toBe(10);
  });

  it('handles Anthropic path with SSE conversion', async () => {
    const c = createMockHonoContext();
    const stream = createAnthropicStreamChunks('Hello from Claude');
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'claude', realModel: 'claude-3-sonnet', apiKey: 'x', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
      model: 'claude',
      actualModel: 'claude',
      requestId: 'req-123',
      logEntry: {},
      rateLimiter: createMockRateLimiter(),
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    const res = handleStream(options);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    // Converted chunks should have data: prefix and delta/role
    const allContent = chunks.join('');
    expect(allContent).toContain('data:');
    expect(allContent).toContain('"delta"');
    expect(allContent).toContain('"role":"assistant"');
  });

  it('extracts cachedTokens from OpenAI usage prompt_tokens_details', async () => {
    const c = createMockHonoContext();
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 10 },
    };
    const stream = createOpenAIStreamChunks('Test', usage);
    const logEntry: any = {};
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
      model: 'gpt-4',
      actualModel: 'gpt-4',
      requestId: 'req-123',
      logEntry,
      rateLimiter: createMockRateLimiter(),
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    const res = handleStream(options);
    // Consume the stream to trigger processing
    const reader = res.body!.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(logEntry.cachedTokens).toBe(10);
    expect(logEntry.promptTokens).toBe(100);
    expect(logEntry.completionTokens).toBe(50);
  });

  it('extracts cachedTokens from Anthropic usage cache_read_input_tokens', async () => {
    const c = createMockHonoContext();
    const stream = createAnthropicStreamChunks('Test', { cache_read_input_tokens: 50 });
    const logEntry: any = {};
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'claude', realModel: 'claude-3-sonnet', apiKey: 'x', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
      model: 'claude',
      actualModel: 'claude',
      requestId: 'req-123',
      logEntry,
      rateLimiter: createMockRateLimiter(),
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    const res = handleStream(options);
    // Consume the stream to trigger processing
    const reader = res.body!.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(logEntry.cachedTokens).toBe(50);
    expect(logEntry.completionTokens).toBe(20);
  });

  it('handles OpenRouter last chunk without trailing \\n\\n', async () => {
    const c = createMockHonoContext();
    const encoder = new TextEncoder();
    // Last chunk without \n\n (OpenRouter edge case)
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(`data: {"id":"msg","choices":[{"delta":{"role":"assistant"},"index":0}]}`));
        controller.close();
      },
    });
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://openrouter.ai/api', provider: 'openai' },
      model: 'gpt-4',
      actualModel: 'gpt-4',
      requestId: 'req-123',
      logEntry: {},
      rateLimiter: createMockRateLimiter(),
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    const res = handleStream(options);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    // Should have reformatted the incomplete chunk
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toMatch(/^data:/);
  });

  it('skips OpenRouter SSE comment lines starting with :', async () => {
    const c = createMockHonoContext();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(': OPENROUTER PROCESSING\n\n'));
        controller.enqueue(encoder.encode('data: {"id":"msg","choices":[{"delta":{"content":"Hi"},"index":0}]}\n\n'));
        controller.close();
      },
    });
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://openrouter.ai/api', provider: 'openai' },
      model: 'gpt-4',
      actualModel: 'gpt-4',
      requestId: 'req-123',
      logEntry: {},
      rateLimiter: createMockRateLimiter(),
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    const res = handleStream(options);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    // Only the data chunk should be present, not the comment
    const allContent = chunks.join('');
    expect(allContent).not.toContain('OPENROUTER PROCESSING');
    expect(allContent).toContain('"content":"Hi"');
    // 上游无结束标志时，网关补一个标准终止 chunk
    expect(allContent).toContain('"finish_reason":"stop"');
  });

  it('skips SSE ping/comment lines for non-OpenRouter providers', async () => {
    const c = createMockHonoContext();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(': ping\n\n'));
        controller.enqueue(encoder.encode('data: {"id":"msg","choices":[{"delta":{"content":"Hi"},"index":0}]}\n\n'));
        controller.close();
      },
    });
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
      model: 'gpt-4',
      actualModel: 'gpt-4',
      requestId: 'req-123',
      logEntry: {},
      rateLimiter: createMockRateLimiter(),
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    const res = handleStream(options);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    // Only the data chunk should be present, not the ping comment
    const allContent = chunks.join('');
    expect(allContent).toContain('"content":"Hi"');
    expect(allContent).not.toContain('ping');
    // 上游无结束标志时，网关补一个标准终止 chunk
    expect(allContent).toContain('"finish_reason":"stop"');
  });

  it('returns 500 when response.body is null', () => {
    const c = createMockHonoContext();
    const options: StreamHandlerOptions = {
      response: new Response(null),
      provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
      model: 'gpt-4',
      actualModel: 'gpt-4',
      requestId: 'req-123',
      logEntry: {},
      rateLimiter: createMockRateLimiter(),
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    const res = handleStream(options);
    expect(res.status).toBe(500);
  });

  it('calls rateLimiter.recordUsage on stream end', async () => {
    const c = createMockHonoContext();
    const rateLimiter = createMockRateLimiter();
    const usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };
    const stream = createOpenAIStreamChunks('Test', usage);
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
      model: 'gpt-4',
      actualModel: 'gpt-4',
      requestId: 'req-123',
      logEntry: {},
      rateLimiter,
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    handleStream(options);
    // Record usage is called asynchronously, so we need to wait
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rateLimiter.recordUsage).toHaveBeenCalled();
  });

  it('calls logger.log on stream end', async () => {
    const c = createMockHonoContext();
    const logger = createMockLogger();
    const usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };
    const stream = createOpenAIStreamChunks('Test', usage);
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
      model: 'gpt-4',
      actualModel: 'gpt-4',
      requestId: 'req-123',
      logEntry: {},
      rateLimiter: createMockRateLimiter(),
      logger,
      detailLogger: createMockDetailLogger(),
      c,
    };

    handleStream(options);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(logger.log).toHaveBeenCalled();
  });

  it('discards incomplete SSE buffer for non-OpenRouter providers', async () => {
    const c = createMockHonoContext();
    const encoder = new TextEncoder();
    // Incomplete chunk without \n\n (non-OpenRouter, so buffer is discarded)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"id":"msg","choices":[{"delta":{"content":"Hi"},"index":0}]}'));
        controller.close();
      },
    });
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
      model: 'gpt-4',
      actualModel: 'gpt-4',
      requestId: 'req-123',
      logEntry: {},
      rateLimiter: createMockRateLimiter(),
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    const res = handleStream(options);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    // Non-OpenRouter providers discard incomplete buffers
    expect(chunks.length).toBe(0);
  });

  it('正确处理跨 TCP chunk 边界的 UTF-8 多字节字符（中文不被截断为乱码）', async () => {
    const c = createMockHonoContext();
    const encoder = new TextEncoder();

    // 组装中文 SSE 事件完整内容
    const sseEvents = [
      `data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: { content: '等' }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: { content: '等' }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: { content: '，' }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: { content: '让' }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: { content: '我' }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: { content: '换' }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: { content: '个' }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: { content: '思' }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: { content: '路' }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 } })}\n\n`,
    ];

    // 将所有 SSE 事件拼接到一个大的 Uint8Array 中
    const allBytes = encoder.encode(sseEvents.join(''));
    const totalLen = allBytes.length;

    // 故意从一个多字节字符中间切开：在第 2 个 SSE 事件的 content "等" 中间截断
    // "等" 的 UTF-8 是 e7 ad 89，我们在第一个 "等" 的第二个字节后切开
    // 找到第二个 SSE 事件中 "等" 的起始位置
    const fullJoined = sseEvents.join('');
    const secondEventStart = sseEvents[0].length;
    const secondEventContent = sseEvents[1];
    // "等" 在 JSON 字符串中作为 value，实际 3 字节 UTF-8
    // 找到第二个 SSE 事件开头的位置 + "等" 的组成字节具体位置
    const secondEventBytes = encoder.encode(secondEventContent);

    // 在 "等" 的第 2 个字节后切开：从编码 "等" 的位置找
    const idxOfContent = secondEventContent.indexOf('"content":"') + '"content":"'.length;
    const idxBeforeDeng = encoder.encode(secondEventContent.slice(0, idxOfContent)).length;
    const splitPoint = secondEventStart + idxBeforeDeng + 2; // 在 "等" 的 UTF-8 第 2 个字节后切开

    const chunk1 = encoder.encode(fullJoined.slice(0, splitPoint));
    const chunk2 = encoder.encode(fullJoined.slice(splitPoint));

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });

    const logEntry: any = {};
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
      model: 'gpt-4',
      actualModel: 'gpt-4',
      requestId: 'req-utf8',
      logEntry,
      rateLimiter: createMockRateLimiter(),
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    const res = handleStream(options);
    const reader = res.body!.getReader();
    const decrypt = new TextDecoder();
    const outputChunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      outputChunks.push(decrypt.decode(value));
    }

    const allOutput = outputChunks.join('');

    // 验证所有中文内容正确拼接，不包含替换字符 \uFFFD
    expect(allOutput).not.toContain('\uFFFD');
    expect(allOutput).toContain('"content":"等"');
    expect(allOutput).toContain('"content":"等"');
    expect(allOutput).toContain('"content":"，"');
    expect(allOutput).toContain('"content":"让"');
    expect(allOutput).toContain('"content":"我"');
    expect(allOutput).toContain('"content":"换"');
    expect(allOutput).toContain('"content":"个"');
    expect(allOutput).toContain('"content":"思"');
    expect(allOutput).toContain('"content":"路"');

    // 验证 usage 仍然正常提取
    expect(logEntry.promptTokens).toBe(5);
    expect(logEntry.completionTokens).toBe(4);
  });

  it('extracts final usage from last chunk that has it', async () => {
    const c = createMockHonoContext();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"},"index":0}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"index":0}],"usage":{"prompt_tokens":5,"completion_tokens":10}}\n\n'));
        controller.close();
      },
    });
    const logEntry: any = {};
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
      model: 'gpt-4',
      actualModel: 'gpt-4',
      requestId: 'req-123',
      logEntry,
      rateLimiter: createMockRateLimiter(),
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    const res = handleStream(options);
    // Consume the stream to trigger processing
    const reader = res.body!.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(logEntry.promptTokens).toBe(5);
    expect(logEntry.completionTokens).toBe(10);
  });

  it('appends a standard finish_reason:stop when upstream stream lacks an end marker', async () => {
    const c = createMockHonoContext();
    const encoder = new TextEncoder();
    // 模拟 muse-spark 这类上游：只有 finish_reason:null + usage/cost，无 [DONE] 也无非 null finish_reason
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"id":"","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"id":"","object":"chat.completion.chunk","choices":[]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":10,"total_tokens":15}}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[],"cost":"0"}\n\n'));
        controller.close();
      },
    });
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
      model: 'gpt-4',
      actualModel: 'gpt-4',
      requestId: 'req-123',
      logEntry: {},
      rateLimiter: createMockRateLimiter(),
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    const res = handleStream(options);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    // 网关补的终止块必须是流的最后一条，且带 finish_reason:"stop"
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk).toMatch(/^data:/);
    const parsed = JSON.parse(lastChunk.slice(5).trim());
    expect(parsed.choices?.[0]?.finish_reason).toBe('stop');
  });

  it('does not append a finish_reason when upstream already ended with a non-null finish_reason', async () => {
    const c = createMockHonoContext();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"},"index":0,"finish_reason":null}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}\n\n'));
        controller.close();
      },
    });
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
      model: 'gpt-4',
      actualModel: 'gpt-4',
      requestId: 'req-123',
      logEntry: {},
      rateLimiter: createMockRateLimiter(),
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    const res = handleStream(options);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    // 上游已带结束标志，网关不应额外补 stop terminate（"stop" 应只来自上游那一次）
    const allContent = chunks.join('');
    expect(allContent.match(/"finish_reason":"stop"/g)).toHaveLength(1);
  });

  it('does not append a finish_reason when upstream already sent [DONE]', async () => {
    const c = createMockHonoContext();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"},"index":0}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const options: StreamHandlerOptions = {
      response: new Response(stream),
      provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
      model: 'gpt-4',
      actualModel: 'gpt-4',
      requestId: 'req-123',
      logEntry: {},
      rateLimiter: createMockRateLimiter(),
      logger: createMockLogger(),
      detailLogger: createMockDetailLogger(),
      c,
    };

    const res = handleStream(options);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    const allContent = chunks.join('');
    // 不额外补 stop 终止块
    expect(allContent.match(/"finish_reason":"stop"/g)).toBeNull();
    // 上游的 [DONE] 原样透传，仍是流的最后一条
    expect(allContent.trim().endsWith('data: [DONE]')).toBe(true);
  });
});
