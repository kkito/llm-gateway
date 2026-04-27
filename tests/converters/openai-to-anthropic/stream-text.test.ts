import { describe, it, expect } from 'vitest';
import { convertOpenAIStreamChunkToAnthropic, createOpenAIToAnthropicStreamState } from '../../../src/converters/openai-to-anthropic.js';

describe('openai-to-anthropic converter - text streaming', () => {
  it('produces complete event sequence for simple text', () => {
    const state = createOpenAIToAnthropicStreamState();
    const allEvents: any[] = [];

    // First chunk (triggers message_start)
    allEvents.push(...convertOpenAIStreamChunkToAnthropic({
      id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 123, model: 'gpt-4',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }]
    }, state));

    // Content chunks
    for (const word of ['world', '!']) {
      allEvents.push(...convertOpenAIStreamChunkToAnthropic({
        id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 123, model: 'gpt-4',
        choices: [{ index: 0, delta: { content: word }, finish_reason: null }]
      }, state));
    }

    // Final chunk
    allEvents.push(...convertOpenAIStreamChunkToAnthropic({
      id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 123, model: 'gpt-4',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    }, state));

    // Verify event sequence
    const types = allEvents.map(e => e.type);
    expect(types).toContain('message_start');
    expect(types).toContain('content_block_start');
    expect(types.filter(e => e === 'content_block_delta').length).toBeGreaterThanOrEqual(1);
    expect(types).toContain('content_block_stop');
    expect(types).toContain('message_delta');
    expect(types).toContain('message_stop');

    // Verify reconstructed text
    const textDeltas = allEvents
      .filter(e => e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
      .map(e => e.delta.text);
    expect(textDeltas.join('')).toContain('Hello');
  });

  it('handles thinking followed by text', () => {
    const state = createOpenAIToAnthropicStreamState();
    state.sentMessageStart = true;

    // Thinking chunk
    const thinkingChunk = {
      id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 123, model: 'gpt-4',
      choices: [{ index: 0, delta: { reasoning_content: 'Let me think...' }, finish_reason: null }]
    };
    let result = convertOpenAIStreamChunkToAnthropic(thinkingChunk, state);
    const thinkingEvents = result.filter(e => e.delta?.type === 'thinking_delta');
    expect(thinkingEvents.length).toBe(1);

    // Text chunk
    const textChunk = {
      id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 123, model: 'gpt-4',
      choices: [{ index: 0, delta: { content: 'Here is the answer.' }, finish_reason: null }]
    };
    result = convertOpenAIStreamChunkToAnthropic(textChunk, state);
    const textEvents = result.filter(e => e.delta?.type === 'text_delta');
    expect(textEvents.length).toBe(1);
    expect(textEvents[0].delta.text).toBe('Here is the answer.');
  });

  it('handles empty content without errors', () => {
    const state = createOpenAIToAnthropicStreamState();
    state.sentMessageStart = true;

    const chunk = {
      id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 123, model: 'gpt-4',
      choices: [{ index: 0, delta: { content: '' }, finish_reason: null }]
    };
    const result = convertOpenAIStreamChunkToAnthropic(chunk, state);
    // Empty content should be skipped
    expect(result.filter(e => e.type === 'content_block_delta')).toHaveLength(0);
  });
});
