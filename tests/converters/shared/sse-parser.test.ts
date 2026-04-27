import { describe, it, expect } from 'vitest';
import { parseSSEData, parseSSEBlock } from '../../../src/converters/shared/sse-parser.js';

describe('parseSSEData', () => {
  it('parses data: line', () => {
    const result = parseSSEData('data: {"type":"text"}');
    expect(result).toEqual({ data: { type: 'text' } });
  });

  it('parses event: line', () => {
    const result = parseSSEData('event: message_start');
    expect(result).toEqual({ event: 'message_start', data: null });
  });

  it('returns null for non-SSE lines', () => {
    expect(parseSSEData('hello')).toBeNull();
  });

  it('returns null for empty data', () => {
    expect(parseSSEData('data: ')).toBeNull();
  });

  it('returns null for [DONE] marker', () => {
    expect(parseSSEData('data: [DONE]')).toBeNull();
  });

  it('returns null for SSE comment lines', () => {
    expect(parseSSEData(': OPENROUTER PROCESSING')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseSSEData('data: {invalid}')).toBeNull();
  });
});

describe('parseSSEBlock', () => {
  it('parses single event with data', () => {
    const block = 'event: message_start\ndata: {"type":"message_start"}\n\n';
    const results = parseSSEBlock(block);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ event: 'message_start', data: { type: 'message_start' } });
  });

  it('parses data-only events', () => {
    const block = 'data: {"type":"text"}\n\n';
    const results = parseSSEBlock(block);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ event: undefined, data: { type: 'text' } });
  });

  it('parses multiple events in one block', () => {
    const block = 'data: {"type":"a"}\n\ndata: {"type":"b"}\n\n';
    const results = parseSSEBlock(block);
    expect(results).toHaveLength(2);
    expect(results[0].data).toEqual({ type: 'a' });
    expect(results[1].data).toEqual({ type: 'b' });
  });

  it('skips [DONE] marker', () => {
    const block = 'data: {"type":"text"}\n\ndata: [DONE]\n\n';
    const results = parseSSEBlock(block);
    expect(results).toHaveLength(1);
    expect(results[0].data).toEqual({ type: 'text' });
  });

  it('skips SSE comment lines', () => {
    const block = ': comment\ndata: {"type":"text"}\n\n';
    const results = parseSSEBlock(block);
    expect(results).toHaveLength(1);
    expect(results[0].data).toEqual({ type: 'text' });
  });

  it('handles empty blocks', () => {
    expect(parseSSEBlock('')).toEqual([]);
    expect(parseSSEBlock('\n\n')).toEqual([]);
  });

  it('handles invalid JSON gracefully', () => {
    const block = 'data: {invalid json}\n\n';
    const results = parseSSEBlock(block);
    expect(results).toEqual([]);
  });

  it('handles full Anthropic SSE stream', () => {
    const block = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');

    const results = parseSSEBlock(block);
    expect(results).toHaveLength(3);
    expect(results[0].event).toBe('message_start');
    expect(results[1].event).toBe('content_block_delta');
    expect(results[1].data.delta.text).toBe('Hello');
    expect(results[2].event).toBe('message_stop');
  });
});
