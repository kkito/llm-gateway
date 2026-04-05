/**
 * Tests for createChatCompletionsHandler — validation, routing, and error handling logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChatCompletionsHandler } from '../../src/routes/chat-completions/handler.js';
import { ModelGroupExhaustedError } from '../../src/lib/model-group-error.js';

// ==================== Module mocks ====================

vi.mock('../../src/converters/openai-to-anthropic.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    convertOpenAIRequestToAnthropic: vi.fn(async (_body: any) => ({
      max_tokens: 1024,
      messages: _body.messages?.map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: [{ type: 'text' as const, text: m.content }]
      }))
    })),
    convertAnthropicResponseToOpenAI: vi.fn((body: any, _model: string) => body)
  };
});

vi.mock('../../src/routes/chat-completions/upstream-request.js', () => ({
  buildUpstreamRequest: vi.fn(async (provider: any, body: any, _stream: boolean) => ({
    url: `${provider.baseUrl}/v1/chat/completions`,
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    body: { ...body, model: provider.realModel }
  })),
  sendUpstreamRequest: vi.fn()
}));

vi.mock('../../src/routes/chat-completions/non-stream-handler.js', () => ({
  handleNonStream: vi.fn(async (response: any, _provider: any, _model: string, logEntry: any, _logger: any) => {
    try {
      const responseData = await response.json();
      logEntry.promptTokens = responseData?.usage?.prompt_tokens;
      logEntry.completionTokens = responseData?.usage?.completion_tokens;
      logEntry.totalTokens = responseData?.usage?.total_tokens;
      return { responseData, logEntry };
    } catch {
      return null as any;
    }
  })
}));

vi.mock('../../src/routes/chat-completions/stream-handler.js', () => ({
  handleStream: vi.fn(({ c, response, logEntry, rateLimiter, logger }: any) => {
    logger.log(logEntry);
    return c.body(response.body);
  })
}));

vi.mock('../../src/routes/chat-completions/model-fallback.js', () => ({
  tryModelGroupWithFallback: vi.fn()
}));

vi.mock('../../src/providers/index.js', () => ({
  buildHeaders: vi.fn((provider: any) => ({ Authorization: `Bearer ${provider.apiKey}` })),
  buildUrl: vi.fn((provider: any, _mode: string) => `${provider.baseUrl}/v1/chat/completions`)
}));

// ==================== Helpers ====================

function createMockC(overrides: any = {}) {
  const mockC: any = {
    req: {
      path: '/v1/chat/completions',
      json: vi.fn(async () => ({})),
      header: vi.fn(() => undefined),
      query: vi.fn(() => undefined),
    },
    json: vi.fn((data: any, status?: number) => ({ _json: true, data, status })),
    body: vi.fn((streamOrBody: any) => ({ _body: true, body: streamOrBody })),
    userAuthEnabled: false,
    currentUser: null,
    ...overrides
  };
  return mockC;
}

function createMockLogger() {
  return {
    log: vi.fn(),
    getFilePath: vi.fn(() => '/tmp/test.log'),
  };
}

function createMockDetailLogger() {
  return {
    logRequest: vi.fn(),
    logUpstreamRequest: vi.fn(),
    logStreamResponse: vi.fn(),
    logResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
  };
}

function createMockRateLimiter(overrides: any = {}) {
  return {
    checkLimits: vi.fn(async () => ({ exceeded: false })),
    createErrorResponse: vi.fn((message: string) => ({ error: { message } })),
    recordUsage: vi.fn(),
    ...overrides
  };
}

// ==================== Tests ====================

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createChatCompletionsHandler', () => {
  describe('validation', () => {
    it('returns 400 when both model and model_group are provided', async () => {
      const config = { models: [] };
      const logger = createMockLogger();
      const detailLogger = createMockDetailLogger();
      const handler = createChatCompletionsHandler(config, logger as any, detailLogger as any, 30000, '/tmp/test');

      const c = createMockC();
      c.req.json = vi.fn(async () => ({
        model: 'gpt-4',
        model_group: 'my-group',
        messages: [{ role: 'user', content: 'hi' }]
      }));

      const response = await handler(c, '/v1/chat/completions');
      expect(response.data.error.message).toBe('model and model_group are mutually exclusive');
      expect(response.status).toBe(400);
    });

    it('returns 400 when neither model nor model_group is provided', async () => {
      const config = { models: [] };
      const logger = createMockLogger();
      const detailLogger = createMockDetailLogger();
      const handler = createChatCompletionsHandler(config, logger as any, detailLogger as any, 30000, '/tmp/test');

      const c = createMockC();
      c.req.json = vi.fn(async () => ({
        messages: [{ role: 'user', content: 'hi' }]
      }));

      const response = await handler(c, '/v1/chat/completions');
      expect(response.data.error.message).toBe('Either model or model_group must be provided');
      expect(response.status).toBe(400);
    });
  });

  describe('model lookup and routing', () => {
    it('routes to fallback when model_group is specified', async () => {
      const { tryModelGroupWithFallback } = await import('../../src/routes/chat-completions/model-fallback.js');
      const fallbackResponse = { _fallback: true };
      vi.mocked(tryModelGroupWithFallback as any).mockResolvedValue({
        actualModel: 'model-a',
        triedModels: [],
        response: fallbackResponse
      });

      const config = {
        models: [
          { customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'https://api.a.com', provider: 'openai' as const }
        ],
        modelGroups: [{ name: 'my-group', models: ['model-a'] }]
      };
      const logger = createMockLogger();
      const detailLogger = createMockDetailLogger();
      const handler = createChatCompletionsHandler(config, logger as any, detailLogger as any, 30000, '/tmp/test');

      const c = createMockC();
      c.req.json = vi.fn(async () => ({
        model_group: 'my-group',
        messages: [{ role: 'user', content: 'hi' }]
      }));

      await handler(c, '/v1/chat/completions');
      expect(tryModelGroupWithFallback).toHaveBeenCalledTimes(1);
      const ctx = vi.mocked(tryModelGroupWithFallback as any).mock.calls[0][0];
      expect(ctx.modelGroupName).toBe('my-group');
      expect(ctx.modelNames).toEqual(['model-a']);
    });

    it('returns 404 when single model is not found', async () => {
      const config = {
        models: [
          { customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'https://api.a.com', provider: 'openai' as const }
        ]
      };
      const logger = createMockLogger();
      const detailLogger = createMockDetailLogger();
      const handler = createChatCompletionsHandler(config, logger as any, detailLogger as any, 30000, '/tmp/test');

      const c = createMockC();
      c.req.json = vi.fn(async () => ({
        model: 'nonexistent-model',
        messages: [{ role: 'user', content: 'hi' }]
      }));

      const response = await handler(c, '/v1/chat/completions');
      expect(response.data.error.message).toBe('Model not found');
      expect(response.status).toBe(404);
    });

    it('routes to fallback when model matches a modelGroup', async () => {
      const { tryModelGroupWithFallback } = await import('../../src/routes/chat-completions/model-fallback.js');
      vi.mocked(tryModelGroupWithFallback as any).mockResolvedValue({
        actualModel: 'model-a',
        triedModels: [],
        response: { _fallback: true }
      });

      const config = {
        models: [
          { customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'https://api.a.com', provider: 'openai' as const }
        ],
        modelGroups: [{ name: 'smart-group', models: ['model-a'] }]
      };
      const logger = createMockLogger();
      const detailLogger = createMockDetailLogger();
      const handler = createChatCompletionsHandler(config, logger as any, detailLogger as any, 30000, '/tmp/test');

      const c = createMockC();
      c.req.json = vi.fn(async () => ({
        model: 'smart-group',
        messages: [{ role: 'user', content: 'hi' }]
      }));

      await handler(c, '/v1/chat/completions');
      expect(tryModelGroupWithFallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('rate limiting', () => {
    it('returns 429 when rate limit exceeded', async () => {
      const RateLimiter = await import('../../src/lib/rate-limiter.js');
      const checkLimitsSpy = vi.spyOn(RateLimiter.RateLimiter.prototype, 'checkLimits').mockResolvedValue({
        exceeded: true,
        message: 'Rate limit exceeded'
      });

      const provider = {
        customModel: 'gpt-4',
        realModel: 'gpt-4-real',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const,
        limits: [{ type: 'requests' as const, period: 'day' as const, max: 10 }]
      };
      const config = { models: [provider] };
      const logger = createMockLogger();
      const detailLogger = createMockDetailLogger();
      const handler = createChatCompletionsHandler(config, logger as any, detailLogger as any, 30000, '/tmp/test');

      const c = createMockC();
      c.req.json = vi.fn(async () => ({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }]
      }));

      const response = await handler(c, '/v1/chat/completions');
      expect(checkLimitsSpy).toHaveBeenCalledTimes(1);
      expect(response.data.error.message).toBe('Rate limit exceeded');
      expect(response.status).toBe(429);
    });
  });

  describe('auth check', () => {
    it('returns 401 when userAuthEnabled but no currentUser', async () => {
      const provider = {
        customModel: 'gpt-4',
        realModel: 'gpt-4-real',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const
      };
      const config = { models: [provider] };
      const logger = createMockLogger();
      const detailLogger = createMockDetailLogger();
      const handler = createChatCompletionsHandler(config, logger as any, detailLogger as any, 30000, '/tmp/test');

      // Auth check happens AFTER upstream response, so we need to mock upstream
      const mockResponse = new Response(JSON.stringify({ choices: [] }));
      const { sendUpstreamRequest } = await import('../../src/routes/chat-completions/upstream-request.js');
      vi.mocked(sendUpstreamRequest as any).mockResolvedValue(mockResponse);

      const c = createMockC();
      c.userAuthEnabled = true;
      c.currentUser = null;
      c.req.json = vi.fn(async () => ({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }]
      }));

      const response = await handler(c, '/v1/chat/completions');
      expect(response.data.error.message).toBe('Authentication required');
      expect(response.status).toBe(401);
    });

    it('passes auth check when currentUser is present', async () => {
      const provider = {
        customModel: 'gpt-4',
        realModel: 'gpt-4-real',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const
      };
      const config = { models: [provider] };
      const logger = createMockLogger();
      const detailLogger = createMockDetailLogger();
      const handler = createChatCompletionsHandler(config, logger as any, detailLogger as any, 30000, '/tmp/test');

      const mockResponse = new Response(JSON.stringify({
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }));

      const { sendUpstreamRequest } = await import('../../src/routes/chat-completions/upstream-request.js');
      vi.mocked(sendUpstreamRequest as any).mockResolvedValue(mockResponse);

      const c = createMockC();
      c.userAuthEnabled = true;
      c.currentUser = { name: 'test-user' };
      c.req.json = vi.fn(async () => ({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false
      }));

      const response = await handler(c, '/v1/chat/completions');
      expect(response._json).toBe(true);
      expect(response.data).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('returns 504 for TimeoutError', async () => {
      const provider = {
        customModel: 'gpt-4',
        realModel: 'gpt-4-real',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const
      };
      const config = { models: [provider] };
      const logger = createMockLogger();
      const detailLogger = createMockDetailLogger();
      const handler = createChatCompletionsHandler(config, logger as any, detailLogger as any, 30000, '/tmp/test');

      const { sendUpstreamRequest } = await import('../../src/routes/chat-completions/upstream-request.js');
      const timeoutError = new Error('The operation was aborted due to timeout');
      (timeoutError as any).name = 'TimeoutError';
      vi.mocked(sendUpstreamRequest as any).mockRejectedValue(timeoutError);

      const c = createMockC();
      c.req.json = vi.fn(async () => ({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }]
      }));

      const response = await handler(c, '/v1/chat/completions');
      expect(response.data.error.message).toBe('Upstream timeout');
      expect(response.data.error.type).toBe('upstream_timeout');
      expect(response.data.error.code).toBe('timeout');
      expect(response.status).toBe(504);
    });

    it('returns 429 for ModelGroupExhaustedError', async () => {
      const { tryModelGroupWithFallback } = await import('../../src/routes/chat-completions/model-fallback.js');
      const exhaustError = new ModelGroupExhaustedError([
        { model: 'model-a', exceeded: true, message: 'Rate limited' }
      ]);
      vi.mocked(tryModelGroupWithFallback as any).mockRejectedValue(exhaustError);

      const config = {
        models: [{ customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'https://api.a.com', provider: 'openai' as const }],
        modelGroups: [{ name: 'my-group', models: ['model-a'] }]
      };
      const logger = createMockLogger();
      const detailLogger = createMockDetailLogger();
      const handler = createChatCompletionsHandler(config, logger as any, detailLogger as any, 30000, '/tmp/test');

      const c = createMockC();
      c.req.json = vi.fn(async () => ({
        model_group: 'my-group',
        messages: [{ role: 'user', content: 'hi' }]
      }));

      const response = await handler(c, '/v1/chat/completions');
      expect(response.data.error.message).toBe('All models in group exceeded their limits');
      expect(response.data.error.type).toBe('rate_limit_error');
      expect(response.data.error.code).toBe('rate_limit_exceeded');
      expect(response.status).toBe(429);
    });

    it('returns 400 for Model group not found error', async () => {
      const { tryModelGroupWithFallback } = await import('../../src/routes/chat-completions/model-fallback.js');
      const groupError = new Error('Model group "nonexistent" not found');
      vi.mocked(tryModelGroupWithFallback as any).mockRejectedValue(groupError);

      const config = {
        models: [],
        modelGroups: []
      };
      const logger = createMockLogger();
      const detailLogger = createMockDetailLogger();
      const handler = createChatCompletionsHandler(config, logger as any, detailLogger as any, 30000, '/tmp/test');

      const c = createMockC();
      c.req.json = vi.fn(async () => ({
        model_group: 'nonexistent',
        messages: [{ role: 'user', content: 'hi' }]
      }));

      const response = await handler(c, '/v1/chat/completions');
      expect(response.data.error.message).toBe('Model group "nonexistent" not found');
      expect(response.data.error.type).toBe('invalid_request_error');
      expect(response.status).toBe(400);
    });

    it('returns 500 for unknown errors', async () => {
      const provider = {
        customModel: 'gpt-4',
        realModel: 'gpt-4-real',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const
      };
      const config = { models: [provider] };
      const logger = createMockLogger();
      const detailLogger = createMockDetailLogger();
      const handler = createChatCompletionsHandler(config, logger as any, detailLogger as any, 30000, '/tmp/test');

      const { sendUpstreamRequest } = await import('../../src/routes/chat-completions/upstream-request.js');
      vi.mocked(sendUpstreamRequest as any).mockRejectedValue(new Error('Unexpected internal error'));

      const c = createMockC();
      c.req.json = vi.fn(async () => ({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }]
      }));

      const response = await handler(c, '/v1/chat/completions');
      expect(response.data.error.message).toBe('Unexpected internal error');
      expect(response.status).toBe(500);
    });
  });

  describe('config function support', () => {
    it('calls config function to get latest config', async () => {
      const { tryModelGroupWithFallback } = await import('../../src/routes/chat-completions/model-fallback.js');
      vi.mocked(tryModelGroupWithFallback as any).mockResolvedValue({
        actualModel: 'model-a',
        triedModels: [],
        response: { _fallback: true }
      });

      const configFn = vi.fn(() => ({
        models: [{ customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'https://api.a.com', provider: 'openai' as const }],
        modelGroups: [{ name: 'my-group', models: ['model-a'] }]
      }));

      const logger = createMockLogger();
      const detailLogger = createMockDetailLogger();
      const handler = createChatCompletionsHandler(configFn as any, logger as any, detailLogger as any, 30000, '/tmp/test');

      const c = createMockC();
      c.req.json = vi.fn(async () => ({
        model_group: 'my-group',
        messages: [{ role: 'user', content: 'hi' }]
      }));

      await handler(c, '/v1/chat/completions');
      expect(configFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('non-stream successful upstream response', () => {
    it('returns JSON response for successful non-stream request', async () => {
      const provider = {
        customModel: 'gpt-4',
        realModel: 'gpt-4-real',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const
      };
      const config = { models: [provider] };
      const logger = createMockLogger();
      const detailLogger = createMockDetailLogger();
      const handler = createChatCompletionsHandler(config, logger as any, detailLogger as any, 30000, '/tmp/test');

      const responseData = {
        choices: [{ message: { role: 'assistant', content: 'Hello' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      };
      const mockResponse = new Response(JSON.stringify(responseData));

      const { sendUpstreamRequest } = await import('../../src/routes/chat-completions/upstream-request.js');
      vi.mocked(sendUpstreamRequest as any).mockResolvedValue(mockResponse);

      const c = createMockC();
      c.req.json = vi.fn(async () => ({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false
      }));

      const response = await handler(c, '/v1/chat/completions');
      expect(response._json).toBe(true);
      expect(response.data).toBeDefined();
    });
  });

  describe('detail logging', () => {
    it('logs request via detailLogger', async () => {
      const provider = {
        customModel: 'gpt-4',
        realModel: 'gpt-4-real',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const
      };
      const config = { models: [provider] };
      const logger = createMockLogger();
      const detailLogger = createMockDetailLogger();
      const handler = createChatCompletionsHandler(config, logger as any, detailLogger as any, 30000, '/tmp/test');

      const mockResponse = new Response(JSON.stringify({ choices: [] }));
      const { sendUpstreamRequest } = await import('../../src/routes/chat-completions/upstream-request.js');
      vi.mocked(sendUpstreamRequest as any).mockResolvedValue(mockResponse);

      const c = createMockC();
      const requestBody = { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] };
      c.req.json = vi.fn(async () => requestBody);

      await handler(c, '/v1/chat/completions');
      expect(detailLogger.logRequest).toHaveBeenCalledTimes(1);
    });
  });
});
