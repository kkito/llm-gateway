/**
 * Tests for buildMessagesUpstreamRequest
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildMessagesUpstreamRequest, sendMessagesUpstreamRequest, type UpstreamRequest } from '../../src/routes/messages/upstream-request.js';
import * as providersModule from '../../src/providers/index.js';
import * as convertersModule from '../../src/converters/anthropic-to-openai.js';

vi.mock('../../src/providers/index.js', () => ({
  buildHeaders: vi.fn(() => ({ Authorization: 'Bearer test-api-key', 'Content-Type': 'application/json' })),
  buildUrl: vi.fn((_config: any, _path: string) => 'https://api.example.com/v1/chat/completions')
}));

vi.mock('../../src/converters/anthropic-to-openai.js', () => ({
  convertAnthropicRequestToOpenAI: vi.fn((body: any) => ({
    model: body.model || 'gpt-4',
    messages: body.messages.map((m: any) => ({ role: m.role, content: m.content })),
    max_tokens: body.max_tokens,
    stream: body.stream,
    temperature: body.temperature,
    tools: body.tools
  }))
}));

describe('buildMessagesUpstreamRequest', () => {
  const mockAnthropicProvider = {
    customModel: 'claude-3',
    realModel: 'claude-sonnet-4-20250514',
    apiKey: 'test-key',
    baseUrl: 'https://api.anthropic.com',
    provider: 'anthropic' as const
  };

  const mockOpenAIProvider = {
    customModel: 'gpt-4',
    realModel: 'gpt-4o',
    apiKey: 'test-key',
    baseUrl: 'https://api.openai.com',
    provider: 'openai' as const
  };

  const mockAnthropicBody = {
    model: 'claude-3-5-sonnet',
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' }
    ],
    max_tokens: 4096,
    temperature: 0.7
  };

  const mockOpenAIBody = {
    messages: [{ role: 'user', content: 'Hello' }],
    system: 'You are a helpful assistant.',
    max_tokens: 4096,
    temperature: 0.7
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Anthropic provider path', () => {
    it('should pass through body with model override', async () => {
      const result = await buildMessagesUpstreamRequest(mockAnthropicProvider, mockAnthropicBody, true);

      expect(result.url).toBe('https://api.example.com/v1/chat/completions');
      expect(result.headers).toEqual({ Authorization: 'Bearer test-api-key', 'Content-Type': 'application/json' });
      expect(result.body).toEqual({
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' }
        ],
        max_tokens: 4096,
        temperature: 0.7
      });
      expect(convertersModule.convertAnthropicRequestToOpenAI).not.toHaveBeenCalled();
    });

    it('should use buildUrl and buildHeaders from providers module', async () => {
      await buildMessagesUpstreamRequest(mockAnthropicProvider, mockAnthropicBody, false);

      expect(providersModule.buildUrl).toHaveBeenCalledWith(mockAnthropicProvider, 'chat');
      expect(providersModule.buildHeaders).toHaveBeenCalledWith(mockAnthropicProvider);
    });
  });

  describe('OpenAI provider path', () => {
    it('should convert body via convertAnthropicRequestToOpenAI and set model', async () => {
      const result = await buildMessagesUpstreamRequest(mockOpenAIProvider, mockOpenAIBody, true);

      expect(convertersModule.convertAnthropicRequestToOpenAI).toHaveBeenCalledWith(mockOpenAIBody);
      expect(result.body.model).toBe('gpt-4o');
      expect(result.body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
      expect(result.body.max_tokens).toBe(4096);
    });

    it('should use buildUrl and buildHeaders from providers module', async () => {
      await buildMessagesUpstreamRequest(mockOpenAIProvider, mockOpenAIBody, false);

      expect(providersModule.buildUrl).toHaveBeenCalledWith(mockOpenAIProvider, 'chat');
      expect(providersModule.buildHeaders).toHaveBeenCalledWith(mockOpenAIProvider);
    });
  });

  describe('with defaultParams', () => {
    it('should merge defaultParams into request body for Anthropic provider', async () => {
      const providerWithDefaults = {
        ...mockAnthropicProvider,
        defaultParams: { temperature: 0.3, max_tokens: 2048 }
      };
      // Body without temperature/max_tokens - defaults should be applied
      const bodyWithoutParams = {
        model: 'claude-3-5-sonnet',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' }
        ]
      };
      const result = await buildMessagesUpstreamRequest(providerWithDefaults, bodyWithoutParams, true);

      expect(result.body.temperature).toBe(0.3);
      expect(result.body.max_tokens).toBe(2048);
    });

    it('should let user body override defaultParams for Anthropic provider', async () => {
      const providerWithDefaults = {
        ...mockAnthropicProvider,
        defaultParams: { temperature: 0.3, max_tokens: 2048 }
      };
      const result = await buildMessagesUpstreamRequest(providerWithDefaults, mockAnthropicBody, true);

      // User body values take priority
      expect(result.body.temperature).toBe(0.7);
      expect(result.body.max_tokens).toBe(4096);
    });

    it('should deeply merge extra_body for Anthropic provider', async () => {
      const providerWithDefaults = {
        ...mockAnthropicProvider,
        defaultParams: {
          extra_body: { thinking: { type: 'disabled' }, top_k: 50 }
        }
      };
      const bodyWithExtra = {
        ...mockAnthropicBody,
        extra_body: { thinking: { type: 'enabled' } }
      };
      const result = await buildMessagesUpstreamRequest(providerWithDefaults, bodyWithExtra, true);

      expect(result.body.extra_body).toEqual({
        thinking: { type: 'enabled' },
        top_k: 50
      });
    });

    it('should merge defaultParams into converted request body for OpenAI provider', async () => {
      const providerWithDefaults = {
        ...mockOpenAIProvider,
        defaultParams: { top_p: 0.9, frequency_penalty: 0.5 }
      };
      // Body without top_p/frequency_penalty - defaults should be applied
      const bodyWithoutParams = {
        messages: [{ role: 'user', content: 'Hello' }],
        system: 'You are a helpful assistant.',
        max_tokens: 4096,
        temperature: 0.7
      };
      const result = await buildMessagesUpstreamRequest(providerWithDefaults, bodyWithoutParams, true);

      expect(result.body.top_p).toBe(0.9);
      expect(result.body.frequency_penalty).toBe(0.5);
    });

    it('should let user body override defaultParams for OpenAI provider', async () => {
      const providerWithDefaults = {
        ...mockOpenAIProvider,
        defaultParams: { temperature: 0.8, max_tokens: 1024 }
      };
      const result = await buildMessagesUpstreamRequest(providerWithDefaults, mockOpenAIBody, true);

      // User body values take priority
      expect(result.body.temperature).toBe(0.7);
      expect(result.body.max_tokens).toBe(4096);
    });
  });
});

describe('sendMessagesUpstreamRequest', () => {
  // Skipping by default because mocking global fetch with AbortSignal.timeout is tricky.
  // This function is tested at e2e level.
  it.skip('should fetch and return response', async () => {
    // This is tested at e2e level
  });
});
