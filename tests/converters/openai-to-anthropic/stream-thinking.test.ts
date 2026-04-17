/**
 * OpenAI → Anthropic 流式转换测试 - Thinking/Reasoning 支持
 * 
 * 测试文档：https://www.asktable.com/zh-CN/blog/2026-03-04/message-format-converter-openai-anthropic
 * 
 * Thinking Block 支持多种格式：
 * - OpenAI o1 格式：delta.reasoning_details = [{text: "..."}]
 * - OpenRouter 格式：delta.reasoning = "..."
 * - Qwen 格式：delta.reasoning_content = "..."
 * - MiniMax 格式：同时返回 delta.reasoning 和 delta.reasoning_content 和 delta.content
 */

import { describe, it, expect } from 'vitest';
import { convertOpenAIStreamChunkToAnthropic, createOpenAIToAnthropicStreamState } from '../../../src/converters/openai-to-anthropic.js';

describe('openai-to-anthropic converter - thinking/reasoning support', () => {
  const state = createOpenAIToAnthropicStreamState();

  it('should handle OpenAI o1 format with reasoning_details', () => {
    const chunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'o1-preview',
      choices: [{
        index: 0,
        delta: {
          reasoning_details: [{ text: 'Let me think about this...' }]
        },
        finish_reason: null
      }]
    } as any;

    const events = convertOpenAIStreamChunkToAnthropic(chunk, state);

    expect(events.length).toBeGreaterThan(0);
    
    // 应该开始 thinking block
    const thinkingStartEvent = events.find(e => e.type === 'content_block_start' && (e.content_block as any)?.type === 'thinking');
    expect(thinkingStartEvent).toBeDefined();

    // 应该包含 thinking delta
    const thinkingDeltaEvent = events.find(e => e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta');
    expect(thinkingDeltaEvent).toBeDefined();
    expect((thinkingDeltaEvent?.delta as any)?.thinking).toBe('Let me think about this...');
  });

  it('should handle OpenRouter format with reasoning field', () => {
    const state2 = createOpenAIToAnthropicStreamState();
    const chunk = {
      id: 'chatcmpl-456',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'openrouter-model',
      choices: [{
        index: 0,
        delta: {
          reasoning: 'This is a complex problem...'
        },
        finish_reason: null
      }]
    } as any;

    const events = convertOpenAIStreamChunkToAnthropic(chunk, state2);

    // 应该包含 thinking delta
    const thinkingDeltaEvent = events.find(e => e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta');
    expect(thinkingDeltaEvent).toBeDefined();
    expect((thinkingDeltaEvent?.delta as any)?.thinking).toBe('This is a complex problem...');
  });

  it('should handle Qwen format with reasoning_content', () => {
    const state3 = createOpenAIToAnthropicStreamState();
    const chunk = {
      id: 'chatcmpl-qwen',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'qwen-max',
      choices: [{
        index: 0,
        delta: {
          reasoning_content: '让我思考一下...'
        },
        finish_reason: null
      }]
    } as any;

    const events = convertOpenAIStreamChunkToAnthropic(chunk, state3);

    // 应该包含 thinking delta
    const thinkingDeltaEvent = events.find(e => e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta');
    expect(thinkingDeltaEvent).toBeDefined();
    expect((thinkingDeltaEvent?.delta as any)?.thinking).toBe('让我思考一下...');
  });

  it('should handle incremental thinking content', () => {
    const state4 = createOpenAIToAnthropicStreamState();
    
    const chunk1 = {
      id: 'chatcmpl-789',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'o1-preview',
      choices: [{
        index: 0,
        delta: {
          reasoning_details: [{ text: 'First ' }]
        },
        finish_reason: null
      }]
    } as any;

    const chunk2 = {
      id: 'chatcmpl-789',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'o1-preview',
      choices: [{
        index: 0,
        delta: {
          reasoning_details: [{ text: 'step' }]
        },
        finish_reason: null
      }]
    } as any;

    const events1 = convertOpenAIStreamChunkToAnthropic(chunk1, state4);
    const events2 = convertOpenAIStreamChunkToAnthropic(chunk2, state4);

    // 验证增量内容
    const delta1 = events1.find(e => e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta');
    const delta2 = events2.find(e => e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta');

    expect((delta1?.delta as any)?.thinking).toBe('First ');
    expect((delta2?.delta as any)?.thinking).toBe('step');
  });

  it('should handle thinking followed by text content', () => {
    const state5 = createOpenAIToAnthropicStreamState();

    // First chunk: thinking
    const thinkingChunk = {
      id: 'chatcmpl-mixed',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'o1-preview',
      choices: [{
        index: 0,
        delta: {
          reasoning_details: [{ text: 'Thinking...' }]
        },
        finish_reason: null
      }]
    } as any;

    // Second chunk: text content
    const textChunk = {
      id: 'chatcmpl-mixed',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'o1-preview',
      choices: [{
        index: 0,
        delta: {
          content: 'The answer is...'
        },
        finish_reason: null
      }]
    } as any;

    const thinkingEvents = convertOpenAIStreamChunkToAnthropic(thinkingChunk, state5);
    const textEvents = convertOpenAIStreamChunkToAnthropic(textChunk, state5);

    // 验证 thinking block 被创建
    expect(thinkingEvents.some(e => e.type === 'content_block_start' && (e.content_block as any)?.type === 'thinking')).toBe(true);

    // 验证 text block 被创建（应该先结束 thinking block）
    expect(textEvents.some(e => e.type === 'content_block_stop')).toBe(true);
    expect(textEvents.some(e => e.type === 'content_block_start' && (e.content_block as any)?.type === 'text')).toBe(true);
  });

  it('should handle thinking with finish_reason', () => {
    const state6 = createOpenAIToAnthropicStreamState();

    const chunk = {
      id: 'chatcmpl-final',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'o1-preview',
      choices: [{
        index: 0,
        delta: {
          reasoning_details: [{ text: 'Final thought' }]
        },
        finish_reason: 'stop'
      }]
    } as any;

    const events = convertOpenAIStreamChunkToAnthropic(chunk, state6);

    // 应该包含 message_delta 和 message_stop
    expect(events.some(e => e.type === 'message_delta')).toBe(true);
    expect(events.some(e => e.type === 'message_stop')).toBe(true);

    const messageDelta = events.find(e => e.type === 'message_delta');
    expect(messageDelta?.delta?.stop_reason).toBe('end_turn');
  });

  it('should handle MiniMax format with both reasoning and reasoning_content', () => {
    const state7 = createOpenAIToAnthropicStreamState();

    // MiniMax 模型同时返回 reasoning 和 reasoning_content
    const chunk = {
      id: 'chatcmpl-minimax',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'minimax-m2.5',
      choices: [{
        index: 0,
        delta: {
          reasoning: 'The user',
          reasoning_content: 'The user'
        },
        finish_reason: null
      }]
    } as any;

    const events = convertOpenAIStreamChunkToAnthropic(chunk, state7);

    // 应该包含 thinking block
    expect(events.some(e => e.type === 'content_block_start' && (e.content_block as any)?.type === 'thinking')).toBe(true);
    
    // 应该包含 thinking delta
    const thinkingDelta = events.find(e => e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta');
    expect(thinkingDelta).toBeDefined();
    expect((thinkingDelta?.delta as any)?.thinking).toBe('The user');
  });

  it('should handle MiniMax format with reasoning, reasoning_content, and content together', () => {
    const state8 = createOpenAIToAnthropicStreamState();

    // 先发送纯 thinking 的 chunk
    const thinkingChunk = {
      id: 'chatcmpl-minimax-mixed',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'minimax-m2.5',
      choices: [{
        index: 0,
        delta: {
          reasoning: 'Let me think',
          reasoning_content: 'Let me think'
        },
        finish_reason: null
      }]
    } as any;

    // 然后发送同时包含 thinking 和 content 的 chunk
    const mixedChunk = {
      id: 'chatcmpl-minimax-mixed',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'minimax-m2.5',
      choices: [{
        index: 0,
        delta: {
          content: 'The answer is',
          reasoning: 'checking...',
          reasoning_content: 'checking...'
        },
        finish_reason: null
      }]
    } as any;

    const thinkingEvents = convertOpenAIStreamChunkToAnthropic(thinkingChunk, state8);
    const mixedEvents = convertOpenAIStreamChunkToAnthropic(mixedChunk, state8);

    // 验证 thinking chunk 被正确处理
    expect(thinkingEvents.some(e => e.type === 'content_block_start' && (e.content_block as any)?.type === 'thinking')).toBe(true);
    expect(thinkingEvents.some(e => e.type === 'content_block_delta' && (e.delta as any)?.thinking === 'Let me think')).toBe(true);

    // 验证 mixed chunk 同时处理了 thinking 和 content
    // 应该先结束 thinking block，然后开始 text block
    expect(mixedEvents.some(e => e.type === 'content_block_stop')).toBe(true);
    expect(mixedEvents.some(e => e.type === 'content_block_start' && (e.content_block as any)?.type === 'text')).toBe(true);
    
    const textDelta = mixedEvents.find(e => e.type === 'content_block_delta' && e.delta?.type === 'text_delta');
    expect(textDelta).toBeDefined();
    expect((textDelta?.delta as any)?.text).toBe('The answer is');
  });

  it('should handle empty choices array (usage only chunk)', () => {
    const state9 = createOpenAIToAnthropicStreamState();
    state9.sentMessageStart = true;

    // 某些模型在流结束时返回只有 usage 的 chunk
    const chunk = {
      id: 'chatcmpl-usage-only',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'minimax-m2.5',
      choices: [],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150
      }
    } as any;

    const events = convertOpenAIStreamChunkToAnthropic(chunk, state9);

    // 空 choices 应该返回空数组（不抛出错误）
    expect(events).toEqual([]);
  });

  it('should handle null reasoning_content with valid content', () => {
    const state10 = createOpenAIToAnthropicStreamState();
    state10.sentMessageStart = true;

    // MiniMax 模型在返回 content 时，reasoning_content 可能为 null
    const chunk = {
      id: 'chatcmpl-content-only',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'minimax-m2.5',
      choices: [{
        index: 0,
        delta: {
          content: '运行测试',
          reasoning_content: null
        },
        finish_reason: null
      }]
    } as any;

    const events = convertOpenAIStreamChunkToAnthropic(chunk, state10);

    // 应该处理 content，忽略 null 的 reasoning_content
    expect(events.some(e => e.type === 'content_block_start' && (e.content_block as any)?.type === 'text')).toBe(true);
    expect(events.some(e => e.type === 'content_block_delta' && (e.delta as any)?.text === '运行测试')).toBe(true);
  });
});
