import { describe, it, expect } from 'vitest';
import { getClientIp } from '../../src/lib/client-ip.js';

describe('getClientIp', () => {
  it('uses the first x-forwarded-for entry', () => {
    const c = { req: { header: (name: string) => name === 'x-forwarded-for' ? '203.0.113.7, 10.0.0.1' : null } };
    expect(getClientIp(c as any)).toBe('203.0.113.7');
  });

  it('trims whitespace in x-forwarded-for', () => {
    const c = { req: { header: (name: string) => name === 'x-forwarded-for' ? '  198.51.100.2  , 10.0.0.1' : null } };
    expect(getClientIp(c as any)).toBe('198.51.100.2');
  });

  it('falls back to x-real-ip when x-forwarded-for is empty', () => {
    const c = { req: { header: (name: string) => name === 'x-real-ip' ? '192.0.2.44' : null } };
    expect(getClientIp(c as any)).toBe('192.0.2.44');
  });

  it('falls back to the connection socket address', () => {
    const c = {
      req: { header: () => null },
      env: { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
    };
    expect(getClientIp(c as any)).toBe('127.0.0.1');
  });

  it('strips the IPv4-mapped prefix from the socket address', () => {
    const c = {
      req: { header: () => null },
      env: { incoming: { socket: { remoteAddress: '::ffff:192.168.1.20' } } },
    };
    expect(getClientIp(c as any)).toBe('192.168.1.20');
  });

  it('returns null when no source is available', () => {
    const c = { req: { header: () => null } };
    expect(getClientIp(c as any)).toBeNull();
  });
});
