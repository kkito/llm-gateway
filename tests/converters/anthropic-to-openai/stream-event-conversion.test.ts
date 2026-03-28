import { describe, it, expect } from 'vitest';
import { convertAnthropicStreamEventToOpenAI } from '../../../src/converters/anthropic-to-openai.js';

describe('anthropic-to-openai converter - stream event conversion', () => {
  const requestId = 'test-request-123';
  const model = 'claude-3-5-sonnet-20241022';

  it('should convert message_start event', () => {
    const event = {
      type: 'message_start' as const,
      message: {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-5-sonnet-20241022',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 }
      }
    };

    const result = convertAnthropicStreamEventToOpenAI(event, requestId, model);

    expect(result).not.toBeNull();
    expect(result?.id).toBe('msg_123');
    expect(result?.object).toBe('chat.completion.chunk');
    expect(result?.choices[0].delta.role).toBe('assistant');
    expect(result?.choices[0].finish_reason).toBeNull();
    expect(result?.usage?.prompt_tokens).toBe(10);
  });

  it('should convert content_block_start event', () => {
    const event = {
      type: 'content_block_start' as const,
      index: 0,
      content_block: { type: 'text' as const }
    };

    const result = convertAnthropicStreamEventToOpenAI(event, requestId, model);

    expect(result).not.toBeNull();
    expect(result?.choices[0].delta.content).toBe('');
    expect(result?.choices[0].finish_reason).toBeNull();
  });

  it('should convert content_block_delta event with text', () => {
    const event = {
      type: 'content_block_delta' as const,
      index: 0,
      delta: { type: 'text_delta' as const, text: 'Hello' }
    };

    const result = convertAnthropicStreamEventToOpenAI(event, requestId, model);

    expect(result).not.toBeNull();
    expect(result?.choices[0].delta.content).toBe('Hello');
    expect(result?.choices[0].finish_reason).toBeNull();
  });

  it('should convert content_block_delta event with empty text', () => {
    const event = {
      type: 'content_block_delta' as const,
      index: 0,
      delta: { type: 'text_delta' as const, text: '' }
    };

    const result = convertAnthropicStreamEventToOpenAI(event, requestId, model);

    expect(result).not.toBeNull();
    expect(result?.choices[0].delta.content).toBe('');
  });

  it('should convert content_block_stop event', () => {
    const event = {
      type: 'content_block_stop' as const,
      index: 0
    };

    const result = convertAnthropicStreamEventToOpenAI(event, requestId, model);

    expect(result).not.toBeNull();
    expect(result?.choices[0].delta).toEqual({});
    expect(result?.choices[0].finish_reason).toBeNull();
  });

  it('should convert message_delta event with end_turn stop_reason', () => {
    const event = {
      type: 'message_delta' as const,
      delta: {
        stop_reason: 'end_turn',
        stop_sequence: null
      },
      usage: { output_tokens: 10 }
    };

    const result = convertAnthropicStreamEventToOpenAI(event, requestId, model);

    expect(result).not.toBeNull();
    expect(result?.choices[0].finish_reason).toBe('stop');
    expect(result?.usage?.completion_tokens).toBe(10);
  });

  it('should convert message_delta event with max_tokens stop_reason', () => {
    const event = {
      type: 'message_delta' as const,
      delta: {
        stop_reason: 'max_tokens',
        stop_sequence: null
      },
      usage: { output_tokens: 100 }
    };

    const result = convertAnthropicStreamEventToOpenAI(event, requestId, model);

    expect(result?.choices[0].finish_reason).toBe('length');
  });

  it('should convert message_delta event with tool_use stop_reason', () => {
    const event = {
      type: 'message_delta' as const,
      delta: {
        stop_reason: 'tool_use',
        stop_sequence: null
      },
      usage: { output_tokens: 5 }
    };

    const result = convertAnthropicStreamEventToOpenAI(event, requestId, model);

    expect(result?.choices[0].finish_reason).toBe('tool_calls');
  });

  it('should convert message_stop event to null', () => {
    const event = {
      type: 'message_stop' as const
    };

    const result = convertAnthropicStreamEventToOpenAI(event, requestId, model);

    expect(result).toBeNull();
  });

  it('should handle unknown event type', () => {
    const event = {
      type: 'unknown_event' as any
    };

    const result = convertAnthropicStreamEventToOpenAI(event, requestId, model);

    expect(result).toBeNull();
  });

  it('should convert full stream of events', () => {
    const events = [
      {
        type: 'message_start' as const,
        message: {
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 }
        }
      },
      { type: 'content_block_start' as const, index: 0, content_block: { type: 'text' as const } },
      { type: 'content_block_delta' as const, index: 0, delta: { type: 'text_delta' as const, text: 'Hello' } },
      { type: 'content_block_delta' as const, index: 0, delta: { type: 'text_delta' as const, text: ' World' } },
      { type: 'content_block_stop' as const, index: 0 },
      { type: 'message_delta' as const, delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
      { type: 'message_stop' as const }
    ];

    const results = events.map(e => convertAnthropicStreamEventToOpenAI(e, requestId, model));

    // message_start
    expect(results[0]?.choices[0].delta.role).toBe('assistant');
    // content_block_start
    expect(results[1]?.choices[0].delta.content).toBe('');
    // content_block_delta 1
    expect(results[2]?.choices[0].delta.content).toBe('Hello');
    // content_block_delta 2
    expect(results[3]?.choices[0].delta.content).toBe(' World');
    // content_block_stop
    expect(results[4]?.choices[0].delta).toEqual({});
    // message_delta
    expect(results[5]?.choices[0].finish_reason).toBe('stop');
    // message_stop
    expect(results[6]).toBeNull();
  });

  it('should include usage in message_start when available', () => {
    const event = {
      type: 'message_start' as const,
      message: {
        id: 'msg_456',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 5 }
      }
    };

    const result = convertAnthropicStreamEventToOpenAI(event, requestId, model);

    expect(result?.usage?.prompt_tokens).toBe(100);
    expect(result?.usage?.completion_tokens).toBe(5);
    expect(result?.usage?.total_tokens).toBe(105);
  });

  it('should not include usage when not available in message_start', () => {
    const event = {
      type: 'message_start' as const,
      message: {
        id: 'msg_789',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null
      }
    };

    const result = convertAnthropicStreamEventToOpenAI(event, requestId, model);

    expect(result?.usage).toBeUndefined();
  });
});