import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleNonStream } from '../../src/routes/chat-completions/non-stream-handler.js';
import { convertAnthropicResponseToOpenAI } from '../../src/converters/openai-to-anthropic.js';

vi.mock('../../src/converters/openai-to-anthropic.js', () => ({
  convertAnthropicResponseToOpenAI: vi.fn()
}));

// ==================== Helpers ====================

function createLogger() {
  return { log: vi.fn() };
}

function createOpenAIResponse(jsonData: any): Response {
  return new Response(JSON.stringify(jsonData), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// ==================== Tests ====================

describe('handleNonStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('OpenAI provider path', () => {
    it('returns response data as-is and extracts token counts', async () => {
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
      const response = createOpenAIResponse(openAIJson);
      const logEntry: any = {};
      const logger = createLogger();
      const provider = {
        customModel: 'gpt-4',
        realModel: 'gpt-4',
        apiKey: 'x',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const
      };

      const result = await handleNonStream(response, provider, 'gpt-4', logEntry, logger);

      expect(result).not.toBeNull();
      expect(result!.responseData).toEqual(openAIJson);
      expect(logEntry.promptTokens).toBe(100);
      expect(logEntry.completionTokens).toBe(50);
      expect(logEntry.totalTokens).toBe(150);
      expect(logger.log).not.toHaveBeenCalled();
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
      const response = createOpenAIResponse(openAIJson);
      const logEntry: any = {};
      const logger = createLogger();
      const provider = {
        customModel: 'gpt-4',
        realModel: 'gpt-4',
        apiKey: 'x',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const
      };

      const result = await handleNonStream(response, provider, 'gpt-4', logEntry, logger);

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
      const response = createOpenAIResponse(openAIJson);
      const logEntry: any = {};
      const logger = createLogger();
      const provider = {
        customModel: 'gpt-4',
        realModel: 'gpt-4',
        apiKey: 'x',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const
      };

      const result = await handleNonStream(response, provider, 'gpt-4', logEntry, logger);

      expect(result).not.toBeNull();
      expect(result!.responseData).toEqual(openAIJson);
      expect(logEntry.promptTokens).toBeUndefined();
      expect(logEntry.completionTokens).toBeUndefined();
    });
  });

  describe('Anthropic provider path', () => {
    it('converts response via convertAnthropicResponseToOpenAI and extracts tokens', async () => {
      const anthropicJson = {
        id: 'msg_anthropic',
        model: 'claude-3-sonnet',
        content: [{ type: 'text', text: 'Hello from Claude' }],
        usage: { input_tokens: 200, output_tokens: 80 }
      };
      const convertedResponse = {
        id: 'msg_anthropic',
        object: 'chat.completion',
        model: 'claude',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello from Claude' } }],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 80,
          total_tokens: 280
        }
      };

      vi.mocked(convertAnthropicResponseToOpenAI).mockReturnValue(convertedResponse);

      const response = createOpenAIResponse(anthropicJson);
      const logEntry: any = {};
      const logger = createLogger();
      const provider = {
        customModel: 'claude',
        realModel: 'claude-3-sonnet',
        apiKey: 'x',
        baseUrl: 'https://api.anthropic.com',
        provider: 'anthropic' as const
      };

      const result = await handleNonStream(response, provider, 'claude', logEntry, logger);

      expect(result).not.toBeNull();
      expect(result!.responseData).toEqual(convertedResponse);
      expect(convertAnthropicResponseToOpenAI).toHaveBeenCalledWith(anthropicJson, 'claude');
      expect(logEntry.promptTokens).toBe(200);
      expect(logEntry.completionTokens).toBe(80);
      expect(logEntry.totalTokens).toBe(280);
      expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Converted Anthropic response to OpenAI format'
      }));
    });
  });

  describe('Error path', () => {
    it('returns null on JSON parse failure', async () => {
      const response = new Response('not valid json');
      const logEntry: any = {};
      const logger = createLogger();
      const provider = {
        customModel: 'gpt-4',
        realModel: 'gpt-4',
        apiKey: 'x',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const
      };

      const result = await handleNonStream(response, provider, 'gpt-4', logEntry, logger);

      expect(result).toBeNull();
      expect(logger.log).not.toHaveBeenCalled();
    });
  });
});
