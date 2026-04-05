/**
 * Tests for processMessagesSuccess
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processMessagesSuccess } from '../../src/routes/messages/msg-response.js';
import { handleMessagesNonStream } from '../../src/routes/messages/non-stream-handler.js';
import { handleStream as handleMessagesStream } from '../../src/routes/messages/stream-handler.js';

// Mock sibling modules
vi.mock('../../src/routes/messages/non-stream-handler.js', () => ({
  handleMessagesNonStream: vi.fn()
}));

vi.mock('../../src/routes/messages/stream-handler.js', () => ({
  handleStream: vi.fn()
}));

function makeMockC(overrides: Partial<any> = {}): any {
  return {
    req: { path: '/v1/messages' },
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
    provider: 'anthropic' as const,
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

describe('processMessagesSuccess', () => {
  describe('auth check', () => {
    it('should return 401 when userAuthEnabled and undefined currentUser', async () => {
      const c = makeMockC({ userAuthEnabled: true });
      const logger = { log: vi.fn() };

      const result = await processMessagesSuccess({
        c,
        response: makeMockResponse(true, 200, {}),
        provider: makeMockProvider(),
        modelName: 'test-model',
        actualModel: 'test-model',
        stream: false,
        body: {},
        rateLimiter: { recordUsage: vi.fn() } as any,
        logger,
        detailLogger: { logStreamResponse: vi.fn() } as any,
        requestId: 'req-123',
        startTime: Date.now() - 100,
        currentUser: undefined,
        modelGroup: undefined,
        triedModels: []
      });

      expect(c.json).toHaveBeenCalledWith({ error: { message: 'Authentication required' } }, 401);
      expect((result as any).status).toBe(401);
      expect(logger.log).toHaveBeenCalledTimes(1);
      expect(handleMessagesNonStream).not.toHaveBeenCalled();
    });

    it('should return 401 when userAuthEnabled and null currentUser', async () => {
      const c = makeMockC({ userAuthEnabled: true });
      const logger = { log: vi.fn() };

      const result = await processMessagesSuccess({
        c,
        response: makeMockResponse(true, 200, {}),
        provider: makeMockProvider(),
        modelName: 'test-model',
        actualModel: 'test-model',
        stream: false,
        body: {},
        rateLimiter: { recordUsage: vi.fn() } as any,
        logger,
        detailLogger: { logStreamResponse: vi.fn() } as any,
        requestId: 'req-123',
        startTime: Date.now() - 100,
        currentUser: null,
        modelGroup: undefined,
        triedModels: []
      });

      expect(c.json).toHaveBeenCalledWith({ error: { message: 'Authentication required' } }, 401);
      expect((result as any).status).toBe(401);
      expect(handleMessagesNonStream).not.toHaveBeenCalled();
    });
  });

  describe('non-stream path', () => {
    it('should call handleMessagesNonStream, log, record usage, and return c.json', async () => {
      const responseData = { type: 'message', content: [] };
      const resultLogEntry = { promptTokens: 10, completionTokens: 20 };
      const logger = { log: vi.fn() };
      const rateLimiter = { recordUsage: vi.fn() };

      vi.mocked(handleMessagesNonStream).mockResolvedValue({
        responseData,
        logEntry: resultLogEntry
      });

      const c = makeMockC();

      const result = await processMessagesSuccess({
        c,
        response: makeMockResponse(true, 200, responseData),
        provider: makeMockProvider(),
        modelName: 'claude-test',
        actualModel: 'claude-test',
        stream: false,
        body: {},
        rateLimiter: rateLimiter as any,
        logger,
        detailLogger: { logStreamResponse: vi.fn() } as any,
        requestId: 'req-123',
        startTime: Date.now() - 100,
        currentUser: { name: 'test-user' },
        modelGroup: undefined,
        triedModels: []
      });

      expect(handleMessagesNonStream).toHaveBeenCalledWith(
        expect.anything(), makeMockProvider(), 'claude-test', expect.any(Object), logger
      );
      expect(logger.log).toHaveBeenCalledWith(resultLogEntry);
      expect(rateLimiter.recordUsage).toHaveBeenCalledWith(
        'claude-test', resultLogEntry, undefined
      );
      expect(c.json).toHaveBeenCalledWith(responseData);
      expect((result as any).data).toBe(responseData);
    });

    it('should pass pricing to rateLimiter when provider has all price fields', async () => {
      const responseData = { type: 'message', content: [] };
      vi.mocked(handleMessagesNonStream).mockResolvedValue({
        responseData,
        logEntry: { promptTokens: 5 }
      });

      const provider = makeMockProvider({
        inputPricePer1M: 1.0,
        outputPricePer1M: 2.0,
        cachedPricePer1M: 0.5
      });
      const rateLimiter = { recordUsage: vi.fn() };

      await processMessagesSuccess({
        c: makeMockC(),
        response: makeMockResponse(true, 200, responseData),
        provider,
        modelName: 'priced-model',
        actualModel: 'priced-model',
        stream: false,
        body: {},
        rateLimiter: rateLimiter as any,
        logger: { log: vi.fn() },
        detailLogger: { logStreamResponse: vi.fn() } as any,
        requestId: 'req-123',
        startTime: Date.now() - 100,
        currentUser: { name: 'test-user' },
        modelGroup: undefined,
        triedModels: []
      });

      expect(rateLimiter.recordUsage).toHaveBeenCalledWith(
        'priced-model',
        expect.any(Object),
        { inputPricePer1M: 1.0, outputPricePer1M: 2.0, cachedPricePer1M: 0.5 }
      );
    });
  });

  describe('stream path', () => {
    it('should call handleMessagesStream and return its result', async () => {
      const streamResponse = makeMockStreamResponse();
      const mockStreamResult = { _streamed: true };
      vi.mocked(handleMessagesStream).mockReturnValue(mockStreamResult as unknown as Response);

      const c = makeMockC();
      const logger = { log: vi.fn() };
      const provider = makeMockProvider();

      const result = await processMessagesSuccess({
        c,
        response: streamResponse,
        provider,
        modelName: 'claude-stream',
        actualModel: 'claude-stream',
        stream: true,
        body: {},
        rateLimiter: { recordUsage: vi.fn() } as any,
        logger,
        detailLogger: { logStreamResponse: vi.fn() } as any,
        requestId: 'req-123',
        startTime: Date.now() - 100,
        currentUser: { name: 'test-user' },
        modelGroup: undefined,
        triedModels: []
      });

      expect(logger.log).toHaveBeenCalled();
      expect(handleMessagesStream).toHaveBeenCalled();
      const streamCall = vi.mocked(handleMessagesStream).mock.calls[0][0];
      expect(streamCall.response).toBe(streamResponse);
      expect(streamCall.provider).toBe(provider);
      expect(streamCall.model).toBe('claude-stream');
      expect(streamCall.actualModel).toBe('claude-stream');
      expect(streamCall.requestId).toBe('req-123');
      expect(streamCall.c).toBe(c);
      expect(result).toBe(mockStreamResult);
    });
  });

  describe('empty body fallback', () => {
    it('should return 500 when response.body is null and non-stream path falls through', async () => {
      vi.mocked(handleMessagesNonStream).mockResolvedValue(null);

      const response = makeMockResponse(false, 502);
      (response as any).body = null;

      const c = makeMockC();
      const logger = { log: vi.fn() };

      const result = await processMessagesSuccess({
        c,
        response,
        provider: makeMockProvider(),
        modelName: 'test-model',
        actualModel: 'test-model',
        stream: false,
        body: {},
        rateLimiter: { recordUsage: vi.fn() } as any,
        logger,
        detailLogger: { logStreamResponse: vi.fn() } as any,
        requestId: 'req-123',
        startTime: Date.now() - 100,
        currentUser: { name: 'test-user' },
        modelGroup: undefined,
        triedModels: []
      });

      expect(c.json).toHaveBeenCalledWith({ error: { message: 'No response body' } }, 500);
      expect((result as any).status).toBe(500);
    });

    it('should return 500 when stream is true and response.body is null', async () => {
      const response = makeMockResponse(true, 200);
      (response as any).body = null;

      vi.mocked(handleMessagesStream).mockImplementation(() => {
        return { error: { message: 'No response body' } } as unknown as Response;
      });

      const c = makeMockC();

      const result = await processMessagesSuccess({
        c,
        response,
        provider: makeMockProvider(),
        modelName: 'test-model',
        actualModel: 'test-model',
        stream: true,
        body: {},
        rateLimiter: { recordUsage: vi.fn() } as any,
        logger: { log: vi.fn() },
        detailLogger: { logStreamResponse: vi.fn() } as any,
        requestId: 'req-123',
        startTime: Date.now() - 100,
        currentUser: { name: 'test-user' },
        modelGroup: undefined,
        triedModels: []
      });

      expect(handleMessagesStream).toHaveBeenCalled();
    });
  });

  describe('logEntry construction', () => {
    it('should include triedModels in logEntry when non-empty', async () => {
      vi.mocked(handleMessagesNonStream).mockResolvedValue({
        responseData: { type: 'message', content: [] },
        logEntry: {}
      });

      const triedModels = [
        { model: 'model-a', exceeded: true, message: 'Rate limited' },
        { model: 'model-b', exceeded: false, message: 'HTTP 500' }
      ];

      await processMessagesSuccess({
        c: makeMockC(),
        response: makeMockResponse(true, 200),
        provider: makeMockProvider(),
        modelName: 'test-model',
        actualModel: 'test-model',
        stream: false,
        body: {},
        rateLimiter: { recordUsage: vi.fn() } as any,
        logger: { log: vi.fn() },
        detailLogger: { logStreamResponse: vi.fn() } as any,
        requestId: 'req-123',
        startTime: Date.now() - 100,
        currentUser: { name: 'test-user' },
        modelGroup: undefined,
        triedModels
      });

      const handleCall = vi.mocked(handleMessagesNonStream).mock.calls[0];
      const passedLogEntry = handleCall[3];
      expect(passedLogEntry.triedModels).toEqual(triedModels);
      expect(passedLogEntry.requestId).toBe('req-123');
      expect(passedLogEntry.modelGroup).toBeUndefined();
    });

    it('should set triedModels to undefined when empty', async () => {
      vi.mocked(handleMessagesNonStream).mockResolvedValue({
        responseData: { type: 'message', content: [] },
        logEntry: {}
      });

      await processMessagesSuccess({
        c: makeMockC(),
        response: makeMockResponse(true, 200),
        provider: makeMockProvider(),
        modelName: 'test-model',
        actualModel: 'test-model',
        stream: false,
        body: {},
        rateLimiter: { recordUsage: vi.fn() } as any,
        logger: { log: vi.fn() },
        detailLogger: { logStreamResponse: vi.fn() } as any,
        requestId: 'req-123',
        startTime: Date.now() - 100,
        currentUser: { name: 'test-user' },
        modelGroup: undefined,
        triedModels: []
      });

      const handleCall = vi.mocked(handleMessagesNonStream).mock.calls[0];
      const passedLogEntry = handleCall[3];
      expect(passedLogEntry.triedModels).toBeUndefined();
    });

    it('should include modelGroup in logEntry', async () => {
      vi.mocked(handleMessagesNonStream).mockResolvedValue({
        responseData: { type: 'message', content: [] },
        logEntry: {}
      });

      await processMessagesSuccess({
        c: makeMockC(),
        response: makeMockResponse(true, 200),
        provider: makeMockProvider(),
        modelName: 'test-model',
        actualModel: 'test-model',
        stream: false,
        body: {},
        rateLimiter: { recordUsage: vi.fn() } as any,
        logger: { log: vi.fn() },
        detailLogger: { logStreamResponse: vi.fn() } as any,
        requestId: 'req-123',
        startTime: Date.now() - 100,
        currentUser: { name: 'test-user' },
        modelGroup: 'test-group',
        triedModels: []
      });

      const handleCall = vi.mocked(handleMessagesNonStream).mock.calls[0];
      const passedLogEntry = handleCall[3];
      expect(passedLogEntry.modelGroup).toBe('test-group');
    });
  });

  describe('fallback: non-stream with handleMessagesNonStream returning null', () => {
    it('should fall through to c.body when handleMessagesNonStream returns null and body exists', async () => {
      vi.mocked(handleMessagesNonStream).mockResolvedValue(null);

      const responseBody = new ReadableStream();
      const response = {
        ok: true,
        status: 200,
        body: responseBody,
        clone: () => ({ json: async () => { throw new Error('bad json'); } })
      } as unknown as Response;
      const c = makeMockC();
      const logger = { log: vi.fn() };

      const result = await processMessagesSuccess({
        c,
        response,
        provider: makeMockProvider(),
        modelName: 'test-model',
        actualModel: 'test-model',
        stream: false,
        body: {},
        rateLimiter: { recordUsage: vi.fn() } as any,
        logger,
        detailLogger: { logStreamResponse: vi.fn() } as any,
        requestId: 'req-123',
        startTime: Date.now() - 100,
        currentUser: { name: 'test-user' },
        modelGroup: undefined,
        triedModels: []
      });

      expect(logger.log).toHaveBeenCalledTimes(1);
      expect(c.body).toHaveBeenCalledWith(responseBody);
      expect((result as any).body).toBe(responseBody);
    });
  });
});
