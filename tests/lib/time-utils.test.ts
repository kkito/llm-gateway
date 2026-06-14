/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { utcToLocalString, getLocalHour, localDateToUtcRange, getLocalToday, isValidTimeZone, localDateToUtcMs, localDateToUtcRangeTz } from '../../src/lib/time-utils.js';

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

describe('isValidTimeZone', () => {
  it('should return true for valid IANA timezone names', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Europe/London')).toBe(true);
  });

  it('should return false for invalid timezone names', () => {
    expect(isValidTimeZone('Invalid/Zone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('UTC+8')).toBe(false);
  });
});

describe('localDateToUtcMs', () => {
  it('Asia/Shanghai (UTC+8): 2026-06-14 → UTC 2026-06-13T16:00:00Z', () => {
    const ms = localDateToUtcMs('2026-06-14', 'Asia/Shanghai');
    expect(new Date(ms).toISOString()).toBe('2026-06-13T16:00:00.000Z');
  });

  it('UTC: 2026-06-14 → UTC 2026-06-14T00:00:00Z', () => {
    const ms = localDateToUtcMs('2026-06-14', 'UTC');
    expect(new Date(ms).toISOString()).toBe('2026-06-14T00:00:00.000Z');
  });

  it('America/New_York (UTC-5 winter): 2026-01-14 → UTC 2026-01-14T05:00:00Z', () => {
    const ms = localDateToUtcMs('2026-01-14', 'America/New_York');
    expect(new Date(ms).toISOString()).toBe('2026-01-14T05:00:00.000Z');
  });

  it('America/New_York (UTC-4 summer/DST): 2026-07-14 → UTC 2026-07-14T04:00:00Z', () => {
    const ms = localDateToUtcMs('2026-07-14', 'America/New_York');
    expect(new Date(ms).toISOString()).toBe('2026-07-14T04:00:00.000Z');
  });

  it('Europe/London (BST summer): 2026-07-14 → UTC 2026-07-13T23:00:00Z', () => {
    const ms = localDateToUtcMs('2026-07-14', 'Europe/London');
    expect(new Date(ms).toISOString()).toBe('2026-07-13T23:00:00.000Z');
  });

  it('Europe/London (GMT winter): 2026-01-14 → UTC 2026-01-14T00:00:00Z', () => {
    const ms = localDateToUtcMs('2026-01-14', 'Europe/London');
    expect(new Date(ms).toISOString()).toBe('2026-01-14T00:00:00.000Z');
  });
});

describe('localDateToUtcRangeTz', () => {
  it('Asia/Shanghai: 2026-06-14 → UTC 2026-06-13T16:00 ~ 2026-06-14T15:59', () => {
    const [start, end] = localDateToUtcRangeTz('2026-06-14', 'Asia/Shanghai');
    expect(start).toBe('2026-06-13T16:00:00.000Z');
    expect(end).toBe('2026-06-14T15:59:59.999Z');
  });

  it('UTC: 2026-06-14 → UTC 2026-06-14T00:00 ~ 2026-06-14T23:59', () => {
    const [start, end] = localDateToUtcRangeTz('2026-06-14', 'UTC');
    expect(start).toBe('2026-06-14T00:00:00.000Z');
    expect(end).toBe('2026-06-14T23:59:59.999Z');
  });

  it('America/New_York winter: 2026-01-14 → UTC 2026-01-14T05:00 ~ 2026-01-15T04:59', () => {
    const [start, end] = localDateToUtcRangeTz('2026-01-14', 'America/New_York');
    expect(start).toBe('2026-01-14T05:00:00.000Z');
    expect(end).toBe('2026-01-15T04:59:59.999Z');
  });

  it('America/New_York summer DST: 2026-07-14 → UTC 2026-07-14T04:00 ~ 2026-07-15T03:59', () => {
    const [start, end] = localDateToUtcRangeTz('2026-07-14', 'America/New_York');
    expect(start).toBe('2026-07-14T04:00:00.000Z');
    expect(end).toBe('2026-07-15T03:59:59.999Z');
  });

  it('无效时区退回到 UTC', () => {
    const [start, end] = localDateToUtcRangeTz('2026-06-14', 'Invalid/Zone');
    expect(start).toBe('2026-06-14T00:00:00.000Z');
    expect(end).toBe('2026-06-14T23:59:59.999Z');
  });
});

describe('getLocalToday', () => {
  it('should return "YYYY-MM-DD" format', () => {
    const today = getLocalToday('Asia/Shanghai');
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should return current date in UTC for UTC timezone', () => {
    const today = getLocalToday('UTC');
    const now = new Date();
    const expected = now.getUTCFullYear() + '-' +
      String(now.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(now.getUTCDate()).padStart(2, '0');
    expect(today).toBe(expected);
  });
});
