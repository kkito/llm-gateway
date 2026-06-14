/**
 * 测试 admin/stats 按小时分布的 UTC→本地时区转换
 *
 * byHour 的 key 来自 SQLite strftime('%Y-%m-%d %H:00', timestamp)，
 * 输出的是 UTC 时间。需要根据客户端时区偏移转换为本地时间显示。
 */
import { describe, it, expect } from 'vitest';

/**
 * 将 UTC 小时 key 转换为本地时间小时 key
 *
 * @param utcHourKey 格式 "YYYY-MM-DD HH:00"（UTC）
 * @param tzOffsetMinutes 浏览器 Date.getTimezoneOffset() 约定（UTC+8 → -480）
 * @returns 格式 "YYYY-MM-DD HH:00"（本地时间）
 */
function utcHourToLocal(utcHourKey: string, tzOffsetMinutes: number): string {
  const match = utcHourKey.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):00$/);
  if (!match) return utcHourKey;

  const [, yStr, mStr, dStr, hStr] = match;
  const utcMs = Date.UTC(
    Number(yStr), Number(mStr) - 1, Number(dStr),
    Number(hStr), 0, 0, 0
  );
  const localMs = utcMs - tzOffsetMinutes * 60 * 1000;
  const d = new Date(localMs);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:00`;
}

describe('utcHourToLocal', () => {
  it('UTC+8 (tzOffset=-480): UTC 16:00 → 本地 00:00（次日）', () => {
    // UTC 2026-06-13 16:00 = 本地 2026-06-14 00:00 (UTC+8)
    expect(utcHourToLocal('2026-06-13 16:00', -480)).toBe('2026-06-14 00:00');
  });

  it('UTC+8 (tzOffset=-480): UTC 00:00 → 本地 08:00', () => {
    // UTC 2026-06-14 00:00 = 本地 2026-06-14 08:00 (UTC+8)
    expect(utcHourToLocal('2026-06-14 00:00', -480)).toBe('2026-06-14 08:00');
  });

  it('UTC+8 (tzOffset=-480): UTC 07:00 → 本地 15:00', () => {
    // UTC 2026-06-14 07:00 = 本地 2026-06-14 15:00 (UTC+8)
    expect(utcHourToLocal('2026-06-14 07:00', -480)).toBe('2026-06-14 15:00');
  });

  it('UTC+8 (tzOffset=-480): UTC 15:00 → 本地 23:00', () => {
    // UTC 2026-06-14 15:00 = 本地 2026-06-14 23:00 (UTC+8)
    expect(utcHourToLocal('2026-06-14 15:00', -480)).toBe('2026-06-14 23:00');
  });

  it('UTC+0 (tzOffset=0): 时间不变', () => {
    expect(utcHourToLocal('2026-06-14 10:00', 0)).toBe('2026-06-14 10:00');
  });

  it('UTC-5 (tzOffset=300): UTC 00:00 → 本地 19:00（前一日）', () => {
    // UTC 2026-06-14 00:00 = 本地 2026-06-13 19:00 (UTC-5)
    expect(utcHourToLocal('2026-06-14 00:00', 300)).toBe('2026-06-13 19:00');
  });

  it('跨年：UTC 2026-01-01 00:00 → UTC+8 本地 2026-01-01 08:00', () => {
    expect(utcHourToLocal('2026-01-01 00:00', -480)).toBe('2026-01-01 08:00');
  });

  it('非标准格式原样返回', () => {
    expect(utcHourToLocal('invalid', -480)).toBe('invalid');
  });
});

describe('byHour UTC→本地聚合场景', () => {
  it('UTC+8 选"今天"时，UTC 小时正确映射到本地小时', () => {
    // UTC+8 选 2026-06-14
    // UTC 范围: 2026-06-13T16:00 ~ 2026-06-14T15:59
    // SQLite 会输出这些 UTC 小时:
    const utcHours = [
      '2026-06-13 16:00', // → 本地 00:00
      '2026-06-13 17:00', // → 本地 01:00
      '2026-06-13 18:00', // → 本地 02:00
      '2026-06-13 23:00', // → 本地 07:00
      '2026-06-14 00:00', // → 本地 08:00
      '2026-06-14 07:00', // → 本地 15:00
      '2026-06-14 15:00', // → 本地 23:00
    ];

    const localHours = utcHours.map(h => utcHourToLocal(h, -480));

    expect(localHours).toEqual([
      '2026-06-14 00:00',
      '2026-06-14 01:00',
      '2026-06-14 02:00',
      '2026-06-14 07:00',
      '2026-06-14 08:00',
      '2026-06-14 15:00',
      '2026-06-14 23:00',
    ]);

    // 所有本地时间都在 2026-06-14 这一天内
    localHours.forEach(h => {
      expect(h).toMatch(/^2026-06-14/);
    });
  });
});
