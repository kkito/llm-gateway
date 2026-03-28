import { describe, it, expect } from 'vitest';
import { convertAnthropicResponseToOpenAI } from '../../../src/converters/openai-to-anthropic.js';

describe('openai-to-anthropic converter - response conversion', () => {
  it('should convert simple text response', () => {
    const anthropicResponse = {
      id: 'msg_123',
      type: 'message' as const,
      role: 'assistant' as const,
      model: 'claude-3-5-sonnet-20241022',
      content: [{ type: 'text' as const, text: 'Hello, world!' }],
      stop_reason: 'end_turn' as const,
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 5
      }
    };

    const result = convertAnthropicResponseToOpenAI(anthropicResponse);

    expect(result.id).toBe('msg_123');
    expect(result.model).toBe('claude-3-5-sonnet-20241022');
    expect(result.choices[0].message.content).toBe('Hello, world!');
    expect(result.choices[0].finish_reason).toBe('stop');
    expect(result.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15
    });
  });

  it('should convert tool_use response', () => {
    const anthropicResponse = {
      id: 'msg_456',
      type: 'message' as const,
      role: 'assistant' as const,
      model: 'claude-3-5-sonnet-20241022',
      content: [{
        type: 'tool_use' as const,
        id: 'toolu_123',
        name: 'get_weather',
        input: { city: 'Beijing' }
      }],
      stop_reason: 'tool_use' as const,
      stop_sequence: null,
      usage: {
        input_tokens: 20,
        output_tokens: 10
      }
    };

    const result = convertAnthropicResponseToOpenAI(anthropicResponse);

    expect(result.choices[0].message.content).toBe(null);
    expect(result.choices[0].message.tool_calls).toEqual([{
      id: 'toolu_123',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: '{"city":"Beijing"}'
      }
    }]);
    expect(result.choices[0].finish_reason).toBe('tool_calls');
  });

  it('should convert response with both text and tool_use', () => {
    const anthropicResponse = {
      id: 'msg_789',
      type: 'message' as const,
      role: 'assistant' as const,
      model: 'claude-3-5-sonnet-20241022',
      content: [
        { type: 'text' as const, text: 'Let me check the weather.' },
        {
          type: 'tool_use' as const,
          id: 'toolu_123',
          name: 'get_weather',
          input: { city: 'Beijing' }
        }
      ],
      stop_reason: 'tool_use' as const,
      stop_sequence: null,
      usage: {
        input_tokens: 25,
        output_tokens: 15
      }
    };

    const result = convertAnthropicResponseToOpenAI(anthropicResponse);

    expect(result.choices[0].message.content).toBe('Let me check the weather.');
    expect(result.choices[0].message.tool_calls).toEqual([{
      id: 'toolu_123',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: '{"city":"Beijing"}'
      }
    }]);
  });

  it('should map stop_reason to finish_reason', () => {
    const baseResponse = {
      id: 'test',
      type: 'message' as const,
      role: 'assistant' as const,
      model: 'claude-3',
      content: [{ type: 'text' as const, text: 'test' }],
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 }
    };

    expect(convertAnthropicResponseToOpenAI({
      ...baseResponse,
      stop_reason: 'end_turn' as const
    }).choices[0].finish_reason).toBe('stop');

    expect(convertAnthropicResponseToOpenAI({
      ...baseResponse,
      stop_reason: 'max_tokens' as const
    }).choices[0].finish_reason).toBe('length');

    expect(convertAnthropicResponseToOpenAI({
      ...baseResponse,
      stop_reason: 'tool_use' as const
    }).choices[0].finish_reason).toBe('tool_calls');

    expect(convertAnthropicResponseToOpenAI({
      ...baseResponse,
      stop_reason: 'stop_sequence' as const
    }).choices[0].finish_reason).toBe('stop');
  });
});