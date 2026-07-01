import { anthropicMessagesAdapter } from '@/hub/adapters/anthropic-messages';

describe('anthropicMessagesAdapter', () => {
  describe('formatName', () => {
    it('should be "anthropic-messages"', () => {
      expect(anthropicMessagesAdapter.formatName).toBe('anthropic-messages');
    });
  });

  describe('isNativeProvider', () => {
    it('should return true for anthropic provider', () => {
      expect(anthropicMessagesAdapter.isNativeProvider('anthropic')).toBe(true);
    });

    it('should return false for openai provider', () => {
      expect(anthropicMessagesAdapter.isNativeProvider('openai')).toBe(false);
    });
  });

  describe('toHubRequest', () => {
    it('should convert Anthropic request to OpenAI Chat format', async () => {
      const body = {
        model: 'claude-3',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
          { role: 'user', content: 'How are you?' },
        ],
        max_tokens: 1024,
        stream: false,
        temperature: 0.7,
      };

      const result = await anthropicMessagesAdapter.toHubRequest(body);
      expect(result.model).toBe('claude-3');
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(result.max_tokens).toBe(1024);
    });

    it('should handle system message', async () => {
      const body = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Hello' }],
        system: 'You are helpful',
        max_tokens: 1024,
      };

      const result = await anthropicMessagesAdapter.toHubRequest(body);
      expect(result.messages[0]).toEqual({ role: 'system', content: 'You are helpful' });
    });
  });

  describe('fromHubResponse', () => {
    it('should convert OpenAI Chat response to Anthropic Messages format', () => {
      const hubResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        model: 'gpt-4',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      const result = anthropicMessagesAdapter.fromHubResponse(hubResponse, 'claude-3');
      expect(result.type).toBe('message');
      expect(result.role).toBe('assistant');
      expect(result.model).toBe('claude-3');
      expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }]);
      expect(result.stop_reason).toBe('end_turn');
      expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
    });

    it('should convert tool_calls to tool_use content blocks', () => {
      const hubResponse = {
        id: 'chatcmpl-123',
        model: 'gpt-4',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"NYC"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      const result = anthropicMessagesAdapter.fromHubResponse(hubResponse, 'claude-3');
      expect(result.content).toEqual([{
        type: 'tool_use',
        id: 'call_123',
        name: 'get_weather',
        input: { city: 'NYC' },
      }]);
      expect(result.stop_reason).toBe('tool_use');
    });
  });

  describe('toStreamHubRequest', () => {
    it('should return body unchanged (stream flag is already in body)', () => {
      const body = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      };

      const result = anthropicMessagesAdapter.toStreamHubRequest(body);
      expect(result).toEqual(body);
    });
  });

  describe('fromStreamHubResponse', () => {
    it('should convert OpenAI SSE chunks to Anthropic SSE format', () => {
      const state = anthropicMessagesAdapter.createStreamState?.();
      const sseChunk = 'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n';
      const result = anthropicMessagesAdapter.fromStreamHubResponse(sseChunk, state);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toContain('event: message_start');
    });
  });

  describe('extractStreamUsage', () => {
    it('should extract Anthropic-format usage from chunks', () => {
      const chunks = [
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":10,"output_tokens":5}}\n\n',
      ];

      const result = anthropicMessagesAdapter.extractStreamUsage(chunks);
      expect(result).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });
  });
});
