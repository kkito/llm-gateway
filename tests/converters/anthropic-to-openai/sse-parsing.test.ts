import { describe, it, expect } from 'vitest';
import { parseSSEData } from '../../../src/converters/anthropic-to-openai.js';

describe('anthropic-to-openai converter - SSE parsing', () => {
  it('should parse valid SSE data line', () => {
    const line = 'data: {"type":"message_start","message":{"id":"msg_123"}}';
    const result = parseSSEData(line);

    expect(result).toEqual({
      data: {
        type: 'message_start',
        message: { id: 'msg_123' }
      }
    });
  });

  it('should return null for line not starting with data:', () => {
    const line = '{"type":"message_start"}';
    const result = parseSSEData(line);

    expect(result).toBeNull();
  });

  it('should return null for empty data', () => {
    const line = 'data: ';
    const result = parseSSEData(line);

    expect(result).toBeNull();
  });

  it('should return null for [DONE] marker', () => {
    const line = 'data: [DONE]';
    const result = parseSSEData(line);

    expect(result).toBeNull();
  });

  it('should return null for invalid JSON', () => {
    const line = 'data: {invalid json}';
    const result = parseSSEData(line);

    expect(result).toBeNull();
  });

  it('should handle line with extra whitespace', () => {
    const line = 'data:   {"type":"content_block_delta","delta":{"text":"Hello"}}   ';
    const result = parseSSEData(line);

    expect(result).toEqual({
      data: {
        type: 'content_block_delta',
        delta: { text: 'Hello' }
      }
    });
  });

  it('should parse full Anthropic SSE stream', () => {
    const lines = [
      'data: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-3-5-sonnet-20241022","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" World"}}',
      'data: {"type":"content_block_stop","index":0}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":10}}',
      'data: {"type":"message_stop"}'
    ];

    const results = lines.map(line => parseSSEData(line));

    expect(results[0]?.data.type).toBe('message_start');
    expect(results[1]?.data.type).toBe('content_block_start');
    expect(results[2]?.data.type).toBe('content_block_delta');
    expect(results[2]?.data.delta?.text).toBe('Hello');
    expect(results[3]?.data.delta?.text).toBe(' World');
    expect(results[4]?.data.type).toBe('content_block_stop');
    expect(results[5]?.data.type).toBe('message_delta');
    expect(results[6]?.data.type).toBe('message_stop');
  });
});