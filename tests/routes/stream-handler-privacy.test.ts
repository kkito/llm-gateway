import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleStream, type StreamHandlerOptions } from '../../src/routes/chat-completions/stream-handler.js';
import { clearPathMappings, sanitizePaths } from '../../src/privacy/sanitizer.js';

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

function makeSSEChunk(content: string): string {
  return `data: ${JSON.stringify({
    id: 'test-id',
    object: 'chat.completion.chunk',
    created: 1234567,
    model: 'gpt-4',
    choices: [{ index: 0, delta: { content }, finish_reason: null }]
  })}\n\n`;
}

function createSingleChunkOpenAIStream(content: string, usage?: any): ReadableStream {
  const encoder = new TextEncoder();
  const chunk = `data: ${JSON.stringify({
    id: 'test-id',
    object: 'chat.completion.chunk',
    created: 1234567,
    model: 'gpt-4',
    choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }],
    ...(usage ? { usage } : {}),
  })}\n\n`;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function createMultiCharOpenAIStream(chunks: string[], usage?: any): ReadableStream {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = chunks.map(c => encoder.encode(makeSSEChunk(c)));
  if (usage) {
    parts.push(encoder.encode(`data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\n`));
  }
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

const baseOptions = (response: Response, privacySettings?: any): StreamHandlerOptions => ({
  response,
  provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
  model: 'gpt-4',
  actualModel: 'gpt-4',
  requestId: 'req-123',
  startTime: Date.now(),
  logEntry: {},
  rateLimiter: createMockRateLimiter(),
  logger: createMockLogger(),
  detailLogger: createMockDetailLogger(),
  c: createMockHonoContext(),
  privacySettings,
});

async function collectStream(res: Response): Promise<string[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }
  return chunks;
}

// ==================== Tests ====================

describe('SSE privacy — sliding window', () => {
  beforeEach(() => { clearPathMappings(); });

  it('no privacy: forwards chunks immediately as-is', async () => {
    const content = 'Hello world';
    const stream = createSingleChunkOpenAIStream(content);
    const res = handleStream(baseOptions(new Response(stream)));
    const chunks = await collectStream(res);

    const allContent = chunks.join('');
    expect(allContent).toContain('Hello world');
  });

  it('privacy mode: replaces complete placeholder in single chunk', async () => {
    const reqBody = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/file.txt' }] };
    sanitizePaths(reqBody, '__USER__', 'req-123');

    const placeholder = '/home/__USER__/file.txt';
    const stream = createSingleChunkOpenAIStream(`Fixed ${placeholder}`);
    const res = handleStream(baseOptions(new Response(stream), {
      enabled: true,
      sanitizeFilePaths: true,
    }));
    const chunks = await collectStream(res);
    const allContent = chunks.join('');

    expect(allContent).toContain('/home/zhangsan/');
    expect(allContent).not.toContain('/home/__USER__/');
  });

  it('privacy mode: replaces placeholder split across 2 chunks', async () => {
    const reqBody = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/app/main.py' }] };
    sanitizePaths(reqBody, '__USER__', 'req-123');

    // 2 content chunks + 1 finish chunk = 3 total, window flushes all at once
    // Placeholder is complete in chunk1
    const stream = createMultiCharOpenAIStream([
      'See /home/__USER__/',
      'app/main.py',
    ]);
    const res = handleStream(baseOptions(new Response(stream), {
      enabled: true,
      sanitizeFilePaths: true,
    }));
    const chunks = await collectStream(res);
    const allContent = chunks.join('');

    expect(allContent).toContain('/home/zhangsan/');
    expect(allContent).not.toContain('__USER__');
  });

  it('privacy mode: replaces placeholder split across 3 chunks', async () => {
    const reqBody = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/app/main.py' }] };
    sanitizePaths(reqBody, '__USER__', 'req-123');

    // 3 content chunks = 3 total, window flushes all at once
    // Placeholder is complete in chunk2
    const stream = createMultiCharOpenAIStream([
      'Path: ',
      '/home/__USER__/app/',
      'main.py',
    ]);
    const res = handleStream(baseOptions(new Response(stream), {
      enabled: true,
      sanitizeFilePaths: true,
    }));
    const chunks = await collectStream(res);
    const allContent = chunks.join('');

    expect(allContent).toContain('/home/zhangsan/');
    expect(allContent).not.toContain('__USER__');
  });

  it('privacy mode: flushes remaining < 3 chunks at stream end', async () => {
    const reqBody = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/app/main.py' }] };
    sanitizePaths(reqBody, '__USER__', 'req-123');

    const chunk1 = makeSSEChunk('See /home/__USER__/');
    const chunk2 = makeSSEChunk('file.txt');

    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(chunk1));
        controller.enqueue(enc.encode(chunk2));
        controller.close();
      },
    });

    const res = handleStream(baseOptions(new Response(stream), {
      enabled: true,
      sanitizeFilePaths: true,
    }));
    const chunks = await collectStream(res);

    expect(chunks.length).toBeGreaterThan(0);
    const allContent = chunks.join('');
    expect(allContent).toContain('/home/zhangsan/');
  });

  it('privacy mode: no character loss after replacement', async () => {
    const reqBody = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/app/main.py' }] };
    sanitizePaths(reqBody, '__USER__', 'req-123');

    // Use multi-char chunks where the placeholder stays intact
    const stream = createMultiCharOpenAIStream([
      'Hello /home/__USER__/',
      'file.txt world',
    ]);

    const res = handleStream(baseOptions(new Response(stream), {
      enabled: true,
      sanitizeFilePaths: true,
    }));
    const chunks = await collectStream(res);
    const output = chunks.join('');

    const chunkCount = output.split('data:').length - 1;
    expect(chunkCount).toBeGreaterThan(0);
    expect(output).toContain('/home/zhangsan/');
    expect(output).not.toContain('__USER__');
  });

  it('privacy mode: Anthropic format converts and replaces paths', async () => {
    const reqBody = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/app.py' }] };
    sanitizePaths(reqBody, '__USER__', 'req-123');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_1', role: 'assistant', usage: { input_tokens: 5, output_tokens: 0 } } })}\n\n`));
        controller.enqueue(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`));
        controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Fixed /home/__USER__/app.py' } })}\n\n`));
        controller.enqueue(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`));
        controller.enqueue(encoder.encode(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 5, output_tokens: 10 } })}\n\n`));
        controller.enqueue(encoder.encode(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`));
        controller.close();
      },
    });

    const res = handleStream(baseOptions(new Response(stream), {
      enabled: true,
      sanitizeFilePaths: true,
    }));
    const chunks = await collectStream(res);
    const allContent = chunks.join('');

    expect(allContent).toContain('/home/zhangsan/');
    expect(allContent).not.toContain('__USER__');
  });

  it('privacy mode: handles tool_calls in chunks', async () => {
    const reqBody = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/app.py' }] };
    sanitizePaths(reqBody, '__USER__', 'req-123');

    const encoder = new TextEncoder();
    const chunk1Data = {
      id: 'test-id',
      object: 'chat.completion.chunk',
      created: 1234567,
      model: 'gpt-4',
      choices: [] as any[],
    };
    const toolCall = { id: 'tc_1', type: 'function', "function": { name: 'read_file', arguments: '{"path":"/home/__USER__/app.py"}' } };
    chunk1Data.choices.push({ index: 0, delta: { tool_calls: [toolCall] }, finish_reason: null });
    const chunk2Data = {
      id: 'test-id',
      object: 'chat.completion.chunk',
      created: 1234567,
      model: 'gpt-4',
      choices: [{ index: 0, delta: { content: 'Done' }, finish_reason: 'stop' }]
    };
    const chunk1 = `data: ${JSON.stringify(chunk1Data)}\n\n`;
    const chunk2 = `data: ${JSON.stringify(chunk2Data)}\n\n`;

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(chunk1));
        controller.enqueue(encoder.encode(chunk2));
        controller.close();
      },
    });

    const res = handleStream(baseOptions(new Response(stream), {
      enabled: true,
      sanitizeFilePaths: true,
    }));
    const chunks = await collectStream(res);
    const allContent = chunks.join('');

    expect(allContent).toContain('/home/zhangsan/');
    expect(allContent).not.toContain('__USER__');
  });
});
