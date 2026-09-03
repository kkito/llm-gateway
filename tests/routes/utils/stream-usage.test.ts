import { describe, it, expect } from 'vitest';
import { extractUsageFromOpenAIChunk, extractUsageFromAnthropicChunk, findFinalUsageFromChunks, hasStreamEnded } from '../../../src/lib/stream-usage.js';

describe('extractUsageFromOpenAIChunk', () => {
  it('extracts basic usage', () => {
    const chunk = { usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } };
    expect(extractUsageFromOpenAIChunk(chunk)).toEqual({
      promptTokens: 10, completionTokens: 20, totalTokens: 30,
    });
  });

  it('extracts cached_tokens from prompt_tokens_details', () => {
    const chunk = {
      usage: {
        prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 10 },
      },
    };
    expect(extractUsageFromOpenAIChunk(chunk)).toEqual({
      promptTokens: 100, completionTokens: 50, totalTokens: 150, cachedTokens: 10,
    });
  });

  it('extracts cached_tokens from input_tokens_details (input/output naming)', () => {
    const chunk = {
      usage: {
        input_tokens: 12, output_tokens: 383, total_tokens: 395,
        input_tokens_details: { cached_tokens: 7 },
        output_tokens_details: { reasoning_tokens: 183 },
      },
    };
    expect(extractUsageFromOpenAIChunk(chunk)).toEqual({
      promptTokens: 12, completionTokens: 383, totalTokens: 395, cachedTokens: 7,
    });
  });

  it('extracts cache_read_input_tokens', () => {
    const chunk = { usage: { prompt_tokens: 100, completion_tokens: 50, cache_read_input_tokens: 20 } };
    const result = extractUsageFromOpenAIChunk(chunk)!;
    expect(result.cachedTokens).toBe(20);
  });

  it('extracts cache_creation_input_tokens', () => {
    const chunk = { usage: { prompt_tokens: 100, completion_tokens: 50, cache_creation_input_tokens: 30 } };
    const result = extractUsageFromOpenAIChunk(chunk)!;
    expect(result.cachedTokens).toBe(30);
  });

  it('returns null for chunk without usage', () => {
    expect(extractUsageFromOpenAIChunk({ choices: [] })).toBeNull();
  });
});

describe('extractUsageFromAnthropicChunk', () => {
  it('extracts basic usage', () => {
    const chunk = { usage: { input_tokens: 10, output_tokens: 20 } };
    expect(extractUsageFromAnthropicChunk(chunk)).toEqual({
      promptTokens: 10, completionTokens: 20, totalTokens: 30,
    });
  });

  it('extracts cache_read_input_tokens', () => {
    const chunk = { usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 25 } };
    const result = extractUsageFromAnthropicChunk(chunk)!;
    expect(result.cachedTokens).toBe(25);
  });

  it('extracts cache_creation_input_tokens', () => {
    const chunk = { usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 35 } };
    const result = extractUsageFromAnthropicChunk(chunk)!;
    expect(result.cachedTokens).toBe(35);
  });

  it('returns null for chunk without usage', () => {
    expect(extractUsageFromAnthropicChunk({ type: 'message_delta' })).toBeNull();
  });
});

describe('findFinalUsageFromChunks', () => {
  it('finds last usage from OpenAI chunks', () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":10}}\n\n',
    ];
    const result = findFinalUsageFromChunks(chunks, 'openai')!;
    expect(result.promptTokens).toBe(5);
    expect(result.completionTokens).toBe(10);
  });

  it('finds last usage from Anthropic chunks', () => {
    const chunks = [
      'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":10,"output_tokens":20}}\n\n',
    ];
    const result = findFinalUsageFromChunks(chunks, 'anthropic')!;
    expect(result.promptTokens).toBe(10);
    expect(result.completionTokens).toBe(20);
  });

  it('returns null when no usage found', () => {
    const chunks = ['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'];
    expect(findFinalUsageFromChunks(chunks, 'openai')).toBeNull();
  });

  it('handles SSE with event: prefix', () => {
    const chunks = [
      'event: message_delta\ndata: {"type":"message_delta","usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":5}}\n\n',
    ];
    const result = findFinalUsageFromChunks(chunks, 'anthropic')!;
    expect(result.cachedTokens).toBe(5);
  });
});

describe('hasStreamEnded', () => {
  it('returns true when a chunk carries a non-null finish_reason', () => {
    const chunks = [
      'data: {"choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
    ];
    expect(hasStreamEnded(chunks)).toBe(true);
  });

  it('returns true on the [DONE] sentinel', () => {
    const chunks = ['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n', 'data: [DONE]\n\n'];
    expect(hasStreamEnded(chunks)).toBe(true);
  });

  it('returns false when every chunk has finish_reason null and no [DONE]', () => {
    // 模拟 muse-spark 这类上游：只有 finish_reason:null + usage/cost，无终止标志
    const chunks = [
      'data: {"choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}\n\n',
      'data: {"choices":[]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\n',
      'data: {"choices":[],"cost":"0"}\n\n',
    ];
    expect(hasStreamEnded(chunks)).toBe(false);
  });

  it('returns false for empty chunks', () => {
    expect(hasStreamEnded([])).toBe(false);
  });
});
