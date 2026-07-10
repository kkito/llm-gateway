import { describe, it, expect } from 'vitest';
import { resolveConverterChain, type ChainPlan } from '../../src/converters/router.js';

describe('router', () => {
  it('同格式透传', () => {
    const plan = resolveConverterChain('anthropic', 'anthropic');
    expect(plan.passthrough).toBe(true);
  });
  it('anthropic->openai 走 chat 中转', () => {
    const plan = resolveConverterChain('anthropic', 'openai');
    expect(plan.passthrough).toBe(false);
    expect(plan.source).toBe('anthropic');
    expect(plan.provider).toBe('openai');
  });
  it('responses->response-api 走 chat 中转', () => {
    const plan = resolveConverterChain('responses', 'response-api');
    expect(plan.passthrough).toBe(false);
  });
});
