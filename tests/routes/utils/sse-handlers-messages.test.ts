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
    expect(allResults.some(e => e.includes('"text":"\\n\\n"') || e.includes('"text":"\n\n"'))).toBe(true);
    expect(allResults.some(e => e.includes('"text":"运行"'))).toBe(true);
  });

  it('should convert Fireworks chunk with usage:null and raw_output:null to Anthropic format', () => {
    const state = createOpenAIToAnthropicStreamState();

    // Fireworks 上游返回的真实 chunk（含 usage:null 和 raw_output:null）
    // 第二条 data: 模拟最终 chunk，有 finish_reason 但 usage:null
    const sseBlock = `data: {"id":"chatcmpl-ed8fb9c62e7b4d87a6629594c0bc7215","object":"chat.completion.chunk","created":1779320325,"model":"accounts/fireworks/models/kimi-k2p6","choices":[{"index":0,"delta":{"reasoning_content":"用"},"finish_reason":null,"raw_output":null}],"usage":null}
data: {"id":"chatcmpl-ed8fb9c62e7b4d87a6629594c0bc7215","object":"chat.completion.chunk","created":1779320325,"model":"accounts/fireworks/models/kimi-k2p6","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":"stop","raw_output":null}],"usage":null}`;

    const result = parseAndConvertOpenAISSE(sseBlock, state);

    expect(result.length).toBeGreaterThan(0);

    // 第一条应该是 message_start
    expect(result[0]).toContain('event: message_start');
    // message_start 固定包含 usage:{input_tokens:0, output_tokens:0}，与上游 usage 无关
    expect(result[0]).toContain('"usage":{"input_tokens":0,"output_tokens":0}');

    // reasoning_content 应该被转换为 thinking block
    expect(result.some(e => e.includes('"type":"thinking"'))).toBe(true);
    expect(result.some(e => e.includes('"type":"thinking_delta"'))).toBe(true);
    expect(result.some(e => e.includes('"thinking":"用"'))).toBe(true);

    // 应该包含 text block（第二条 data: 的内容）
    expect(result.some(e => e.includes('"type":"text"'))).toBe(true);
    expect(result.some(e => e.includes('"text":"hello"'))).toBe(true);

    // 应该产生 message_delta（因为有 finish_reason），但上游 usage:null，所以不含 usage
    expect(result.some(e => e.includes('event: message_delta'))).toBe(true);
    const messageDelta = result.find(e => e.includes('event: message_delta'))!;
    expect(messageDelta).not.toContain('"usage"');

    // 应该产生 message_stop
    expect(result.some(e => e.includes('event: message_stop'))).toBe(true);

    // 转换后的 Anthropic 事件中不应该包含 raw_output 字段（非标准字段应被丢弃）
    for (const event of result) {
      expect(event).not.toContain('raw_output');
    }
  });

  it('should not include usage in message_delta when upstream usage is null', () => {
    const state = createOpenAIToAnthropicStreamState();
    state.sentMessageStart = true;

    // 模拟最终 chunk，有 finish_reason 但 usage:null
    const sseBlock = `data: {"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1234567890,"model":"kimi-k2p6","choices":[{"index":0,"delta":{"content":"done"},"finish_reason":"stop"}],"usage":null}`;

    const result = parseAndConvertOpenAISSE(sseBlock, state);

    // 应该产生 message_delta
    expect(result.some(e => e.includes('event: message_delta'))).toBe(true);

    // message_delta 中不应包含 usage（因为上游 usage 为 null）
    const messageDelta = result.find(e => e.includes('event: message_delta'))!;
    expect(messageDelta).not.toContain('"usage"');

    // 应该产生 message_stop
    expect(result.some(e => e.includes('event: message_stop'))).toBe(true);
  });
});
