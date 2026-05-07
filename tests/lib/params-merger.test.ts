import { describe, it, expect } from 'vitest';
import { deepMerge, mergeModelParams } from '../../src/lib/params-merger.js';

describe('deepMerge', () => {
  it('should override primitive values', () => {
    const base = { temperature: 0.7, max_tokens: 4096 };
    const override = { temperature: 0.9 };
    expect(deepMerge(base, override)).toEqual({ temperature: 0.9, max_tokens: 4096 });
  });

  it('should recursively merge objects', () => {
    const base = { extra_body: { top_k: 50, thinking: { type: 'disabled' } } };
    const override = { extra_body: { thinking: { type: 'enabled' } } };
    expect(deepMerge(base, override)).toEqual({
      extra_body: { top_k: 50, thinking: { type: 'enabled' } }
    });
  });

  it('should replace arrays entirely', () => {
    const base = { stop: ['\n\n', '```'] };
    const override = { stop: ['\n'] };
    expect(deepMerge(base, override)).toEqual({ stop: ['\n'] });
  });

  it('should handle null override values', () => {
    const base = { temperature: 0.7, max_tokens: 4096 };
    const override = { max_tokens: null };
    expect(deepMerge(base, override)).toEqual({ temperature: 0.7, max_tokens: null });
  });

  it('should handle empty override', () => {
    const base = { temperature: 0.7 };
    expect(deepMerge(base, {})).toEqual({ temperature: 0.7 });
  });
});

describe('mergeModelParams', () => {
  it('should return userBody when defaultParams is undefined', () => {
    const userBody = { temperature: 0.8, messages: [] };
    expect(mergeModelParams(undefined, userBody)).toEqual(userBody);
  });

  it('should merge defaultParams with userBody (user wins)', () => {
    const defaultParams = { temperature: 0.7, max_tokens: 4096, extra_body: { top_k: 50 } };
    const userBody = { temperature: 0.9, messages: [] };
    const result = mergeModelParams(defaultParams, userBody);
    expect(result).toEqual({
      temperature: 0.9,
      max_tokens: 4096,
      extra_body: { top_k: 50 },
      messages: []
    });
  });

  it('should deeply merge extra_body', () => {
    const defaultParams = { extra_body: { thinking: { type: 'disabled' }, top_k: 50 } };
    const userBody = { extra_body: { thinking: { type: 'enabled' } } };
    const result = mergeModelParams(defaultParams, userBody);
    expect(result).toEqual({
      extra_body: { thinking: { type: 'enabled' }, top_k: 50 }
    });
  });
});
