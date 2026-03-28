import { describe, it, expect } from 'vitest';
import { convertAnthropicRequestToOpenAI } from '../../../src/converters/anthropic-to-openai.js';

describe('anthropic-to-openai converter - request conversion', () => {
  it('should convert simple text request', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'user' as const,
        content: 'Hello, Claude!'
      }],
      max_tokens: 1024
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.model).toBe('claude-3-5-sonnet-20241022');
    expect(result.messages).toEqual([{ role: 'user', content: 'Hello, Claude!' }]);
    expect(result.max_tokens).toBe(1024);
  });

  it('should convert system field to system message', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'user' as const,
        content: 'What is 2+2?'
      }],
      system: 'You are a helpful assistant.',
      max_tokens: 1024
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({
      role: 'system',
      content: 'You are a helpful assistant.'
    });
  });

  it('should convert system array field with cache_control', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'user' as const,
        content: 'What is 2+2?'
      }],
      system: [
        { type: 'text' as const, text: 'You are helpful.', cache_control: { type: 'ephemeral' as const } },
        { type: 'text' as const, text: 'Answer concisely.' }
      ],
      max_tokens: 1024
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.messages[0]).toEqual({
      role: 'system',
      content: 'You are helpful. Answer concisely.'
    });
  });

  it('should convert tools definition', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'user' as const,
        content: 'What is the weather?'
      }],
      tools: [{
        name: 'get_weather',
        description: 'Get the weather for a city',
        input_schema: {
          type: 'object',
          properties: {
            city: { type: 'string' }
          }
        }
      }],
      max_tokens: 1024
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.tools).toHaveLength(1);
    expect(result.tools?.[0]).toEqual({
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the weather for a city',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string' }
          }
        }
      }
    });
  });

  it('should handle stream parameter', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'user' as const,
        content: 'Hello'
      }],
      max_tokens: 1024,
      stream: true
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.stream).toBe(true);
  });

  it('should convert assistant message with tool_use blocks', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: 'Let me check the weather.' },
          {
            type: 'tool_use' as const,
            id: 'toolu_123',
            name: 'get_weather',
            input: { city: 'Beijing' }
          }
        ]
      }],
      max_tokens: 1024
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      role: 'assistant',
      content: 'Let me check the weather.',
      tool_calls: [{
        id: 'toolu_123',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"city":"Beijing"}'
        }
      }]
    });
  });

  it('should set content to null when only tool_calls', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'assistant' as const,
        content: [
          {
            type: 'tool_use' as const,
            id: 'toolu_123',
            name: 'get_weather',
            input: { city: 'Beijing' }
          }
        ]
      }],
      max_tokens: 1024
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.messages[0].content).toBe(null);
    expect(result.messages[0].tool_calls).toHaveLength(1);
  });

  it('should convert user message with tool_result', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'user' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: 'toolu_123',
            content: 'The weather is sunny.'
          }
        ]
      }],
      max_tokens: 1024
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      role: 'tool',
      content: 'The weather is sunny.',
      tool_call_id: 'toolu_123'
    });
  });

  it('should group multiple tool_results by tool_use_id', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'user' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: 'toolu_123',
            content: 'Result A'
          },
          {
            type: 'tool_result' as const,
            tool_use_id: 'toolu_123',
            content: 'Result B'
          },
          {
            type: 'tool_result' as const,
            tool_use_id: 'toolu_456',
            content: 'Result C'
          }
        ]
      }],
      max_tokens: 1024
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({
      role: 'tool',
      content: 'Result A\nResult B',
      tool_call_id: 'toolu_123'
    });
    expect(result.messages[1]).toEqual({
      role: 'tool',
      content: 'Result C',
      tool_call_id: 'toolu_456'
    });
  });

  it('should handle tool_result with JSON content', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'user' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: 'toolu_123',
            content: { status: 'success', data: { temp: 25 } }
          }
        ]
      }],
      max_tokens: 1024
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.messages[0].content).toBe('{"status":"success","data":{"temp":25}}');
  });

  it('should handle empty tool_result content', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'user' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: 'toolu_123',
            content: ''
          }
        ]
      }],
      max_tokens: 1024
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.messages[0].content).toBe('No output');
  });

  it('should separate tool_result and text content in user message', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Here is the result:' },
          {
            type: 'tool_result' as const,
            tool_use_id: 'toolu_123',
            content: 'Sunny'
          }
        ]
      }],
      max_tokens: 1024
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({
      role: 'tool',
      content: 'Sunny',
      tool_call_id: 'toolu_123'
    });
    expect(result.messages[1]).toEqual({
      role: 'user',
      content: 'Here is the result:'
    });
  });

  it('should convert user message with text content blocks', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Hello' },
          { type: 'text' as const, text: ' World' }
        ]
      }],
      max_tokens: 1024
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.messages[0].content).toBe('Hello World');
  });

  it('should handle multiple tool_use in assistant message', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'assistant' as const,
        content: [
          {
            type: 'tool_use' as const,
            id: 'toolu_1',
            name: 'tool1',
            input: { a: 1 }
          },
          {
            type: 'tool_use' as const,
            id: 'toolu_2',
            name: 'tool2',
            input: { b: 2 }
          }
        ]
      }],
      max_tokens: 1024
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.messages[0].tool_calls).toHaveLength(2);
    expect(result.messages[0].tool_calls?.[0]).toEqual({
      id: 'toolu_1',
      type: 'function',
      function: {
        name: 'tool1',
        arguments: '{"a":1}'
      }
    });
    expect(result.messages[0].tool_calls?.[1]).toEqual({
      id: 'toolu_2',
      type: 'function',
      function: {
        name: 'tool2',
        arguments: '{"b":2}'
      }
    });
  });

  it('should handle empty input in tool_use', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'assistant' as const,
        content: [{
          type: 'tool_use' as const,
          id: 'toolu_123',
          name: 'simple_tool'
        }]
      }],
      max_tokens: 1024
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.messages[0].tool_calls?.[0].function.arguments).toBe('{}');
  });

  it('should handle temperature parameter', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'user' as const,
        content: 'Hello'
      }],
      max_tokens: 1024,
      temperature: 0.7
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.temperature).toBe(0.7);
  });

  it('should handle complete conversation flow', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      system: 'You are a helpful assistant.',
      messages: [
        {
          role: 'user' as const,
          content: 'What is the weather in Beijing?'
        },
        {
          role: 'assistant' as const,
          content: [{
            type: 'tool_use' as const,
            id: 'toolu_123',
            name: 'get_weather',
            input: { city: 'Beijing' }
          }]
        },
        {
          role: 'user' as const,
          content: [{
            type: 'tool_result' as const,
            tool_use_id: 'toolu_123',
            content: 'Sunny, 25°C'
          }]
        }
      ],
      max_tokens: 1024
    };

    const result = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(result.messages).toHaveLength(4);
    expect(result.messages[0]).toEqual({
      role: 'system',
      content: 'You are a helpful assistant.'
    });
    expect(result.messages[1]).toEqual({
      role: 'user',
      content: 'What is the weather in Beijing?'
    });
    expect(result.messages[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'toolu_123',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"city":"Beijing"}'
        }
      }]
    });
    expect(result.messages[3]).toEqual({
      role: 'tool',
      content: 'Sunny, 25°C',
      tool_call_id: 'toolu_123'
    });
  });
});