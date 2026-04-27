import { describe, it, expect } from 'vitest';
import { mapAnthropicToOpenAIFinishReason, mapOpenAIToAnthropicFinishReason } from '../../../src/converters/shared/finish-reason.js';

describe('mapAnthropicToOpenAIFinishReason', () => {
  it('maps end_turn to stop', () => {
    expect(mapAnthropicToOpenAIFinishReason('end_turn')).toBe('stop');
  });

  it('maps tool_use to tool_calls', () => {
    expect(mapAnthropicToOpenAIFinishReason('tool_use')).toBe('tool_calls');
  });

  it('maps max_tokens to length', () => {
    expect(mapAnthropicToOpenAIFinishReason('max_tokens')).toBe('length');
  });

  it('maps stop_sequence to stop', () => {
    expect(mapAnthropicToOpenAIFinishReason('stop_sequence')).toBe('stop');
  });

  it('returns null for null input', () => {
    expect(mapAnthropicToOpenAIFinishReason(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(mapAnthropicToOpenAIFinishReason(undefined)).toBeNull();
  });

  it('returns stop for unknown values', () => {
    expect(mapAnthropicToOpenAIFinishReason('unknown')).toBe('stop');
  });
});

describe('mapOpenAIToAnthropicFinishReason', () => {
  it('maps stop to end_turn', () => {
    expect(mapOpenAIToAnthropicFinishReason('stop')).toBe('end_turn');
  });

  it('maps length to max_tokens', () => {
    expect(mapOpenAIToAnthropicFinishReason('length')).toBe('max_tokens');
  });

  it('maps tool_calls to tool_use', () => {
    expect(mapOpenAIToAnthropicFinishReason('tool_calls')).toBe('tool_use');
  });

  it('maps content_filter to stop_sequence', () => {
    expect(mapOpenAIToAnthropicFinishReason('content_filter')).toBe('stop_sequence');
  });

  it('returns null for null input', () => {
    expect(mapOpenAIToAnthropicFinishReason(null)).toBeNull();
  });

  it('returns end_turn for unknown values', () => {
    expect(mapOpenAIToAnthropicFinishReason('unknown')).toBe('end_turn');
  });
});
