import { openAIChatAdapter } from '@/hub/adapters/openai-chat';

describe('openAIChatAdapter', () => {
  describe('formatName', () => {
    it('should be "openai-chat"', () => {
      expect(openAIChatAdapter.formatName).toBe('openai-chat');
    });
  });

  describe('isNativeProvider', () => {
    it('should return true for openai provider', () => {
      expect(openAIChatAdapter.isNativeProvider('openai')).toBe(true);
    });

    it('should return false for anthropic provider', () => {
      expect(openAIChatAdapter.isNativeProvider('anthropic')).toBe(false);
    });
  });

  describe('toHubRequest', () => {
    it('should pass through OpenAI format body unchanged', async () => {
      const body = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
        stream: false,
        temperature: 0.7,
      };

      const result = await openAIChatAdapter.toHubRequest(body);
      expect(result).toEqual(body);
    });

    it('should deep clone to avoid mutation', async () => {
      const body = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = await openAIChatAdapter.toHubRequest(body);
      body.messages[0].content = 'mutated';
      expect(result.messages[0].content).toBe('Hello');
    });
  });

  describe('fromHubResponse', () => {
    it('should pass through OpenAI format response unchanged', () => {
      const response = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1700000000,
        model: 'gpt-4',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      const result = openAIChatAdapter.fromHubResponse(response, 'gpt-4');
      expect(result).toEqual(response);
    });
  });

  describe('toStreamHubRequest', () => {
    it('should add stream_options when stream is true', () => {
      const body = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      };

      const result = openAIChatAdapter.toStreamHubRequest(body);
      expect(result).toEqual({
        ...body,
        stream_options: { include_usage: true },
      });
    });

    it('should return body unchanged when stream is false', () => {
      const body = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      };

      const result = openAIChatAdapter.toStreamHubRequest(body);
      expect(result).toEqual(body);
    });
  });

  describe('fromStreamHubResponse', () => {
    it('should return the input SSE chunk unchanged', () => {
      const sseChunk = 'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"}}]}\n\n';
      const result = openAIChatAdapter.fromStreamHubResponse(sseChunk);
      expect(result).toEqual([sseChunk]);
    });
  });

  describe('extractStreamUsage', () => {
    it('should extract OpenAI usage from chunks', () => {
      const chunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      ];

      const result = openAIChatAdapter.extractStreamUsage(chunks);
      expect(result).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it('should return null when no usage found', () => {
      const chunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"}}]}\n\n',
      ];

      const result = openAIChatAdapter.extractStreamUsage(chunks);
      expect(result).toBeNull();
    });
  });
});
