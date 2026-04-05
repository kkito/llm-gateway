/**
 * Tests for processSuccessfulResponse
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processSuccessfulResponse } from '../../src/routes/chat-completions/response-processor.js';
import { handleNonStream } from '../../src/routes/chat-completions/non-stream-handler.js';
import { handleStream } from '../../src/routes/chat-completions/stream-handler.js';

// Mock sibling modules
vi.mock('../../src/routes/chat-completions/non-stream-handler.js', () => ({
  handleNonStream: vi.fn()
}));

vi.mock('../../src/routes/chat-completions/stream-handler.js', () => ({
  handleStream: vi.fn()
}));

function makeMockC(overrides: Partial<any> = {}): any {
  return {
    req: { path: '/v1/chat/completions' },
    json: vi.fn((data: any, status?: number) => ({ _json: true, data, status })),
    body: vi.fn((bodyVal: any) => ({ _body: true, body: bodyVal })),
    userAuthEnabled: overrides.userAuthEnabled ?? false,
    ...overrides
  };
}

function makeMockProvider(overrides: Partial<any> = {}): any {
  return {
    customModel: 'test-model',
    realModel: 'real-model',
    provider: 'openai' as const,
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
    ...overrides
  };
}

function makeMockResponse(ok: boolean, status: number, jsonBody?: any): Response {
  return {
    ok,
    status,
    json: async () => jsonBody,
    clone: () => ({ json: async () => jsonBody }),
    body: null
  } as unknown as Response;
}

function makeMockStreamResponse(): Response {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: test\n\n'));
        controller.close();
      }
    }),
    clone: () => ({ json: async () => ({}) })
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('processSuccessfulResponse', () => {
  describe('auth check', () => {
    it('should return 401 when userAuthEnabled and undefined currentUser', async () => {
      const c = makeMockC({ userAuthEnabled: true });
      const logger = { log: vi.fn() };
      const response = makeMockResponse(true, 200, { choices: [] });
      response.body = null as unknown as ReadableStream;

      const result = await processSuccessfulResponse(
        c, response, makeMockProvider(), 'test-model', false,
        {}, { recordUsage: vi.fn() } as any, logger,
        { logStreamResponse: vi.fn() } as any,
        'req-123', Date.now() - 100, undefined, undefined, []
      );

      expect(c.json).toHaveBeenCalledWith({ error: { message: 'Authentication required' } }, 401);
      expect((result as any).status).toBe(401);
      expect(logger.log).toHaveBeenCalledTimes(1);
      expect(handleNonStream).not.toHaveBeenCalled();
    });

    it('should return 401 when userAuthEnabled and null currentUser', async () => {
      const c = makeMockC({ userAuthEnabled: true });
      const logger = { log: vi.fn() };
      const response = makeMockResponse(true, 200, { choices: [] });

      const result = await processSuccessfulResponse(
        c, response, makeMockProvider(), 'test-model', false,
        {}, { recordUsage: vi.fn() } as any, logger,
        { logStreamResponse: vi.fn() } as any,
        'req-123', Date.now() - 100, null, undefined, []
      );

      expect(c.json).toHaveBeenCalledWith({ error: { message: 'Authentication required' } }, 401);
      expect((result as any).status).toBe(401);
      expect(handleNonStream).not.toHaveBeenCalled();
    });

    it('should pass auth check when userAuthEnabled and currentUser exists', async () => {
      vi.mocked(handleNonStream).mockResolvedValue({
        responseData: { choices: [] },
        logEntry: {}
      });

      const c = makeMockC({ userAuthEnabled: true });

      await processSuccessfulResponse(
        c, makeMockResponse(true, 200, { choices: [] }), makeMockProvider(), 'test-model', false,
        {}, { recordUsage: vi.fn() } as any, { log: vi.fn() },
        { logStreamResponse: vi.fn() } as any,
        'req-123', Date.now() - 100, { name: 'auth-user' }, undefined, []
      );

      expect(c.json).not.toHaveBeenCalledWith(expect.anything(), 401);
      expect(handleNonStream).toHaveBeenCalled();
    });
  });

  describe('non-stream path', () => {
    it('should call handleNonStream, log, record usage, and return c.json', async () => {
      const responseData = { choices: [{ message: { content: 'Hello' } }] };
      const resultLogEntry = { promptTokens: 10, completionTokens: 20 };
      const logger = { log: vi.fn() };
      const rateLimiter = { recordUsage: vi.fn() };

      vi.mocked(handleNonStream).mockResolvedValue({
        responseData,
        logEntry: resultLogEntry
      });

      const c = makeMockC();

      const result = await processSuccessfulResponse(
        c, makeMockResponse(true, 200, responseData), makeMockProvider(), 'test-model', false,
        {}, rateLimiter as any, logger,
        { logStreamResponse: vi.fn() } as any,
        'req-123', Date.now() - 100, { name: 'test-user' }, undefined, []
      );

      expect(handleNonStream).toHaveBeenCalledWith(
        expect.anything(), makeMockProvider(), 'test-model', expect.any(Object), logger
      );
      expect(logger.log).toHaveBeenCalledWith(resultLogEntry);
      expect(rateLimiter.recordUsage).toHaveBeenCalledWith(
        'test-model', resultLogEntry, undefined
      );
      expect(c.json).toHaveBeenCalledWith(responseData);
      expect((result as any).data).toBe(responseData);
    });

    it('should pass pricing to rateLimiter when provider has all price fields', async () => {
      const responseData = { choices: [] };
      vi.mocked(handleNonStream).mockResolvedValue({
        responseData,
        logEntry: { promptTokens: 5 }
      });

      const provider = makeMockProvider({
        inputPricePer1M: 1.0,
        outputPricePer1M: 2.0,
        cachedPricePer1M: 0.5
      });
      const rateLimiter = { recordUsage: vi.fn() };

      await processSuccessfulResponse(
        makeMockC(), makeMockResponse(true, 200, responseData), provider, 'priced-model', false,
        {}, rateLimiter as any, { log: vi.fn() },
        { logStreamResponse: vi.fn() } as any,
        'req-123', Date.now() - 100, { name: 'test-user' }, undefined, []
      );

      expect(rateLimiter.recordUsage).toHaveBeenCalledWith(
        'priced-model',
        expect.any(Object),
        { inputPricePer1M: 1.0, outputPricePer1M: 2.0, cachedPricePer1M: 0.5 }
      );
    });

    it('should not pass pricing when provider is missing price fields', async () => {
      const responseData = { choices: [] };
      vi.mocked(handleNonStream).mockResolvedValue({
        responseData,
        logEntry: { promptTokens: 5 }
      });

      const provider = makeMockProvider({
        inputPricePer1M: 1.0
        // missing outputPricePer1M and cachedPricePer1M
      });
      const rateLimiter = { recordUsage: vi.fn() };

      await processSuccessfulResponse(
        makeMockC(), makeMockResponse(true, 200, responseData), provider, 'no-price-model', false,
        {}, rateLimiter as any, { log: vi.fn() },
        { logStreamResponse: vi.fn() } as any,
        'req-123', Date.now() - 100, { name: 'test-user' }, undefined, []
      );

      expect(rateLimiter.recordUsage).toHaveBeenCalledWith(
        'no-price-model',
        expect.any(Object),
        undefined
      );
    });
  });

  describe('stream path', () => {
    it('should call handleStream and return its result', async () => {
      const streamResponse = makeMockStreamResponse();
      const mockStreamResult = { _streamed: true };
      vi.mocked(handleStream).mockReturnValue(mockStreamResult as unknown as Response);

      const c = makeMockC();
      const logger = { log: vi.fn() };
      const provider = makeMockProvider();

      const result = await processSuccessfulResponse(
        c, streamResponse, provider, 'test-model', true,
        {}, { recordUsage: vi.fn() } as any, logger,
        { logStreamResponse: vi.fn() } as any,
        'req-123', Date.now() - 100, { name: 'test-user' }, undefined, []
      );

      expect(logger.log).toHaveBeenCalled();
      expect(handleStream).toHaveBeenCalled();
      const streamCall = vi.mocked(handleStream).mock.calls[0][0];
      expect(streamCall.response).toBe(streamResponse);
      expect(streamCall.provider).toBe(provider);
      expect(streamCall.model).toBe('test-model');
      expect(streamCall.actualModel).toBe('test-model');
      expect(streamCall.requestId).toBe('req-123');
      expect(streamCall.c).toBe(c);
      expect(result).toBe(mockStreamResult);
    });

    it('should call handleStream which internally returns 500 for empty body', async () => {
      const emptyBodyResponse = makeMockResponse(true, 200);
      (emptyBodyResponse as any).body = null;
      vi.mocked(handleStream).mockImplementation(() => {
        // handleStream internally checks !response.body and returns 500
        return { error: { message: 'No response body' } } as unknown as Response;
      });

      const c = makeMockC();

      const result = await processSuccessfulResponse(
        makeMockC(), emptyBodyResponse, makeMockProvider(), 'test-model', true,
        {}, { recordUsage: vi.fn() } as any, { log: vi.fn() },
        { logStreamResponse: vi.fn() } as any,
        'req-123', Date.now() - 100, { name: 'test-user' }, undefined, []
      );

      expect(handleStream).toHaveBeenCalled();
      expect(result).toEqual({ error: { message: 'No response body' } });
    });
  });

  describe('logEntry construction', () => {
    it('should include triedModels in logEntry when non-empty', async () => {
      vi.mocked(handleNonStream).mockResolvedValue({
        responseData: { choices: [] },
        logEntry: {}
      });

      const triedModels = [
        { model: 'model-a', exceeded: true, message: 'Rate limited' },
        { model: 'model-b', exceeded: false, message: 'HTTP 500' }
      ];

      await processSuccessfulResponse(
        makeMockC(), makeMockResponse(true, 200), makeMockProvider(), 'test-model', false,
        {}, { recordUsage: vi.fn() } as any, { log: vi.fn() },
        { logStreamResponse: vi.fn() } as any,
        'req-123', Date.now() - 100, { name: 'test-user' }, undefined, triedModels
      );

      const handleCall = vi.mocked(handleNonStream).mock.calls[0];
      const passedLogEntry = handleCall[3];
      expect(passedLogEntry.triedModels).toEqual(triedModels);
    });

    it('should set triedModels to undefined when empty', async () => {
      vi.mocked(handleNonStream).mockResolvedValue({
        responseData: { choices: [] },
        logEntry: {}
      });

      await processSuccessfulResponse(
        makeMockC(), makeMockResponse(true, 200), makeMockProvider(), 'test-model', false,
        {}, { recordUsage: vi.fn() } as any, { log: vi.fn() },
        { logStreamResponse: vi.fn() } as any,
        'req-123', Date.now() - 100, { name: 'test-user' }, undefined, []
      );

      const handleCall = vi.mocked(handleNonStream).mock.calls[0];
      const passedLogEntry = handleCall[3];
      expect(passedLogEntry.triedModels).toBeUndefined();
    });

    it('should include modelGroup in logEntry', async () => {
      vi.mocked(handleNonStream).mockResolvedValue({
        responseData: { choices: [] },
        logEntry: {}
      });

      await processSuccessfulResponse(
        makeMockC(), makeMockResponse(true, 200), makeMockProvider(), 'test-model', false,
        {}, { recordUsage: vi.fn() } as any, { log: vi.fn() },
        { logStreamResponse: vi.fn() } as any,
        'req-123', Date.now() - 100, { name: 'test-user' }, 'test-group', []
      );

      const handleCall = vi.mocked(handleNonStream).mock.calls[0];
      const passedLogEntry = handleCall[3];
      expect(passedLogEntry.modelGroup).toBe('test-group');
    });
  });

  describe('logEntry logging before stream handling', () => {
    it('should log logEntry before calling handleStream', async () => {
      const streamResponse = makeMockStreamResponse();
      vi.mocked(handleStream).mockReturnValue({} as Response);

      const logger = { log: vi.fn() };

      await processSuccessfulResponse(
        makeMockC(), streamResponse, makeMockProvider(), 'test-model', true,
        {}, { recordUsage: vi.fn() } as any, logger,
        { logStreamResponse: vi.fn() } as any,
        'req-123', Date.now() - 100, { name: 'test-user' }, undefined, []
      );

      expect(logger.log).toHaveBeenCalled();
      expect(handleStream).toHaveBeenCalled();
      // Verify log was called before stream handling (call order)
      const logCall = logger.log.mock.invocationCallOrder?.[0] ?? 0;
      const streamCall = handleStream.mock.invocationCallOrder?.[0] ?? 0;
      expect(logCall).toBeLessThan(streamCall);
    });
  });

  describe('fallback: non-stream with handleNonStream returning null', () => {
    it('should fall through to c.body when handleNonStream returns null', async () => {
      vi.mocked(handleNonStream).mockResolvedValue(null);

      const responseBody = new ReadableStream();
      const response = {
        ok: true,
        status: 200,
        body: responseBody,
        clone: () => ({ json: async () => { throw new Error('bad json'); } })
      } as unknown as Response;
      const c = makeMockC();
      const logger = { log: vi.fn() };

      const result = await processSuccessfulResponse(
        c, response, makeMockProvider(), 'test-model', false,
        {}, { recordUsage: vi.fn() } as any, logger,
        { logStreamResponse: vi.fn() } as any,
        'req-123', Date.now() - 100, { name: 'test-user' }, undefined, []
      );

      // logger.log called once for the pre-stream logEntry
      expect(logger.log).toHaveBeenCalledTimes(1);
      // Falls through to raw body return
      expect(c.body).toHaveBeenCalledWith(responseBody);
      expect((result as any).body).toBe(responseBody);
    });
  });
});
