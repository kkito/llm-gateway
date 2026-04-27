/**
 * buildFullOpenAIResponse 测试
 *
 * 测试从 SSE chunks 构建完整 OpenAI 响应的各种场景
 */

import { describe, it, expect } from 'vitest';
import { buildFullOpenAIResponse } from '../../../src/routes/utils/sse-handlers.js';

describe('buildFullOpenAIResponse', () => {
  it('should build a complete response from SSE chunks', () => {
    const chunks = [
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
      'data: [DONE]'
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.id).toBe('chatcmpl-123');
    expect(result.object).toBe('chat.completion');
    expect(result.created).toBe(1234567890);
    expect(result.model).toBe('gpt-4');
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.role).toBe('assistant');
    expect(result.choices[0].message.content).toBe('Hello world');
    expect(result.choices[0].finish_reason).toBe('stop');
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });

  it('should handle reasoning and reasoning_content fields', () => {
    const chunks = [
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
      // MiniMax 格式：同时返回 reasoning 和 reasoning_content（内容相同）
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"reasoning":"Let","reasoning_content":"Let"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"reasoning":" me","reasoning_content":" me"},"finish_reason":null}]}',
      // 只有 reasoning_content
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"reasoning_content":" think"},"finish_reason":null}]}',
      // 只有 reasoning
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"reasoning":" about"},"finish_reason":null}]}',
      // 正常 content
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{"content":"The answer"},"reasoning_content":null,"finish_reason":null}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"minimax-m2.5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]'
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.choices[0].message.reasoning_content).toBe('Let me think about');
    expect(result.choices[0].message.content).toBe('The answer');
    // 验证 reasoning 和 reasoning_content 同时存在时不会重复拼接
    expect(result.choices[0].message.reasoning_content).not.toContain('Let meLet me');
  });

  it('should handle tool_calls in streaming format', () => {
    const chunks = [
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      // tool_calls 初始化
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"id":"call_abc","type":"function","index":0,"function":{"name":"write_file","arguments":""}}]},"finish_reason":null}]}',
      // tool_calls 参数分段
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"file_path\\": \\""}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"/tmp/test.txt\\"}"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]'
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.choices[0].finish_reason).toBe('tool_calls');
    expect(result.choices[0].message.tool_calls).toBeDefined();
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls[0].id).toBe('call_abc');
    expect(result.choices[0].message.tool_calls[0].type).toBe('function');
    expect(result.choices[0].message.tool_calls[0].function.name).toBe('write_file');
    expect(result.choices[0].message.tool_calls[0].function.arguments).toBe('{"file_path": "/tmp/test.txt"}');
  });

  it('should not duplicate tool_calls name when every chunk contains name (Anthropic format)', () => {
    // Anthropic 格式的 input_json_delta 每个 chunk 都带 name
    // 模拟从 Anthropic 转换过来的流：content_block_start 设置 name，后续 input_json_delta 也带 name
    const chunks = [
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"claude-3-7","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      // content_block_start: 第一次设置 tool_use
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"claude-3-7","choices":[{"index":0,"delta":{"tool_calls":[{"id":"toolu_001","type":"function","index":0,"function":{"name":"write_file","arguments":""}}]},"finish_reason":null}]}',
      // input_json_delta: 每个 chunk 都带 name（这是 Anthropic 转换后的行为）
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"claude-3-7","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"toolu_001","type":"function","function":{"name":"write_file","arguments":"{\\"file\\":"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"claude-3-7","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"toolu_001","type":"function","function":{"name":"write_file","arguments":" \\"/tmp/test.txt\\"}"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"claude-3-7","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]'
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.choices[0].message.tool_calls[0].id).toBe('toolu_001');
    expect(result.choices[0].message.tool_calls[0].function.name).toBe('write_file');
    // 关键：name 不应该被重复拼接
    expect(result.choices[0].message.tool_calls[0].function.name).not.toBe('write_filewrite_filewrite_file');
    expect(result.choices[0].message.tool_calls[0].function.arguments).toBe('{"file": "/tmp/test.txt"}');
  });

  it('should handle multiple tool_calls with different indices', () => {
    const chunks = [
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      // 同时返回两个 tool_calls
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"id":"call_1","type":"function","index":0,"function":{"name":"tool_a","arguments":""}},{"id":"call_2","type":"function","index":1,"function":{"name":"tool_b","arguments":""}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}},{"index":1,"function":{"arguments":"{}"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]'
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.choices[0].message.tool_calls).toHaveLength(2);
    expect(result.choices[0].message.tool_calls[0].function.name).toBe('tool_a');
    expect(result.choices[0].message.tool_calls[1].function.name).toBe('tool_b');
  });

  it('should handle empty chunks array', () => {
    const result = buildFullOpenAIResponse([]);

    expect(result.id).toBe('');
    expect(result.model).toBe('');
    expect(result.created).toBe(0);
    expect(result.choices).toEqual([]);
    expect(result.usage).toBeNull();
  });

  it('should handle malformed JSON gracefully', () => {
    const chunks = [
      'data: {invalid json}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: [DONE]'
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.choices[0].message.content).toBe('Hello');
  });

  it('should skip non-data lines', () => {
    const chunks = [
      ': OPENROUTER COMMENT',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: [DONE]'
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.choices[0].message.content).toBe('Hello');
  });

  it('should handle multiple choices', () => {
    const chunks = [
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"A"},"finish_reason":null},{"index":1,"delta":{"content":"B"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" - more"},"finish_reason":null},{"index":1,"delta":{"content":" - more"},"finish_reason":null}]}',
      'data: [DONE]'
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.choices).toHaveLength(2);
    expect(result.choices[0].message.content).toBe('A - more');
    expect(result.choices[1].message.content).toBe('B - more');
  });

  it('should filter out empty content choices', () => {
    const chunks = [
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":"stop"}]}',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":1,"delta":{},"finish_reason":null}]}',
      'data: [DONE]'
    ];

    const result = buildFullOpenAIResponse(chunks);

    // 所有 choice 都应该被保留（即使没有 content）
    expect(result.choices.length).toBeGreaterThanOrEqual(1);
    expect(result.choices[0].message.content).toBe('Hello');
  });
});
