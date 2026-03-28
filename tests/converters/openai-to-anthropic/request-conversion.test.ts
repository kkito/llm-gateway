import { describe, it, expect } from 'vitest';
import { convertOpenAIRequestToAnthropic } from '../../../src/converters/openai-to-anthropic.js';

describe('openai-to-anthropic converter - request conversion', () => {
  it('should convert string content to array format', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [{
        role: 'user' as const,
        content: '你好，请介绍一下你自己'
      }],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: '你好，请介绍一下你自己' }]
    });
  });

  it('should convert array content (text blocks)', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [{
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Hello' },
          { type: 'text' as const, text: ' World' }
        ]
      }],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    expect(result.messages[0].content).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' World' }
    ]);
  });

  it('should convert system message', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'system' as const,
          content: 'You are a helpful assistant.'
        },
        {
          role: 'user' as const,
          content: 'Hello'
        }
      ],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    // api.longcat.chat 不支持 system 字段
    expect(result.system).toBeUndefined();
    expect(result.messages).toHaveLength(1);
    // system 内容应合并到第一条 user 消息
    expect(result.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'You are a helpful assistant.\n\n' },
        { type: 'text', text: 'Hello' }
      ]
    });
  });

  it('should convert system message with array content', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'system' as const,
          content: [
            { type: 'text' as const, text: 'You are helpful.' },
            { type: 'text' as const, text: 'Be concise.' }
          ]
        },
        {
          role: 'user' as const,
          content: 'Hello'
        }
      ],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    // api.longcat.chat 不支持 system 字段
    expect(result.system).toBeUndefined();
    // system 内容应合并到第一条 user 消息
    expect(result.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'You are helpful. Be concise.\n\n' },
        { type: 'text', text: 'Hello' }
      ]
    });
  });

  it('should convert tool message to tool_result', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'assistant' as const,
          content: null,
          tool_calls: [{
            id: 'call_123',
            type: 'function' as const,
            function: {
              name: 'get_weather',
              arguments: '{"city": "Beijing"}'
            }
          }]
        },
        {
          role: 'tool' as const,
          content: 'Sunny, 25°C',
          tool_call_id: 'call_123'
        }
      ],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toEqual({
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'call_123',
        content: 'Sunny, 25°C'
      }]
    });
  });

  it('should convert tool message with JSON content', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [{
        role: 'tool' as const,
        content: JSON.stringify({ status: 'success', data: { temp: 25 } }),
        tool_call_id: 'call_123'
      }],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    expect(result.messages[0].content).toEqual([{
      type: 'tool_result',
      tool_use_id: 'call_123',
      content: '{"status":"success","data":{"temp":25}}'
    }]);
  });

  it('should convert assistant message with string content', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [{
        role: 'assistant' as const,
        content: 'Let me check the weather.'
      }],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    // api.longcat.chat 要求：assistant 消息如果只有纯文本内容，省略 content 字段
    expect(result.messages[0]).toEqual({
      role: 'assistant'
    });
  });

  it('should convert assistant message with tool_calls', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [{
        role: 'assistant' as const,
        content: null,
        tool_calls: [{
          id: 'call_123',
          type: 'function' as const,
          function: {
            name: 'get_weather',
            arguments: '{"city": "Beijing"}'
          }
        }]
      }],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    expect(result.messages[0].content).toEqual([{
      type: 'tool_use',
      id: 'call_123',
      name: 'get_weather',
      input: { city: 'Beijing' }
    }]);
  });

  it('should convert assistant message with both text and tool_calls', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [{
        role: 'assistant' as const,
        content: 'Let me check the weather.',
        tool_calls: [{
          id: 'call_123',
          type: 'function' as const,
          function: {
            name: 'get_weather',
            arguments: '{"city": "Beijing"}'
          }
        }]
      }],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    // 包含 tool_calls 时，保留数组格式
    expect(result.messages[0].content).toEqual([
      { type: 'text', text: 'Let me check the weather.' },
      {
        type: 'tool_use',
        id: 'call_123',
        name: 'get_weather',
        input: { city: 'Beijing' }
      }
    ]);
  });

  it('should convert assistant message with only text (api.longcat.chat requirement)', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [{
        role: 'assistant' as const,
        content: 'Hello! How can I help you?'
      }],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    // api.longcat.chat 要求：assistant 消息如果只有纯文本内容，省略 content 字段
    expect(result.messages[0]).toEqual({
      role: 'assistant'
    });
  });

  it('should convert assistant message with empty content', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [{
        role: 'assistant' as const,
        content: null
      }],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    // 空内容时，省略 content 字段
    expect(result.messages[0]).toEqual({
      role: 'assistant'
    });
  });

  it('should convert tools definition', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [{
        role: 'user' as const,
        content: 'What is the weather?'
      }],
      tools: [{
        type: 'function' as const,
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
      }],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    expect(result.tools).toEqual([{
      name: 'get_weather',
      description: 'Get the weather for a city',
      input_schema: {
        type: 'object',
        properties: {
          city: { type: 'string' }
        }
      }
    }]);
  });

  it('should handle stream and temperature parameters', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [{
        role: 'user' as const,
        content: 'Hello'
      }],
      max_tokens: 1024,
      stream: true,
      temperature: 0.7
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    expect(result.stream).toBe(true);
    expect(result.temperature).toBe(0.7);
  });

  it('should handle complete conversation flow', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'system' as const,
          content: 'You are a helpful assistant.'
        },
        {
          role: 'user' as const,
          content: 'What is the weather in Beijing?'
        },
        {
          role: 'assistant' as const,
          content: 'Let me check that for you.',
          tool_calls: [{
            id: 'call_123',
            type: 'function' as const,
            function: {
              name: 'get_weather',
              arguments: '{"city": "Beijing"}'
            }
          }]
        },
        {
          role: 'tool' as const,
          content: 'Sunny, 25°C',
          tool_call_id: 'call_123'
        }
      ],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    // api.longcat.chat 不支持 system 字段，system 内容应合并到第一条 user 消息
    expect(result.system).toBeUndefined();
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'You are a helpful assistant.\n\n' },
        { type: 'text', text: 'What is the weather in Beijing?' }
      ]
    });
    // 包含 tool_calls 和文本时，保留数组格式
    expect(result.messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check that for you.' },
        {
          type: 'tool_use',
          id: 'call_123',
          name: 'get_weather',
          input: { city: 'Beijing' }
        }
      ]
    });
    expect(result.messages[2]).toEqual({
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'call_123',
        content: 'Sunny, 25°C'
      }]
    });
  });

  it('should handle null content', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [{
        role: 'user' as const,
        content: null
      }],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    expect(result.messages[0].content).toEqual([{ type: 'text', text: '' }]);
  });

  it('should handle multi-turn conversation with assistant text messages', async () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'user' as const,
          content: 'hello'
        },
        {
          role: 'assistant' as const,
          content: 'Hello! How can I help you?'
        },
        {
          role: 'user' as const,
          content: 'What is the weather?'
        }
      ],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    expect(result.messages).toHaveLength(3);
    // user 消息使用数组格式
    expect(result.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }]
    });
    // assistant 纯文本消息省略 content 字段（api.longcat.chat 要求）
    expect(result.messages[1]).toEqual({
      role: 'assistant'
    });
    expect(result.messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'What is the weather?' }]
    });
  });

  it('should merge system content into first user message for api.longcat.chat', async () => {
    const openaiRequest = {
      model: 'my-longcat',
      messages: [
        {
          role: 'system' as const,
          content: 'You are a helpful assistant.'
        },
        {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: 'Hello' }]
        }
      ],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    // api.longcat.chat 不支持 system 字段
    expect(result.system).toBeUndefined();
    // system 内容应合并到第一条 user 消息的开头
    expect(result.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'You are a helpful assistant.\n\n' },
        { type: 'text', text: 'Hello' }
      ]
    });
  });

  it('should handle assistant message without content for api.longcat.chat', async () => {
    const openaiRequest = {
      model: 'my-longcat',
      messages: [
        {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: 'context' }]
        },
        {
          role: 'assistant' as const,
          content: '' // 空内容
        },
        {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: 'hello' }]
        }
      ],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    // assistant 消息应该省略 content 字段
    expect(result.messages[1]).toEqual({
      role: 'assistant'
    });
  });

  it('should handle multi-turn conversation with system and empty assistant', async () => {
    const openaiRequest = {
      model: 'my-longcat',
      messages: [
        {
          role: 'system' as const,
          content: 'You are helpful.'
        },
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'part1' },
            { type: 'text' as const, text: 'part2' }
          ]
        },
        {
          role: 'assistant' as const,
          content: null
        },
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'part3' },
            { type: 'text' as const, text: 'part4' }
          ]
        }
      ],
      max_tokens: 1024
    };

    const result = await convertOpenAIRequestToAnthropic(openaiRequest);

    // system 不应出现在返回结果中
    expect(result.system).toBeUndefined();
    // 第一条 user 消息应包含 system 内容
    expect(result.messages[0]!.content).toHaveLength(3);
    expect((result.messages[0]!.content as any)[0]).toEqual({
      type: 'text',
      text: 'You are helpful.\n\n'
    });
    // assistant 消息不应包含 content 字段
    expect(result.messages[1]).toEqual({
      role: 'assistant'
    });
  });
});