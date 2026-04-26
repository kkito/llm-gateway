import { describe, it, expect } from 'vitest';
import { buildFullOpenAIResponse } from '../../../src/routes/utils/sse-handlers.js';

describe('buildFullOpenAIResponse', () => {
  it('should accumulate content from delta.content', () => {
    const chunks = [
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}',
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.choices[0].message.content).toBe('Hello world');
    expect(result.choices[0].message.role).toBe('assistant');
  });

  it('should accumulate reasoning_content from delta.reasoning_content', () => {
    const chunks = [
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{"reasoning_content":"Let me"},"finish_reason":null}]}',
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{"reasoning_content":" think"},"finish_reason":null}]}',
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.choices[0].message.reasoning_content).toBe('Let me think');
  });

  it('should accumulate reasoning_content from delta.reasoning as fallback', () => {
    const chunks = [
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{"reasoning":"Let me"},"finish_reason":null}]}',
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{"reasoning":" think"},"finish_reason":null}]}',
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.choices[0].message.reasoning_content).toBe('Let me think');
  });

  it('should NOT duplicate when both reasoning_content and reasoning are present', () => {
    // Some providers (like MiniMax) send both fields with identical values
    const chunks = [
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"minimax","choices":[{"index":0,"delta":{"reasoning":"The","reasoning_content":"The"},"finish_reason":null}]}',
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"minimax","choices":[{"index":0,"delta":{"reasoning":" answer","reasoning_content":" answer"},"finish_reason":null}]}',
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"minimax","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    ];

    const result = buildFullOpenAIResponse(chunks);

    // Should only accumulate once, not duplicated
    expect(result.choices[0].message.reasoning_content).toBe('The answer');
    expect(result.choices[0].message.reasoning_content).not.toContain('TheThe');
  });

  it('should handle reasoning_content with null value (skip null)', () => {
    const chunks = [
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{"reasoning_content":"Thinking"},"finish_reason":null}]}',
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello","reasoning_content":null},"finish_reason":null}]}',
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.choices[0].message.reasoning_content).toBe('Thinking');
    expect(result.choices[0].message.content).toBe('Hello');
  });

  it('should accumulate tool_calls function arguments', () => {
    const chunks = [
      `data: ${JSON.stringify({ id: 'msg-1', object: 'chat.completion.chunk', created: 1234, model: 'gpt-4', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'tc-1', type: 'function', function: { name: 'read_file', arguments: '{' } }] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'msg-1', object: 'chat.completion.chunk', created: 1234, model: 'gpt-4', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"path":' } }] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'msg-1', object: 'chat.completion.chunk', created: 1234, model: 'gpt-4', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"/file.txt"}' } }] }, finish_reason: null }] })}\n\n`,
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls[0].function.arguments).toContain('/file.txt');
  });

  it('should extract usage from chunks', () => {
    const chunks = [
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}',
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });

  it('should skip empty data lines and [DONE]', () => {
    const chunks = [
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}',
      'data: [DONE]',
      '',
      'data: ',
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.choices[0].message.content).toBe('Hi');
  });

  it('should handle mixed content and reasoning_content together', () => {
    const chunks = [
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{"reasoning_content":"Let me check"},"finish_reason":null}]}',
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"The answer is 42."},"finish_reason":null}]}',
      'data: {"id":"msg-1","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    ];

    const result = buildFullOpenAIResponse(chunks);

    expect(result.choices[0].message.reasoning_content).toBe('Let me check');
    expect(result.choices[0].message.content).toBe('The answer is 42.');
  });
});
