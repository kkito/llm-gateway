import { describe, it, expect } from 'vitest';
import { convertOpenAIStreamChunkToAnthropic, createOpenAIToAnthropicStreamState } from '../../../src/converters/openai-to-anthropic.js';
import type { OpenAIToAnthropicStreamState } from '../../../src/converters/shared/types.js';

describe('openai-to-anthropic converter - stream event conversion', () => {
  function createState(): OpenAIToAnthropicStreamState {
    return createOpenAIToAnthropicStreamState();
  }

  it('sends message_start on first chunk', () => {
    const state = createState();
    const chunk = {
      id: 'chatcmpl-123', object: 'chat.completion.chunk', created: 123, model: 'gpt-4',
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
    };
    const result = convertOpenAIStreamChunkToAnthropic(chunk, state);
    expect(result.some(e => e.type === 'message_start')).toBe(true);
  });

  it('converts text delta to content_block_delta', () => {
    const state = createState();
    state.sentMessageStart = true;
    const chunk = {
      id: 'chatcmpl-123', object: 'chat.completion.chunk', created: 123, model: 'gpt-4',
      choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }]
    };
    const result = convertOpenAIStreamChunkToAnthropic(chunk, state);
    const textEvent = result.find(e => e.type === 'content_block_delta' && e.delta?.type === 'text_delta');
    expect(textEvent).toBeDefined();
    expect(textEvent?.delta?.text).toBe('Hello');
  });

  it('converts tool_calls to tool_use with input_json_delta', () => {
    const state = createState();
    state.sentMessageStart = true;
    const chunk = {
      id: 'chatcmpl-123', object: 'chat.completion.chunk', created: 123, model: 'gpt-4',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0, id: 'call_123', type: 'function',
            function: { name: 'search', arguments: '{"q": "he' }
          }]
        },
        finish_reason: null
      }]
    };
    const result = convertOpenAIStreamChunkToAnthropic(chunk, state);
    const toolEvent = result.find(e => e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta');
    expect(toolEvent).toBeDefined();
    expect(toolEvent?.delta?.partial_json).toBe('{"q": "he');
  });

  it('handles parallel tool calls (multiple tool_calls in one chunk)', () => {
    const state = createState();
    state.sentMessageStart = true;
    const chunk = {
      id: 'chatcmpl-123', object: 'chat.completion.chunk', created: 123, model: 'gpt-4',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"q": "a"}' } },
            { index: 1, id: 'call_2', type: 'function', function: { name: 'read', arguments: '{"f": "b"}' } }
          ]
        },
        finish_reason: null
      }]
    };
    const result = convertOpenAIStreamChunkToAnthropic(chunk, state);
    const toolEvents = result.filter(e => e.type === 'content_block_start' && e.content_block?.type === 'tool_use');
    expect(toolEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('converts finish_reason to message_delta + message_stop', () => {
    const state = createState();
    state.sentMessageStart = true;
    state.sentContentBlockStart = true;
    const chunk = {
      id: 'chatcmpl-123', object: 'chat.completion.chunk', created: 123, model: 'gpt-4',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    };
    const result = convertOpenAIStreamChunkToAnthropic(chunk, state);
    expect(result.some(e => e.type === 'message_delta')).toBe(true);
    expect(result.some(e => e.type === 'message_stop')).toBe(true);
  });

  it('handles refusal field as text content', () => {
    const state = createState();
    state.sentMessageStart = true;
    const chunk = {
      id: 'chatcmpl-123', object: 'chat.completion.chunk', created: 123, model: 'gpt-4',
      choices: [{ index: 0, delta: { refusal: 'I cannot help with that.' }, finish_reason: null }]
    };
    const result = convertOpenAIStreamChunkToAnthropic(chunk, state);
    const textEvent = result.find(e => e.type === 'content_block_delta' && e.delta?.text === 'I cannot help with that.');
    expect(textEvent).toBeDefined();
  });

  it('processes all reasoning_details elements', () => {
    const state = createState();
    state.sentMessageStart = true;
    const chunk = {
      id: 'chatcmpl-123', object: 'chat.completion.chunk', created: 123, model: 'gpt-4',
      choices: [{
        index: 0,
        delta: {
          reasoning_details: [
            { text: 'First thought.' },
            { text: ' Second thought.' }
          ]
        },
        finish_reason: null
      }]
    };
    const result = convertOpenAIStreamChunkToAnthropic(chunk, state);
    const thinkingEvents = result.filter(e => e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta');
    expect(thinkingEvents.some(e => e.delta?.thinking === 'First thought.')).toBe(true);
    expect(thinkingEvents.some(e => e.delta?.thinking === ' Second thought.')).toBe(true);
  });

  it('handles usage in finish chunk', () => {
    const state = createState();
    state.sentMessageStart = true;
    state.sentContentBlockStart = true;
    const chunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk' as const,
      created: 123,
      model: 'gpt-4',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
    };
    const result = convertOpenAIStreamChunkToAnthropic(chunk, state);
    const deltaEvent = result.find(e => e.type === 'message_delta');
    expect(deltaEvent?.usage).toBeDefined();
    expect(deltaEvent?.usage?.input_tokens).toBe(10);
    expect(deltaEvent?.usage?.output_tokens).toBe(20);
  });
});
