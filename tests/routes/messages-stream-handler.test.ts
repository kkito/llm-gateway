import { describe, it, expect, vi } from 'vitest';
import { handleStream, type StreamHandlerOptions } from '../../src/routes/messages/stream-handler.js';

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
  };
}

function createMockRateLimiter(): any {
  return { recordUsage: vi.fn() };
}

function createOpenAISSEStream(text: string, usage?: any): ReadableStream {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

  for (const char of text) {
    parts.push(encoder.encode(`data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: { content: char }, finish_reason: null }] })}\n\n`));
  }

  // End of stream
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

function createAnthropicSSEStream(text: string, usage?: any): ReadableStream {
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
  parts.push(encoder.encode(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: usage || { input_tokens: 10, output_tokens: text.length } })}\n\n`));

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

function waitForStreamProcessing(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

// ==================== Tests ====================

describe('handleStream (messages endpoint)', () => {
  describe('basic stream handling', () => {
    it('returns c.body with a ReadableStream', () => {
      const c = createMockHonoContext();
      const stream = createOpenAISSEStream('Hello');
      const options: StreamHandlerOptions = {
        response: new Response(stream),
        provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
        model: 'gpt-4',
        actualModel: 'gpt-4',
        requestId: 'req-123',
        startTime: Date.now(),
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

    it('returns 500 when response.body is null', () => {
      const c = createMockHonoContext();
      const options: StreamHandlerOptions = {
        response: new Response(null),
        provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
        model: 'gpt-4',
        actualModel: 'gpt-4',
        requestId: 'req-123',
        startTime: Date.now(),
        logEntry: {},
        rateLimiter: createMockRateLimiter(),
        logger: createMockLogger(),
        detailLogger: createMockDetailLogger(),
        c,
      };

      const res = handleStream(options);
      expect(res.status).toBe(500);
    });
  });

  describe('OpenAI provider conversion (OpenAI SSE -> Anthropic SSE)', () => {
    it('converts OpenAI SSE stream to Anthropic SSE format', async () => {
      const c = createMockHonoContext();
      const usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };
      const stream = createOpenAISSEStream('Hi', usage);
      const options: StreamHandlerOptions = {
        response: new Response(stream),
        provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
        model: 'gpt-4',
        actualModel: 'gpt-4',
        requestId: 'req-123',
        startTime: Date.now(),
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

      // Output should be Anthropic SSE format with event: and data: prefixes
      const allContent = chunks.join('');
      expect(allContent).toContain('event:');
      // Should contain the text content (reconstruct from delta events)
      const textMatches = allContent.match(/"text":"([^"]*?)"/g);
      const reconstructedText = textMatches
        ? textMatches.map(m => m.replace('"text":"', '').replace('"', '')).join('')
        : '';
      expect(reconstructedText).toBe('Hi');
      // Should contain Anthropic event types
      expect(allContent).toContain('message_start');
      expect(allContent).toContain('content_block_delta');
      expect(allContent).toContain('message_stop');
    });

    it('passes through Anthropic SSE stream unchanged', async () => {
      const c = createMockHonoContext();
      const usage = { input_tokens: 10, output_tokens: 15 };
      const stream = createAnthropicSSEStream('Hello Claude', usage);
      const options: StreamHandlerOptions = {
        response: new Response(stream),
        provider: { customModel: 'claude', realModel: 'claude-3-sonnet', apiKey: 'x', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
        model: 'claude',
        actualModel: 'claude',
        requestId: 'req-123',
        startTime: Date.now(),
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

      // Each chunk should end with \n\n and contain event:/data: prefixes
      const joinedContent = chunks.join('');
      expect(joinedContent).toContain('event:');
      // Should contain the text content (reconstruct from delta events)
      const textMatches = joinedContent.match(/"text":"([^"]*?)"/g);
      const reconstructedText = textMatches
        ? textMatches.map(m => m.replace('"text":"', '').replace('"', '')).join('')
        : '';
      expect(reconstructedText).toBe('Hello Claude');
      expect(joinedContent).toContain('message_delta');
      expect(joinedContent).toContain('message_stop');
    });
  });

  describe('usage extraction', () => {
    it('extracts promptTokens and completionTokens from OpenAI usage', async () => {
      const c = createMockHonoContext();
      const usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
      const stream = createOpenAISSEStream('Test', usage);
      const logEntry: any = {};
      const rateLimiter = createMockRateLimiter();
      const options: StreamHandlerOptions = {
        response: new Response(stream),
        provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
        model: 'gpt-4',
        actualModel: 'gpt-4',
        requestId: 'req-123',
        startTime: Date.now(),
        logEntry,
        rateLimiter,
        logger: createMockLogger(),
        detailLogger: createMockDetailLogger(),
        c,
      };

      const res = handleStream(options);
      const reader = res.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      expect(logEntry.promptTokens).toBe(100);
      expect(logEntry.completionTokens).toBe(50);
    });

    it('extracts promptTokens, completionTokens from Anthropic usage', async () => {
      const c = createMockHonoContext();
      const usage = { input_tokens: 80, output_tokens: 30 };
      const stream = createAnthropicSSEStream('Test', usage);
      const logEntry: any = {};
      const options: StreamHandlerOptions = {
        response: new Response(stream),
        provider: { customModel: 'claude', realModel: 'claude-3-sonnet', apiKey: 'x', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
        model: 'claude',
        actualModel: 'claude',
        requestId: 'req-123',
        startTime: Date.now(),
        logEntry,
        rateLimiter: createMockRateLimiter(),
        logger: createMockLogger(),
        detailLogger: createMockDetailLogger(),
        c,
      };

      const res = handleStream(options);
      const reader = res.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      expect(logEntry.promptTokens).toBe(80);
      expect(logEntry.completionTokens).toBe(30);
    });

    it('extracts cachedTokens from OpenAI prompt_tokens_details', async () => {
      const c = createMockHonoContext();
      const usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 10 },
      };
      const stream = createOpenAISSEStream('Test with cache', usage);
      const logEntry: any = {};
      const options: StreamHandlerOptions = {
        response: new Response(stream),
        provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
        model: 'gpt-4',
        actualModel: 'gpt-4',
        requestId: 'req-123',
        startTime: Date.now(),
        logEntry,
        rateLimiter: createMockRateLimiter(),
        logger: createMockLogger(),
        detailLogger: createMockDetailLogger(),
        c,
      };

      const res = handleStream(options);
      const reader = res.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      expect(logEntry.cachedTokens).toBe(10);
    });

    it('extracts cachedTokens from Anthropic usage input_tokens_details', async () => {
      const c = createMockHonoContext();
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":80,"output_tokens":30,"input_tokens_details":{"cached_tokens":50}}}\n\n'));
          controller.close();
        },
      });
      const logEntry: any = {};
      const options: StreamHandlerOptions = {
        response: new Response(stream),
        provider: { customModel: 'claude', realModel: 'claude-3-sonnet', apiKey: 'x', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
        model: 'claude',
        actualModel: 'claude',
        requestId: 'req-123',
        startTime: Date.now(),
        logEntry,
        rateLimiter: createMockRateLimiter(),
        logger: createMockLogger(),
        detailLogger: createMockDetailLogger(),
        c,
      };

      const res = handleStream(options);
      const reader = res.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      expect(logEntry.cachedTokens).toBe(50);
    });
  });

  describe('logging and rate limiting', () => {
    it('calls logger.log on stream end', async () => {
      const c = createMockHonoContext();
      const logger = createMockLogger();
      const stream = createOpenAISSEStream('Log test');
      const rateLimiter = createMockRateLimiter();
      const options: StreamHandlerOptions = {
        response: new Response(stream),
        provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
        model: 'gpt-4',
        actualModel: 'gpt-4',
        requestId: 'req-123',
        startTime: Date.now(),
        logEntry: {},
        rateLimiter,
        logger,
        detailLogger: createMockDetailLogger(),
        c,
      };

      const res = handleStream(options);
      const reader = res.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
      await waitForStreamProcessing();

      expect(logger.log).toHaveBeenCalled();
    });

    it('calls rateLimiter.recordUsage with pricing when available', async () => {
      const c = createMockHonoContext();
      const rateLimiter = createMockRateLimiter();
      const logger = createMockLogger();
      const stream = createOpenAISSEStream('Pricing test');
      const options: StreamHandlerOptions = {
        response: new Response(stream),
        provider: {
          customModel: 'gpt-4',
          realModel: 'gpt-4',
          apiKey: 'x',
          baseUrl: 'https://api.openai.com',
          provider: 'openai',
          inputPricePer1M: 10,
          outputPricePer1M: 20,
          cachedPricePer1M: 5,
        },
        model: 'gpt-4',
        actualModel: 'gpt-4',
        requestId: 'req-123',
        startTime: Date.now(),
        logEntry: {},
        rateLimiter,
        logger,
        detailLogger: createMockDetailLogger(),
        c,
      };

      handleStream(options);
      await waitForStreamProcessing();

      expect(rateLimiter.recordUsage).toHaveBeenCalledWith(
        'gpt-4',
        expect.any(Object),
        { inputPricePer1M: 10, outputPricePer1M: 20, cachedPricePer1M: 5 }
      );
    });

    it('calls detailLogger.logStreamResponse twice (raw and processed)', async () => {
      const c = createMockHonoContext();
      const detailLogger = createMockDetailLogger();
      const logger = createMockLogger();
      const rateLimiter = createMockRateLimiter();
      const stream = createAnthropicSSEStream('Log raw test');
      const options: StreamHandlerOptions = {
        response: new Response(stream),
        provider: { customModel: 'claude', realModel: 'claude-3-sonnet', apiKey: 'x', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
        model: 'claude',
        actualModel: 'claude',
        requestId: 'req-123',
        startTime: Date.now(),
        logEntry: {},
        rateLimiter,
        logger,
        detailLogger,
        c,
      };

      handleStream(options);
      await waitForStreamProcessing();

      expect(detailLogger.logStreamResponse).toHaveBeenCalledTimes(2);
    });
  });

  describe('edge cases', () => {
    it('handles stream with multiple content blocks', async () => {
      const c = createMockHonoContext();
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_1', role: 'assistant' } })}\n\n`));
          controller.enqueue(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'block1' } })}\n\n`));
          controller.enqueue(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`));
          controller.enqueue(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: 'block2' } })}\n\n`));
          controller.enqueue(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 1 })}\n\n`));
          controller.enqueue(encoder.encode(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 5, output_tokens: 10 } })}\n\n`));
          controller.enqueue(encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
          controller.close();
        },
      });
      const logEntry: any = {};
      const options: StreamHandlerOptions = {
        response: new Response(stream),
        provider: { customModel: 'claude', realModel: 'claude-3-sonnet', apiKey: 'x', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
        model: 'claude',
        actualModel: 'claude',
        requestId: 'req-multiple',
        startTime: Date.now(),
        logEntry,
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

      expect(chunks.length).toBeGreaterThan(0);
      // Should contain both blocks and usage info
      expect(logEntry.promptTokens).toBe(5);
      expect(logEntry.completionTokens).toBe(10);
    });

    it('uses actualModel as fallback when recordUsage is called', async () => {
      const c = createMockHonoContext();
      const rateLimiter = createMockRateLimiter();
      const logger = createMockLogger();
      const stream = createOpenAISSEStream('Fallback test');
      const options: StreamHandlerOptions = {
        response: new Response(stream),
        provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
        model: 'original-model',
        actualModel: 'actual-model',
        requestId: 'req-actual',
        startTime: Date.now(),
        logEntry: {},
        rateLimiter,
        logger,
        detailLogger: createMockDetailLogger(),
        c,
      };

      handleStream(options);
      await waitForStreamProcessing();

      expect(rateLimiter.recordUsage).toHaveBeenCalledWith('actual-model', expect.any(Object), undefined);
    });

    it('handles empty chunks correctly', async () => {
      const c = createMockHonoContext();
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('\n\n'));
          controller.enqueue(encoder.encode('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":5,"output_tokens":3}}\n\n'));
          controller.close();
        },
      });
      const logEntry: any = {};
      const options: StreamHandlerOptions = {
        response: new Response(stream),
        provider: { customModel: 'claude', realModel: 'claude-3-sonnet', apiKey: 'x', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
        model: 'claude',
        actualModel: 'claude',
        requestId: 'req-empty',
        startTime: Date.now(),
        logEntry,
        rateLimiter: createMockRateLimiter(),
        logger: createMockLogger(),
        detailLogger: createMockDetailLogger(),
        c,
      };

      const res = handleStream(options);
      const reader = res.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      expect(logEntry.promptTokens).toBe(5);
      expect(logEntry.completionTokens).toBe(3);
    });
  });
});
