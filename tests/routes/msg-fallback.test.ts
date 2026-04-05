/**
 * Tests for tryMessagesFallback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tryMessagesFallback, type MsgFallbackContext, type MsgFallbackResult } from '../../src/routes/messages/msg-fallback.js';
import * as upstreamRequestModule from '../../src/routes/messages/upstream-request.js';
import * as msgResponseModule from '../../src/routes/messages/msg-response.js';

// Mock upstream-request module
vi.mock('../../src/routes/messages/upstream-request.js', () => ({
  buildMessagesUpstreamRequest: vi.fn(async (_provider: any, _body: any, _stream: boolean) => ({
    url: 'https://api.example.com/v1/chat/completions',
    headers: { Authorization: 'Bearer test-key' },
    body: { model: _provider.realModel, messages: _body.messages }
  })),
  sendMessagesUpstreamRequest: vi.fn()
}));

// Mock msg-response module
vi.mock('../../src/routes/messages/msg-response.js', () => ({
  processMessagesSuccess: vi.fn()
}));

/**
 * Helper to create a mock Response with configurable ok, status, and json/clone behavior.
 */
function makeMockResponse(ok: boolean, status: number, jsonBody?: any): any {
  return {
    ok,
    status,
    json: async () => jsonBody,
    clone: () => makeJsonBodyClone(jsonBody)
  };
}

function makeJsonBodyClone(jsonBody: any): any {
  return {
    json: async () => jsonBody
  };
}

function createContext(overrides: Partial<MsgFallbackContext> = {}): MsgFallbackContext {
  const mockC = {
    req: { path: '/v1/messages' },
    json: vi.fn((data: any, status: number) => ({ _json: true, data, status }))
  };

  const mockProviders = [
    {
      customModel: 'model-a',
      realModel: 'real-model-a',
      apiKey: 'key-a',
      baseUrl: 'https://api.a.com',
      provider: 'anthropic' as const
    },
    {
      customModel: 'model-b',
      realModel: 'real-model-b',
      apiKey: 'key-b',
      baseUrl: 'https://api.b.com',
      provider: 'openai' as const
    },
    {
      customModel: 'model-c',
      realModel: 'real-model-c',
      apiKey: 'key-c',
      baseUrl: 'https://api.c.com',
      provider: 'anthropic' as const
    }
  ];

  const mockRateLimiter = {
    checkLimits: vi.fn(async () => ({ exceeded: false })),
    createErrorResponse: vi.fn((message: string) => ({ error: { message } })),
    recordUsage: vi.fn()
  };

  const mockLogger = {
    log: vi.fn()
  };

  const mockDetailLogger = {
    logUpstreamRequest: vi.fn(),
    logStreamResponse: vi.fn(),
    logConvertedResponse: vi.fn()
  };

  return {
    c: mockC,
    modelNames: ['model-a', 'model-b', 'model-c'],
    allProviders: mockProviders,
    body: { model: 'model-group-x', messages: [{ role: 'user', content: 'Hello' }] },
    stream: false,
    rateLimiter: mockRateLimiter as any,
    logger: mockLogger as any,
    detailLogger: mockDetailLogger as any,
    requestId: 'test-request-123',
    startTime: Date.now() - 100,
    currentUser: { name: 'test-user' },
    modelGroupName: 'model-group-x',
    timeoutMs: 30000,
    logDir: '/tmp/test-logs',
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tryMessagesFallback', () => {
  describe('first model succeeds', () => {
    it('should return immediately when first model succeeds', async () => {
      const ctx = createContext();
      const mockResponse = makeMockResponse(true, 200, { content: [] });
      const processedResponse = { _processed: true };

      vi.mocked(upstreamRequestModule.sendMessagesUpstreamRequest).mockResolvedValue(mockResponse);
      vi.mocked(msgResponseModule.processMessagesSuccess).mockResolvedValue(processedResponse as any);

      const result = await tryMessagesFallback(ctx);

      expect(result.actualModel).toBe('model-a');
      expect(result.triedModels).toEqual([]);
      expect(result.response).toBe(processedResponse);
      expect(upstreamRequestModule.sendMessagesUpstreamRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('provider not found', () => {
    it('should skip model not in providers list and try next', async () => {
      const ctx = createContext({
        modelNames: ['nonexistent-model', 'model-a'],
        allProviders: [
          {
            customModel: 'model-a',
            realModel: 'real-a',
            apiKey: 'key',
            baseUrl: 'https://api.a.com',
            provider: 'anthropic' as const
          }
        ]
      });

      const mockResponse = makeMockResponse(true, 200, { content: [] });
      const processedResponse = { _processed: true };

      vi.mocked(upstreamRequestModule.sendMessagesUpstreamRequest).mockResolvedValue(mockResponse);
      vi.mocked(msgResponseModule.processMessagesSuccess).mockResolvedValue(processedResponse as any);

      const result = await tryMessagesFallback(ctx);

      expect(result.actualModel).toBe('model-a');
      expect(result.triedModels).toEqual([
        { model: 'nonexistent-model', exceeded: false, message: 'Model config not found' }
      ]);
      expect(upstreamRequestModule.sendMessagesUpstreamRequest).toHaveBeenCalledTimes(1);
    });

    it('should continue through multiple missing providers', async () => {
      const ctx = createContext({
        modelNames: ['nonexistent-1', 'nonexistent-2', 'model-b'],
        allProviders: [
          {
            customModel: 'model-b',
            realModel: 'real-b',
            apiKey: 'key',
            baseUrl: 'https://api.b.com',
            provider: 'openai' as const
          }
        ]
      });

      const mockResponse = makeMockResponse(true, 200, { content: [] });
      const processedResponse = { _processed: true };

      vi.mocked(upstreamRequestModule.sendMessagesUpstreamRequest).mockResolvedValue(mockResponse);
      vi.mocked(msgResponseModule.processMessagesSuccess).mockResolvedValue(processedResponse as any);

      const result = await tryMessagesFallback(ctx);

      expect(result.actualModel).toBe('model-b');
      expect(result.triedModels).toHaveLength(2);
      expect(result.triedModels[0]).toEqual({ model: 'nonexistent-1', exceeded: false, message: 'Model config not found' });
      expect(result.triedModels[1]).toEqual({ model: 'nonexistent-2', exceeded: false, message: 'Model config not found' });
    });
  });

  describe('rate limit exceeded', () => {
    it('should skip model when rate limit exceeded and try next', async () => {
      const mockRateLimiter = {
        checkLimits: vi.fn(async (provider: any) => {
          if (provider.customModel === 'model-a') {
            return { exceeded: true, message: 'Rate limit exceeded for model-a' };
          }
          return { exceeded: false };
        }),
        createErrorResponse: vi.fn((message: string) => ({ error: { message } })),
        recordUsage: vi.fn()
      };

      const ctx = createContext({ rateLimiter: mockRateLimiter as any });

      const mockResponse = makeMockResponse(true, 200, { content: [] });
      const processedResponse = { _processed: true };

      vi.mocked(upstreamRequestModule.sendMessagesUpstreamRequest).mockResolvedValue(mockResponse);
      vi.mocked(msgResponseModule.processMessagesSuccess).mockResolvedValue(processedResponse as any);

      const result = await tryMessagesFallback(ctx);

      expect(result.actualModel).toBe('model-b');
      expect(result.triedModels).toHaveLength(1);
      expect(result.triedModels[0]).toEqual({
        model: 'model-a',
        exceeded: true,
        message: 'Rate limit exceeded for model-a'
      });
      // Should NOT call sendMessagesUpstreamRequest for model-a
      expect(upstreamRequestModule.sendMessagesUpstreamRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('upstream request fails', () => {
    it('should save error body and try next model', async () => {
      const mockResponseA = makeMockResponse(false, 429, { error: { message: 'Rate limited' } });
      const mockResponseB = makeMockResponse(true, 200, { content: [] });

      vi.mocked(upstreamRequestModule.sendMessagesUpstreamRequest)
        .mockResolvedValueOnce(mockResponseA)
        .mockResolvedValueOnce(mockResponseB);

      const processedResponse = { _processed: true };
      vi.mocked(msgResponseModule.processMessagesSuccess).mockResolvedValue(processedResponse as any);

      const ctx = createContext();
      const result = await tryMessagesFallback(ctx);

      expect(result.actualModel).toBe('model-b');
      expect(result.triedModels).toEqual([
        { model: 'model-a', exceeded: false, message: 'HTTP 429' }
      ]);
      expect(upstreamRequestModule.sendMessagesUpstreamRequest).toHaveBeenCalledTimes(2);
    });

    it('should handle JSON parse error on failure response', async () => {
      // Response whose .json() throws
      const mockResponseA = {
        ok: false,
        status: 500,
        json: async () => { throw new Error('Invalid JSON'); },
        clone: () => ({
          text: async () => 'Internal Server Error',
          json: async () => { throw new Error('Invalid JSON'); }
        })
      };
      const mockResponseB = makeMockResponse(true, 200, { content: [] });

      vi.mocked(upstreamRequestModule.sendMessagesUpstreamRequest)
        .mockResolvedValueOnce(mockResponseA as any)
        .mockResolvedValueOnce(mockResponseB);

      const processedResponse = { _processed: true };
      vi.mocked(msgResponseModule.processMessagesSuccess).mockResolvedValue(processedResponse as any);

      const ctx = createContext();
      const result = await tryMessagesFallback(ctx);

      expect(result.actualModel).toBe('model-b');
      expect(result.triedModels).toContainEqual({
        model: 'model-a',
        exceeded: false,
        message: 'HTTP 500'
      });
    });
  });

  describe('all models fail', () => {
    it('should return error response with last error status', async () => {
      const mockResponseA = makeMockResponse(false, 429, { error: { message: 'Rate limited' } });
      const mockResponseB = makeMockResponse(false, 500, { error: { message: 'Server error' } });
      const mockResponseC = makeMockResponse(false, 503, { error: { message: 'Service unavailable' } });

      vi.mocked(upstreamRequestModule.sendMessagesUpstreamRequest)
        .mockResolvedValueOnce(mockResponseA)
        .mockResolvedValueOnce(mockResponseB)
        .mockResolvedValueOnce(mockResponseC);

      const ctx = createContext();
      const result = await tryMessagesFallback(ctx);

      expect(result.actualModel).toBeUndefined();
      expect(result.triedModels).toHaveLength(3);
      expect(result.triedModels[0].exceeded).toBe(false);
      expect(result.triedModels[1].exceeded).toBe(false);
      expect(result.triedModels[2].exceeded).toBe(false);

      // Verify last error (503 from model-c) is returned
      const cCall = ctx.c.json;
      expect(cCall).toHaveBeenCalledWith({ error: { message: 'Service unavailable' } }, 503);
    });

    it('should log failure with triedModels', async () => {
      const mockResponse = makeMockResponse(false, 500, { error: { message: 'Error' } });

      vi.mocked(upstreamRequestModule.sendMessagesUpstreamRequest)
        .mockResolvedValue(mockResponse);

      const ctx = createContext();
      await tryMessagesFallback(ctx);

      expect(ctx.logger.log).toHaveBeenCalledTimes(1);
      const logEntry = ctx.logger.log.mock.calls[0][0];
      expect(logEntry.actualModel).toBeUndefined();
      expect(logEntry.modelGroup).toBe('model-group-x');
      expect(logEntry.statusCode).toBe(500);
      expect(logEntry.triedModels).toBeDefined();
      expect(logEntry.triedModels).toHaveLength(3);
    });

    it('should default to status 500 when no models are attempted', async () => {
      const ctx = createContext({ modelNames: [] });
      const result = await tryMessagesFallback(ctx);

      expect(result.actualModel).toBeUndefined();
      expect(result.triedModels).toEqual([]);

      const cCall = ctx.c.json;
      expect(cCall).toHaveBeenCalledWith(null, 500);
    });
  });

  describe('mixed failure scenarios', () => {
    it('should handle mix of rate-limited and failed models', async () => {
      const mockRateLimiter = {
        checkLimits: vi.fn(async (provider: any) => {
          if (provider.customModel === 'model-a') {
            return { exceeded: true, message: 'Rate limit for A' };
          }
          return { exceeded: false };
        }),
        createErrorResponse: vi.fn(),
        recordUsage: vi.fn()
      };

      const mockResponseB = makeMockResponse(false, 400, { error: { message: 'Bad request' } });
      const mockResponseC = makeMockResponse(true, 200, { content: [] });

      vi.mocked(upstreamRequestModule.sendMessagesUpstreamRequest)
        .mockResolvedValueOnce(mockResponseB)
        .mockResolvedValueOnce(mockResponseC);

      const processedResponse = { _processed: true };
      vi.mocked(msgResponseModule.processMessagesSuccess).mockResolvedValue(processedResponse as any);

      const ctx = createContext({ rateLimiter: mockRateLimiter as any });
      const result = await tryMessagesFallback(ctx);

      expect(result.actualModel).toBe('model-c');
      expect(result.triedModels).toHaveLength(2);
      expect(result.triedModels[0]).toEqual({
        model: 'model-a',
        exceeded: true,
        message: 'Rate limit for A'
      });
      expect(result.triedModels[1]).toEqual({
        model: 'model-b',
        exceeded: false,
        message: 'HTTP 400'
      });
    });

    it('should handle all rate-limited scenario', async () => {
      const mockRateLimiter = {
        checkLimits: vi.fn(async () => ({ exceeded: true, message: 'All rates exceeded' })),
        createErrorResponse: vi.fn(),
        recordUsage: vi.fn()
      };

      const ctx = createContext({
        rateLimiter: mockRateLimiter as any,
        modelNames: ['model-a', 'model-b']
      });

      const result = await tryMessagesFallback(ctx);

      expect(result.actualModel).toBeUndefined();
      expect(result.triedModels).toHaveLength(2);
      expect(result.triedModels.every((t) => t.exceeded)).toBe(true);
      expect(upstreamRequestModule.sendMessagesUpstreamRequest).not.toHaveBeenCalled();
    });
  });

  describe('streaming mode', () => {
    it('should pass stream flag through to upstream and response processor', async () => {
      const mockResponse = makeMockResponse(true, 200, { content: [] });
      const processedResponse = { _processed: true };

      vi.mocked(upstreamRequestModule.sendMessagesUpstreamRequest).mockResolvedValue(mockResponse);
      vi.mocked(msgResponseModule.processMessagesSuccess).mockResolvedValue(processedResponse as any);

      const ctx = createContext({ stream: true });
      await tryMessagesFallback(ctx);

      expect(upstreamRequestModule.buildMessagesUpstreamRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        true
      );
      expect(msgResponseModule.processMessagesSuccess).toHaveBeenCalled();
      const procCall = vi.mocked(msgResponseModule.processMessagesSuccess).mock.calls[0];
      expect(procCall[0].stream).toBe(true);
    });
  });

  describe('fallback after last model fails with JSON error', () => {
    it('should return error response even when clone fails', async () => {
      // Create a mock response where clone() throws
      const mockResponse = {
        ok: false,
        status: 502,
        json: async () => ({ error: { message: '502 Bad Gateway' } }),
        clone: () => ({
          text: async () => { throw new Error('Clone failed'); }
        })
      };

      vi.mocked(upstreamRequestModule.sendMessagesUpstreamRequest)
        .mockResolvedValue(mockResponse as any);

      const ctx = createContext({ modelNames: ['model-a'] });
      const result = await tryMessagesFallback(ctx);

      expect(result.actualModel).toBeUndefined();
      expect(result.triedModels).toEqual([
        { model: 'model-a', exceeded: false, message: 'HTTP 502' }
      ]);
      // Should return a fallback error response with 502 status (since the main .json() works, clone fails but is caught)
      const cCall = ctx.c.json;
      expect(cCall).toHaveBeenCalledWith({ error: { message: '502 Bad Gateway' } }, 502);
    });
  });

  describe('triedModels tracking', () => {
    it('should track all attempted models in order', async () => {
      const mockResponseB = makeMockResponse(false, 500, { error: { message: 'Error B' } });
      const mockResponseA = makeMockResponse(true, 200, { content: [] });

      vi.mocked(upstreamRequestModule.sendMessagesUpstreamRequest)
        .mockResolvedValueOnce(mockResponseB)
        .mockResolvedValueOnce(mockResponseA);

      const processedResponse = { _processed: true };
      vi.mocked(msgResponseModule.processMessagesSuccess).mockResolvedValue(processedResponse as any);

      const ctx = createContext();
      const result = await tryMessagesFallback(ctx);

      expect(result.triedModels).toHaveLength(1);
      expect(result.triedModels[0]).toEqual({
        model: 'model-a',
        exceeded: false,
        message: 'HTTP 500'
      });
      expect(result.actualModel).toBe('model-b');
    });

    it('should track only failed models when first succeeds', async () => {
      const ctx = createContext();
      const mockResponse = makeMockResponse(true, 200, { content: [] });
      const processedResponse = { _processed: true };

      vi.mocked(upstreamRequestModule.sendMessagesUpstreamRequest).mockResolvedValue(mockResponse);
      vi.mocked(msgResponseModule.processMessagesSuccess).mockResolvedValue(processedResponse as any);

      const result = await tryMessagesFallback(ctx);

      expect(result.triedModels).toEqual([]);
      expect(result.actualModel).toBe('model-a');
    });
  });
});
