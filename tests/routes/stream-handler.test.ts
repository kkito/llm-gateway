import { describe, it, expect, vi } from 'vitest';
import { handleStream, type StreamHandlerOptions } from '../../src/routes/chat-completions/stream-handler.js';

// ==================== Mock Helpers ====================

function createMockHonoContext(): any {
  return {
    body: (stream: ReadableStream) => new Response(stream),
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
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain('"content":"Hi"');
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
});
