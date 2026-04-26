import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stripUserField } from '../../src/privacy/strip-user.js';

describe('stripUserField', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should delete user field and log it', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const body = { messages: [], user: 'user-abc123', temperature: 0.7 };
    stripUserField(body, 'req-001');
    expect(body).not.toHaveProperty('user');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[Privacy]'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('stripped: user="user-abc123"'));
    spy.mockRestore();
  });

  it('should be no-op when user field is absent', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const body = { messages: [], temperature: 0.7 };
    stripUserField(body, 'req-001');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should not mutate other fields', () => {
    const body = { messages: [{ role: 'user', content: 'hi' }], temperature: 0.7, user: 'x' };
    stripUserField(body, 'req-001');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.temperature).toBe(0.7);
  });
});
