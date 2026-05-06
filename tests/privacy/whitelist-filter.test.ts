import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filterWhitelistedFields } from '../../src/privacy/whitelist-filter.js';

describe('filterWhitelistedFields', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should keep only whitelisted fields', () => {
    const body = {
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      reasoning_effort: 'high',
      extra_body: { foo: 'bar' },
      user: 'user-123',
      metadata: { session: 'abc' }
    };
    const result = filterWhitelistedFields(body, 'req-001');
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('temperature');
    expect(result).toHaveProperty('reasoning_effort');
    expect(result).toHaveProperty('extra_body');
    expect(result).not.toHaveProperty('user');
    expect(result).not.toHaveProperty('metadata');
  });

  it('should log filtered-out fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const body = { messages: [{ role: 'user', content: 'hi' }], user: 'user-123', metadata: { x: 1 } };
    filterWhitelistedFields(body, 'req-001');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('🔒 [Privacy]'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('filtered:'));
    spy.mockRestore();
  });

  it('should not log when no fields are filtered', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const body = { messages: [{ role: 'user', content: 'hi' }], temperature: 0.7 };
    filterWhitelistedFields(body, 'req-001');
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('filtered:'));
    spy.mockRestore();
  });

  it('should return empty object when all fields are unknown', () => {
    const body = { user: 'u1', metadata: { a: 1 } };
    const result = filterWhitelistedFields(body, 'req-001');
    expect(Object.keys(result)).toEqual([]);
  });

  it('should return all fields when all are safe', () => {
    const body = { messages: [], stream: true, temperature: 1.0, max_tokens: 100 };
    const result = filterWhitelistedFields(body, 'req-001');
    expect(result).toEqual(body);
  });

  it('should handle empty body', () => {
    const result = filterWhitelistedFields({}, 'req-001');
    expect(result).toEqual({});
  });

  it('should truncate log values to 500 chars', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const longValue = 'x'.repeat(1000);
    const body = { messages: [], metadata: { val: longValue } };
    filterWhitelistedFields(body, 'req-001');
    const callArgs = spy.mock.calls[0][0] as string;
    expect(callArgs.length).toBeLessThan(800);
    spy.mockRestore();
  });
});
