/**
 * 转换器测试 - 测试 Anthropic ↔ OpenAI 格式转换
 */

import { describe, it, expect } from 'vitest';
import {
  convertAnthropicRequestToOpenAI,
  convertOpenAIResponseToAnthropic,
  convertAnthropicStreamEventToOpenAI,
  parseSSEBlock,
  createStreamConverterState
} from '../src/converters/anthropic-to-openai.js';
import {
  convertOpenAIRequestToAnthropic,
  convertAnthropicResponseToOpenAI,
  convertOpenAIStreamChunkToAnthropic,
  formatAnthropicEventToSSE,
  createOpenAIToAnthropicStreamState
} from '../src/converters/openai-to-anthropic.js';

// ==================== Anthropic Request → OpenAI Request 测试 ====================

describe('convertAnthropicRequestToOpenAI', () => {
  it('should convert simple text message', () => {
    const anthropicRequest = {
      model: 'claude-3-sonnet-20240229',
      messages: [
        {
          role: 'user' as const,
          content: 'Hello'
        }
      ],
      max_tokens: 1024,
      stream: false
    };

    const openaiRequest = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(openaiRequest.model).toBe('claude-3-sonnet-20240229');
    expect(openaiRequest.messages).toHaveLength(1);
    expect(openaiRequest.messages[0]).toEqual({
      role: 'user',
      content: 'Hello'
    });
  });

  it('should convert system message', () => {
    const anthropicRequest = {
      model: 'claude-3-sonnet-20240229',
      messages: [
        {
          role: 'user' as const,
          content: 'Hello'
        }
      ],
      system: 'You are a helpful assistant',
      max_tokens: 1024
    };

    const openaiRequest = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(openaiRequest.messages[0]).toEqual({
      role: 'system',
      content: 'You are a helpful assistant'
    });
  });

  it('should convert tool_use to tool_calls', () => {
    const anthropicRequest = {
      model: 'claude-3-sonnet-20240229',
      messages: [
        {
          role: 'assistant' as const,
          content: [
            {
              type: 'text' as const,
              text: 'Let me check the weather'
            },
            {
              type: 'tool_use' as const,
              id: 'toolu_123',
              name: 'get_weather',
              input: { location: 'Tokyo' }
            }
          ]
        }
      ],
      max_tokens: 1024
    };

    const openaiRequest = convertAnthropicRequestToOpenAI(anthropicRequest);

    expect(openaiRequest.messages[0].role).toBe('assistant');
    expect(openaiRequest.messages[0].tool_calls).toBeDefined();
    expect(openaiRequest.messages[0].tool_calls![0]).toEqual({
      id: 'toolu_123',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: JSON.stringify({ location: 'Tokyo' })
      }
    });
  });
});

// ==================== OpenAI Response → Anthropic Response 测试 ====================

describe('convertOpenAIResponseToAnthropic', () => {
  it('should convert simple text response', () => {
    const openaiResponse = {
      id: 'chatcmpl-123',
      model: 'gpt-4',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Hello! How can I help you?'
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30
      }
    };

    const anthropicResponse = convertOpenAIResponseToAnthropic(openaiResponse, 'claude-3-sonnet-20240229');

    expect(anthropicResponse.id).toBe('chatcmpl-123');
    expect(anthropicResponse.model).toBe('claude-3-sonnet-20240229');
    expect(anthropicResponse.content).toEqual([
      {
        type: 'text',
        text: 'Hello! How can I help you?'
      }
    ]);
    expect(anthropicResponse.stop_reason).toBe('end_turn');
  });

  it('should convert tool_calls to tool_use', () => {
    const openaiResponse = {
      id: 'chatcmpl-123',
      model: 'gpt-4',
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location": "Tokyo"}'
                }
              }
            ]
          },
          finish_reason: 'tool_calls'
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30
      }
    };

    const anthropicResponse = convertOpenAIResponseToAnthropic(openaiResponse);

    expect(anthropicResponse.content).toEqual([
      {
        type: 'tool_use',
        id: 'call_123',
        name: 'get_weather',
        input: { location: 'Tokyo' }
      }
    ]);
    expect(anthropicResponse.stop_reason).toBe('tool_use');
  });
});

// ==================== Anthropic Stream → OpenAI Stream 测试 ====================

describe('convertAnthropicStreamEventToOpenAI', () => {
  it('should convert message_start event', () => {
    const event = {
      type: 'message_start' as const,
      message: {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-sonnet-20240229',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 0
        }
      }
    };

    const state = createStreamConverterState();
    const result = convertAnthropicStreamEventToOpenAI(event, 'req_123', 'claude-3-sonnet-20240229', state);

    expect(result).toBeDefined();
    expect(result?.choices[0].delta.role).toBe('assistant');
    expect(result?.usage?.prompt_tokens).toBe(10);
  });

  it('should convert content_block_start event for text', () => {
    const event = {
      type: 'content_block_start' as const,
      index: 0,
      content_block: {
        type: 'text' as const,
        text: ''
      }
    };

    const state = createStreamConverterState();
    const result = convertAnthropicStreamEventToOpenAI(event, 'req_123', 'claude-3-sonnet-20240229', state);

    expect(result).toBeDefined();
    expect(result?.choices[0].delta.content).toBe('');
  });

  it('should convert content_block_start event for tool_use', () => {
    const event = {
      type: 'content_block_start' as const,
      index: 0,
      content_block: {
        type: 'tool_use' as const,
        id: 'toolu_123',
        name: 'get_weather',
        input: {}
      }
    };

    const state = createStreamConverterState();
    const result = convertAnthropicStreamEventToOpenAI(event, 'req_123', 'claude-3-sonnet-20240229', state);

    expect(result).toBeDefined();
    expect(result?.choices[0].delta.tool_calls).toBeDefined();
    expect(result?.choices[0].delta.tool_calls![0]).toEqual({
      index: 0,
      id: 'toolu_123',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: ''
      }
    });
  });

  it('should convert text_delta event', () => {
    const event = {
      type: 'content_block_delta' as const,
      index: 0,
      delta: {
        type: 'text_delta' as const,
        text: 'Hello'
      }
    };

    const state = createStreamConverterState();
    const result = convertAnthropicStreamEventToOpenAI(event, 'req_123', 'claude-3-sonnet-20240229', state);

    expect(result).toBeDefined();
    expect(result?.choices[0].delta.content).toBe('Hello');
  });

  it('should convert input_json_delta event', () => {
    const event = {
      type: 'content_block_delta' as const,
      index: 0,
      delta: {
        type: 'input_json_delta' as const,
        partial_json: '{"location":'
      }
    };

    const state = createStreamConverterState();
    // 先发送 tool_use start
    convertAnthropicStreamEventToOpenAI({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'toolu_123',
        name: 'get_weather',
        input: {}
      }
    }, 'req_123', 'claude-3-sonnet-20240229', state);

    const result = convertAnthropicStreamEventToOpenAI(event, 'req_123', 'claude-3-sonnet-20240229', state);

    expect(result).toBeDefined();
    expect(result?.choices[0].delta.tool_calls).toBeDefined();
    expect(result?.choices[0].delta.tool_calls![0].function.arguments).toBe('{"location":');
  });

  it('should convert message_delta event with usage', () => {
    const event = {
      type: 'message_delta' as const,
      delta: {
        stop_reason: 'end_turn',
        stop_sequence: null
      },
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_creation_input_tokens: 5
      }
    };

    const state = createStreamConverterState();
    const result = convertAnthropicStreamEventToOpenAI(event, 'req_123', 'claude-3-sonnet-20240229', state);

    expect(result).toBeDefined();
    expect(result?.choices[0].finish_reason).toBe('stop');
    expect(result?.usage?.completion_tokens).toBe(20);
    expect(result?.usage?.prompt_tokens_details?.cached_tokens).toBe(5);
  });
});

// ==================== parseSSEBlock 测试 ====================

describe('parseSSEBlock', () => {
  it('should parse SSE block with event and data', () => {
    const sseBlock = 'event: message_start\ndata: {"type": "message_start", "message": {}}\n\n';
    
    const results = parseSSEBlock(sseBlock);
    
    expect(results).toHaveLength(1);
    expect(results[0].event).toBe('message_start');
    expect(results[0].data.type).toBe('message_start');
  });

  it('should parse SSE block with only data', () => {
    const sseBlock = 'data: {"type": "content_block_delta"}\n\n';
    
    const results = parseSSEBlock(sseBlock);
    
    expect(results).toHaveLength(1);
    expect(results[0].event).toBeUndefined();
    expect(results[0].data.type).toBe('content_block_delta');
  });

  it('should parse multiple SSE events in one block', () => {
    const sseBlock = 'event: message_start\ndata: {"type": "message_start"}\n\n' +
                     'event: content_block_start\ndata: {"type": "content_block_start"}\n\n';
    
    const results = parseSSEBlock(sseBlock);
    
    expect(results).toHaveLength(2);
    expect(results[0].event).toBe('message_start');
    expect(results[1].event).toBe('content_block_start');
  });
});

// ==================== OpenAI Stream → Anthropic Stream 测试 ====================

describe('convertOpenAIStreamChunkToAnthropic', () => {
  it('should create message_start on first chunk', () => {
    const chunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk' as const,
      created: 1234567890,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant'
          },
          finish_reason: null
        }
      ]
    };

    const state = createOpenAIToAnthropicStreamState();
    const events = convertOpenAIStreamChunkToAnthropic(chunk, state);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('message_start');
    expect(events[0].message?.role).toBe('assistant');
  });

  it('should convert text content delta', () => {
    const chunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk' as const,
      created: 1234567890,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          delta: {
            content: 'Hello'
          },
          finish_reason: null
        }
      ]
    };

    const state = createOpenAIToAnthropicStreamState();
    const events = convertOpenAIStreamChunkToAnthropic(chunk, state);

    // 应该包含 message_start, content_block_start, content_block_delta
    expect(events.length).toBeGreaterThanOrEqual(1);
    const deltaEvent = events.find(e => e.type === 'content_block_delta');
    expect(deltaEvent).toBeDefined();
    expect(deltaEvent?.delta?.text).toBe('Hello');
  });

  it('should convert tool_calls delta', () => {
    const chunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk' as const,
      created: 1234567890,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_123',
                type: 'function' as const,
                function: {
                  name: 'get_weather',
                  arguments: '{"location":'
                }
              }
            ]
          },
          finish_reason: null
        }
      ]
    };

    const state = createOpenAIToAnthropicStreamState();
    const events = convertOpenAIStreamChunkToAnthropic(chunk, state);

    // 应该包含 message_start, content_block_start (tool_use), content_block_delta (input_json_delta)
    expect(events.length).toBeGreaterThanOrEqual(2);
    const toolStartEvent = events.find(e => e.type === 'content_block_start' && e.content_block?.type === 'tool_use');
    expect(toolStartEvent).toBeDefined();
    
    const jsonDeltaEvent = events.find(e => e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta');
    expect(jsonDeltaEvent).toBeDefined();
    expect(jsonDeltaEvent?.delta?.partial_json).toBe('{"location":');
  });

  it('should handle finish_reason', () => {
    const chunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk' as const,
      created: 1234567890,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30
      }
    };

    const state = createOpenAIToAnthropicStreamState();
    // 先发送一些内容
    convertOpenAIStreamChunkToAnthropic({
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk' as const,
      created: 1234567890,
      model: 'gpt-4',
      choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }]
    }, state);

    const events = convertOpenAIStreamChunkToAnthropic(chunk, state);

    // 应该包含 content_block_stop, message_delta, message_stop
    expect(events.some(e => e.type === 'content_block_stop')).toBe(true);
    expect(events.some(e => e.type === 'message_delta')).toBe(true);
    expect(events.some(e => e.type === 'message_stop')).toBe(true);
    
    const messageDelta = events.find(e => e.type === 'message_delta');
    expect(messageDelta?.delta?.stop_reason).toBe('end_turn');
  });
});

// ==================== formatAnthropicEventToSSE 测试 ====================

describe('formatAnthropicEventToSSE', () => {
  it('should format event to SSE format', () => {
    const event = {
      type: 'message_start' as const,
      message: {
        id: 'msg_123',
        type: 'message' as const,
        role: 'assistant' as const,
        model: 'claude-3-sonnet-20240229',
        content: [],
        stop_reason: null,
        stop_sequence: null
      }
    };

    const sse = formatAnthropicEventToSSE(event);

    expect(sse).toContain('event: message_start');
    expect(sse).toContain('data: {"type":"message_start"');
    expect(sse).toMatch(/\n\n$/);
  });
});
