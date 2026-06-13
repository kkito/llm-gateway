/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { utcToLocalString, getLocalHour, localDateToUtcRange } from '../../src/lib/time-utils.js';

describe('utcToLocalString', () => {
  it('should produce "YYYY-MM-DD HH:mm:ss" format', () => {
    const result = utcToLocalString('2026-06-14T10:00:00.000Z');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('should return original string for invalid date', () => {
    expect(utcToLocalString('not-a-date')).toBe('not-a-date');
  });

  it('should handle empty string', () => {
    expect(utcToLocalString('')).toBe('');
  });
});

describe('getLocalHour', () => {
  it('should return a value between 0 and 23', () => {
    const hour = getLocalHour('2026-06-14T10:00:00.000Z');
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThanOrEqual(23);
  });
});

describe('localDateToUtcRange', () => {
  it('should convert local date to UTC range with tzOffset=0', () => {
    const [start, end] = localDateToUtcRange('2026-06-14', 0);
    expect(start).toBe('2026-06-14T00:00:00.000Z');
    expect(end).toBe('2026-06-14T23:59:59.999Z');
  });

  it('should convert local date to UTC range with tzOffset=480 (UTC-8)', () => {
    // 浏览器 Date.getTimezoneOffset() 对 UTC-8 返回 480
    const [start, end] = localDateToUtcRange('2026-06-14', 480);
    // UTC-8 的 2026-06-14 00:00:00 = UTC 2026-06-14 08:00:00
    expect(start).toBe('2026-06-14T08:00:00.000Z');
    // UTC-8 的 2026-06-14 23:59:59.999 = UTC 2026-06-15 07:59:59.999
    expect(end).toBe('2026-06-15T07:59:59.999Z');
  });

  it('should handle tzOffset=-300 as browser-style (UTC+5)', () => {
    // 浏览器 Date.getTimezoneOffset() 对 UTC+5 返回 -300
    const [start, end] = localDateToUtcRange('2026-06-14', -300);
    // UTC+5 的 2026-06-14 00:00:00 = UTC 2026-06-13 19:00:00
    expect(start).toBe('2026-06-13T19:00:00.000Z');
    expect(end).toBe('2026-06-14T18:59:59.999Z');
  });

  it('should accept browser getTimezoneOffset() convention: UTC+8 → -480', () => {
    // 浏览器 Date.getTimezoneOffset() 对 UTC+8 返回 -480
    const [start, end] = localDateToUtcRange('2026-06-14', -480);
    // UTC+8 本地 2026-06-14 00:00 = UTC 2026-06-13 16:00:00
    expect(start).toBe('2026-06-13T16:00:00.000Z');
    expect(end).toBe('2026-06-14T15:59:59.999Z');
  });

  it('should handle full week range with browser-style tzOffset', () => {
    // 浏览器传 tzOffset=-480，startDate='2026-06-07', endDate='2026-06-14'
    const [sStart, sEnd] = localDateToUtcRange('2026-06-07', -480);
    const [, eEnd] = localDateToUtcRange('2026-06-14', -480);
    expect(sStart).toBe('2026-06-06T16:00:00.000Z');
    expect(eEnd).toBe('2026-06-14T15:59:59.999Z');
  });
});
