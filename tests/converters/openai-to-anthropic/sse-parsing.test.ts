import { describe, it, expect } from 'vitest';
import { parseOpenAISSEData } from '../../../src/converters/openai-to-anthropic.js';

describe('openai-to-anthropic converter - SSE parsing', () => {
  it('parses data: line', () => {
    const result = parseOpenAISSEData('data: {"id":"chatcmpl-123"}');
    expect(result).toEqual({ data: { id: 'chatcmpl-123' } });
  });

  it('returns null for [DONE]', () => {
    expect(parseOpenAISSEData('data: [DONE]')).toBeNull();
  });

  it('returns null for empty data', () => {
    expect(parseOpenAISSEData('data: ')).toBeNull();
  });

  it('returns null for non-SSE lines', () => {
    expect(parseOpenAISSEData('hello')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseOpenAISSEData('data: {bad}')).toBeNull();
  });

  it('handles event: prefix', () => {
    const result = parseOpenAISSEData('event: some-event');
    expect(result?.event).toBe('some-event');
  });
});
