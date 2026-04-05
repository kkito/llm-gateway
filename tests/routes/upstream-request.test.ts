/**
 * Tests for buildUpstreamRequest
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildUpstreamRequest, sendUpstreamRequest, type UpstreamRequest } from '../../src/routes/chat-completions/upstream-request.js';
import * as providersModule from '../../src/providers/index.js';
import * as convertersModule from '../../src/converters/openai-to-anthropic.js';
import { DetailLogger } from '../../src/detail-logger.js';

vi.mock('../../src/providers/index.js', () => ({
  buildHeaders: vi.fn(() => ({ Authorization: 'Bearer test-api-key', 'Content-Type': 'application/json' })),
  buildUrl: vi.fn((_config: any, _path: string) => 'https://api.example.com/v1/chat/completions')
}));

vi.mock('../../src/converters/openai-to-anthropic.js', () => ({
  convertOpenAIRequestToAnthropic: vi.fn(async (body: any) => ({
    model: body.model,
    messages: body.messages.map((m: any) => ({ role: m.role, content: m.content })),
    max_tokens: body.max_tokens,
    stream: body.stream
  }))
}));

describe('buildUpstreamRequest', () => {
  const mockProvider = {
    customModel: 'gpt-4',
    realModel: 'gpt-4o',
    apiKey: 'test-key',
    baseUrl: 'https://api.openai.com',
    provider: 'openai' as const
  };

  const mockAnthropicProvider = {
    customModel: 'claude-3',
    realModel: 'claude-3-sonnet-20240229',
    apiKey: 'test-key',
    baseUrl: 'https://api.anthropic.com',
    provider: 'anthropic' as const
  };

  const mockBody = {
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 1024,
    temperature: 0.7
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('OpenAI provider path', () => {
    it('should pass through body with model override when stream=false', async () => {
      const result = await buildUpstreamRequest(mockProvider, mockBody, false);

      expect(result.url).toBe('https://api.example.com/v1/chat/completions');
      expect(result.headers).toEqual({ Authorization: 'Bearer test-api-key', 'Content-Type': 'application/json' });
      expect(result.body).toEqual({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1024,
        temperature: 0.7
      });
      expect(result.body).not.toHaveProperty('stream_options');
    });

    it('should add stream_options.include_usage when stream=true', async () => {
      const result = await buildUpstreamRequest(mockProvider, mockBody, true);

      expect(result.body.stream_options).toEqual({ include_usage: true });
      expect(result.body.model).toBe('gpt-4o');
    });

    it('should use buildUrl and buildHeaders from providers module', async () => {
      await buildUpstreamRequest(mockProvider, mockBody, false);

      expect(providersModule.buildUrl).toHaveBeenCalledWith(mockProvider, 'chat');
      expect(providersModule.buildHeaders).toHaveBeenCalledWith(mockProvider);
    });
  });

  describe('Anthropic provider path', () => {
    it('should convert body via convertOpenAIRequestToAnthropic and set model', async () => {
      const result = await buildUpstreamRequest(mockAnthropicProvider, mockBody, true);

      expect(convertersModule.convertOpenAIRequestToAnthropic).toHaveBeenCalledWith(mockBody);
      expect(result.body.model).toBe('claude-3-sonnet-20240229');
      expect(result.body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
      expect(result.body.max_tokens).toBe(1024);
    });

    it('should use buildUrl and buildHeaders from providers module', async () => {
      await buildUpstreamRequest(mockAnthropicProvider, mockBody, false);

      expect(providersModule.buildUrl).toHaveBeenCalledWith(mockAnthropicProvider, 'chat');
      expect(providersModule.buildHeaders).toHaveBeenCalledWith(mockAnthropicProvider);
    });
  });
});

describe('sendUpstreamRequest', () => {
  // Skipping by default because mocking global fetch with AbortSignal.timeout is tricky
  // We rely on integration-level e2e tests for this function
  it.skip('should fetch and return response', async () => {
    // This is tested at e2e level
  });
});
