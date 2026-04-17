/**
 * SSE Handlers Messages 测试 - OpenAI → Anthropic 转换
 * 
 * 测试 parseAndConvertOpenAISSE 函数的各种场景，包括：
 * - MiniMax 格式（同时返回 reasoning 和 reasoning_content）
 * - 空 choices 数组
 * - [DONE] 标记
 */

import { describe, it, expect } from 'vitest';
import { parseAndConvertOpenAISSE } from '../../../src/routes/utils/sse-handlers-messages.js';
import { createOpenAIToAnthropicStreamState } from '../../../src/converters/openai-to-anthropic.js';

describe('parseAndConvertOpenAISSE', () => {
  it('should parse and convert MiniMax format with reasoning and reasoning_content', () => {
    const state = createOpenAIToAnthropicStreamState();
    
    // MiniMax 模型同时返回 reasoning 和 reasoning_content
    const sseBlock = `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"reasoning":"The user","reasoning_content":"The user"},"finish_reason":null}]}`;

    const result = parseAndConvertOpenAISSE(sseBlock, state);

    expect(result.length).toBeGreaterThan(0);
    
    // 应该包含 message_start（第一次调用）
    expect(result.some(e => e.includes('event: message_start'))).toBe(true);
    
    // 应该包含 thinking block
    expect(result.some(e => e.includes('"type":"thinking"'))).toBe(true);
    expect(result.some(e => e.includes('"type":"thinking_delta"'))).toBe(true);
  });

  it('should parse and convert MiniMax format with content and null reasoning_content', () => {
    const state = createOpenAIToAnthropicStreamState();
    state.sentMessageStart = true;
    
    // MiniMax 模型返回 content，reasoning_content 为 null
    const sseBlock = `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"content":"运行测试","reasoning_content":null},"finish_reason":null}]}`;

    const result = parseAndConvertOpenAISSE(sseBlock, state);

    expect(result.length).toBeGreaterThan(0);
    
    // 应该包含 text block
    expect(result.some(e => e.includes('"type":"text"'))).toBe(true);
    expect(result.some(e => e.includes('"type":"text_delta"'))).toBe(true);
    expect(result.some(e => e.includes('"text":"运行测试"'))).toBe(true);
  });

  it('should skip empty choices array', () => {
    const state = createOpenAIToAnthropicStreamState();
    state.sentMessageStart = true;
    
    // 空 choices 数组（只有 usage 信息）
    const sseBlock = `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}`;

    const result = parseAndConvertOpenAISSE(sseBlock, state);

    // 空 choices 应该被跳过，返回空数组
    expect(result).toEqual([]);
  });

  it('should skip [DONE] marker', () => {
    const state = createOpenAIToAnthropicStreamState();
    
    const sseBlock = 'data: [DONE]';

    const result = parseAndConvertOpenAISSE(sseBlock, state);

    // [DONE] 应该被跳过
    expect(result).toEqual([]);
  });

  it('should handle multi-line SSE block with mixed content', () => {
    const state = createOpenAIToAnthropicStreamState();
    
    // 模拟真实的多行 SSE 块
    const sseBlock = `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"reasoning":"Let me think","reasoning_content":"Let me think"},"finish_reason":null}]}
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"content":"The answer","reasoning_content":null},"finish_reason":null}]}
`;

    const result = parseAndConvertOpenAISSE(sseBlock, state);

    expect(result.length).toBeGreaterThan(0);
    
    // 应该包含 thinking 和 text 两种类型
    expect(result.some(e => e.includes('"type":"thinking"'))).toBe(true);
    expect(result.some(e => e.includes('"type":"text"'))).toBe(true);
  });

  it('should handle SSE block with event prefix', () => {
    const state = createOpenAIToAnthropicStreamState();
    state.sentMessageStart = true;
    
    // 某些 SSE 可能带 event 前缀
    const sseBlock = `event: message
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}
`;

    const result = parseAndConvertOpenAISSE(sseBlock, state);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(e => e.includes('"text":"Hello"'))).toBe(true);
  });

  it('should return empty array for empty SSE block', () => {
    const state = createOpenAIToAnthropicStreamState();
    
    const sseBlock = '';

    const result = parseAndConvertOpenAISSE(sseBlock, state);

    expect(result).toEqual([]);
  });

  it('should return empty array for whitespace-only SSE block', () => {
    const state = createOpenAIToAnthropicStreamState();
    
    const sseBlock = '   \n\n   ';

    const result = parseAndConvertOpenAISSE(sseBlock, state);

    expect(result).toEqual([]);
  });

  it('should handle invalid JSON gracefully', () => {
    const state = createOpenAIToAnthropicStreamState();
    
    const sseBlock = `data: {invalid json}`;

    const result = parseAndConvertOpenAISSE(sseBlock, state);

    // 无效 JSON 应该被跳过，不抛出错误
    expect(result).toEqual([]);
  });

  it('should handle complete MiniMax stream flow', () => {
    const state = createOpenAIToAnthropicStreamState();
    
    // 模拟完整的 MiniMax 流式响应
    const chunks = [
      // 1. message_start
      `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning_content":null},"finish_reason":null}]}`,
      // 2. thinking content
      `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"reasoning":"The","reasoning_content":"The"},"finish_reason":null}]}`,
      // 3. more thinking
      `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"reasoning":" user","reasoning_content":" user"},"finish_reason":null}]}`,
      // 4. text content (reasoning_content is null)
      `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"content":"\\n\\n","reasoning_content":null},"finish_reason":null}]}`,
      // 5. more text
      `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"content":"运行","reasoning_content":null},"finish_reason":null}]}`,
      // 6. usage only (empty choices)
      `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}`,
      // 7. [DONE]
      'data: [DONE]'
    ];

    let allResults: string[] = [];
    for (const chunk of chunks) {
      const result = parseAndConvertOpenAISSE(chunk, state);
      allResults = allResults.concat(result);
    }

    // 验证转换结果
    expect(allResults.length).toBeGreaterThan(0);
    
    // 应该包含 message_start
    expect(allResults.some(e => e.includes('event: message_start'))).toBe(true);
    
    // 应该包含 thinking
    expect(allResults.some(e => e.includes('"type":"thinking"'))).toBe(true);
    expect(allResults.some(e => e.includes('"thinking":"The"'))).toBe(true);
    expect(allResults.some(e => e.includes('"thinking":" user"'))).toBe(true);
    
    // 应该包含 text
    expect(allResults.some(e => e.includes('"type":"text"'))).toBe(true);
    expect(allResults.some(e => e.includes('"text":"\\\\n\\\\n"') || e.includes('"text":"\\n\\n"'))).toBe(true);
    expect(allResults.some(e => e.includes('"text":"运行"'))).toBe(true);
  });
});
