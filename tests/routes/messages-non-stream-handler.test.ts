import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMessagesNonStream } from '../../src/routes/messages/non-stream-handler.js';
import { convertOpenAIResponseToAnthropic } from '../../src/converters/anthropic-to-openai.js';

vi.mock('../../src/converters/anthropic-to-openai.js', () => ({
  convertOpenAIResponseToAnthropic: vi.fn()
}));

// ==================== Helpers ====================

function createLogger() {
  return { log: vi.fn() };
}

function createJsonResponse(jsonData: any): Response {
  return new Response(JSON.stringify(jsonData), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// ==================== Tests ====================

describe('handleMessagesNonStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('OpenAI provider path', () => {
    it('converts response via convertOpenAIResponseToAnthropic and extracts tokens', async () => {
      const openAIJson = {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        model: 'gpt-4',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150
        }
      };
      const anthropicConverted = {
        id: 'chatcmpl-test',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-sonnet',
        content: [{ type: 'text', text: 'Hello' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: 50
        }
      };

      vi.mocked(convertOpenAIResponseToAnthropic).mockReturnValue(anthropicConverted);

      const response = createJsonResponse(openAIJson);
      const logEntry: any = {};
      const logger = createLogger();
      const provider = {
        customModel: 'claude-3-sonnet',
        realModel: 'gpt-4',
        apiKey: 'x',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const
      };

      const result = await handleMessagesNonStream(response, provider, 'claude-3-sonnet', logEntry, logger);

      expect(result).not.toBeNull();
      expect(result!.responseData).toEqual(anthropicConverted);
      expect(convertOpenAIResponseToAnthropic).toHaveBeenCalledWith(openAIJson, 'claude-3-sonnet');
      expect(logEntry.promptTokens).toBe(100);
      expect(logEntry.completionTokens).toBe(50);
      expect(logEntry.totalTokens).toBe(150);
      expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Converted OpenAI response to Anthropic format'
      }));
    });

    it('extracts cached_tokens from prompt_tokens_details when present', async () => {
      const openAIJson = {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        model: 'gpt-4',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_tokens_details: { cached_tokens: 10 }
        }
      };
      const anthropicConverted = {
        id: 'chatcmpl-test',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-sonnet',
        content: [{ type: 'text', text: 'Hello' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 }
      };

      vi.mocked(convertOpenAIResponseToAnthropic).mockReturnValue(anthropicConverted);

      const response = createJsonResponse(openAIJson);
      const logEntry: any = {};
      const logger = createLogger();
      const provider = {
        customModel: 'claude-3-sonnet',
        realModel: 'gpt-4',
        apiKey: 'x',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const
      };

      const result = await handleMessagesNonStream(response, provider, 'claude-3-sonnet', logEntry, logger);

      expect(result).not.toBeNull();
      expect(logEntry.cachedTokens).toBe(10);
    });

    it('handles missing usage field gracefully', async () => {
      const openAIJson = {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        model: 'gpt-4',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' } }]
      };
      const anthropicConverted = {
        id: 'chatcmpl-test',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-sonnet',
        content: [{ type: 'text', text: 'Hello' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      };

      vi.mocked(convertOpenAIResponseToAnthropic).mockReturnValue(anthropicConverted);

      const response = createJsonResponse(openAIJson);
      const logEntry: any = {};
      const logger = createLogger();
      const provider = {
        customModel: 'claude-3-sonnet',
        realModel: 'gpt-4',
        apiKey: 'x',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const
      };

      const result = await handleMessagesNonStream(response, provider, 'claude-3-sonnet', logEntry, logger);

      expect(result).not.toBeNull();
      expect(result!.responseData).toEqual(anthropicConverted);
      expect(logEntry.promptTokens).toBeUndefined();
      expect(logEntry.completionTokens).toBeUndefined();
    });
  });

  describe('Anthropic provider path', () => {
    it('uses response as-is and extracts tokens from Anthropic format', async () => {
      const anthropicJson = {
        id: 'msg_anthropic',
        model: 'claude-3-sonnet',
        content: [{ type: 'text', text: 'Hello from Claude' }],
        usage: {
          input_tokens: 200,
          output_tokens: 80,
          input_tokens_details: { cached_tokens: 25 }
        }
      };

      const response = createJsonResponse(anthropicJson);
      const logEntry: any = {};
      const logger = createLogger();
      const provider = {
        customModel: 'claude-3-sonnet',
        realModel: 'claude-3-sonnet',
        apiKey: 'x',
        baseUrl: 'https://api.anthropic.com',
        provider: 'anthropic' as const
      };

      const result = await handleMessagesNonStream(response, provider, 'claude-3-sonnet', logEntry, logger);

      expect(result).not.toBeNull();
      expect(result!.responseData).toEqual(anthropicJson);
      expect(logEntry.promptTokens).toBe(200);
      expect(logEntry.completionTokens).toBe(80);
      expect(logEntry.totalTokens).toBe(280);
      expect(logEntry.cachedTokens).toBe(25);
      expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Anthropic non-streaming response'
      }));
    });

    it('handles response without token details', async () => {
      const anthropicJson = {
        id: 'msg_anthropic',
        model: 'claude-3-sonnet',
        content: [{ type: 'text', text: 'Hello' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50
        }
      };

      const response = createJsonResponse(anthropicJson);
      const logEntry: any = {};
      const logger = createLogger();
      const provider = {
        customModel: 'claude-3-sonnet',
        realModel: 'claude-3-sonnet',
        apiKey: 'x',
        baseUrl: 'https://api.anthropic.com',
        provider: 'anthropic' as const
      };

      const result = await handleMessagesNonStream(response, provider, 'claude-3-sonnet', logEntry, logger);

      expect(result).not.toBeNull();
      expect(result!.responseData).toEqual(anthropicJson);
      expect(logEntry.cachedTokens).toBeUndefined();
    });

    it('handles missing usage field gracefully', async () => {
      const anthropicJson = {
        id: 'msg_anthropic',
        model: 'claude-3-sonnet',
        content: [{ type: 'text', text: 'Hello' }]
      };

      const response = createJsonResponse(anthropicJson);
      const logEntry: any = {};
      const logger = createLogger();
      const provider = {
        customModel: 'claude-3-sonnet',
        realModel: 'claude-3-sonnet',
        apiKey: 'x',
        baseUrl: 'https://api.anthropic.com',
        provider: 'anthropic' as const
      };

      const result = await handleMessagesNonStream(response, provider, 'claude-3-sonnet', logEntry, logger);

      expect(result).not.toBeNull();
      expect(result!.responseData).toEqual(anthropicJson);
      expect(logEntry.promptTokens).toBeUndefined();
      expect(logEntry.completionTokens).toBeUndefined();
      expect(logEntry.totalTokens).toBe(0);
    });
  });

  describe('Error path', () => {
    it('returns null on JSON parse failure', async () => {
      const response = new Response('not valid json');
      const logEntry: any = {};
      const logger = createLogger();
      const provider = {
        customModel: 'claude-3-sonnet',
        realModel: 'gpt-4',
        apiKey: 'x',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const
      };

      const result = await handleMessagesNonStream(response, provider, 'claude-3-sonnet', logEntry, logger);

      expect(result).toBeNull();
      expect(logger.log).not.toHaveBeenCalled();
    });
  });
});
