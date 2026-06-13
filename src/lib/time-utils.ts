/**
 * UTC ISO 时间与本地时间转换工具
 * DB 中 timestamp 存的是 UTC ISO 字符串 (如 "2026-06-14T10:00:00.000Z")，
 * 这些函数用于在客户端/服务端将其转为本地时间。
 */

/** 将 UTC ISO 字符串转成本地时间格式 "YYYY-MM-DD HH:mm:ss" */
export function utcToLocalString(utcStr: string): string {
  const d = new Date(utcStr);
  if (isNaN(d.getTime())) return utcStr;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 从 UTC ISO 字符串中提取本地小时 (0-23) */
export function getLocalHour(utcStr: string): number {
  return new Date(utcStr).getHours();
}

/**
 * 将本地日期 + 时区偏移转为 UTC 日期范围
 *
 * 原理：本地日期 00:00 对应的 UTC 毫秒数 = UTC(1970-01-01) + localDateEpochMs - tzOffsetMs
 * 直接用 Date.UTC 构造避免 Date 的本地时区干扰。
 *
 * @param localDate 本地日期 "YYYY-MM-DD"
 * @param tzOffset  客户端时区偏移分钟数 (UTC+8 → 480)
 * @returns [utcStart, utcEnd] UTC ISO 字符串数组
 */
export function localDateToUtcRange(localDate: string, tzOffset: number): [string, string] {
  const [y, m, d] = localDate.split('-').map(Number);
  // 本地日期 00:00:00.000 的 UTC 毫秒时间戳
  const localMidnightMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const offsetMs = tzOffset * 60 * 1000;
  const utcStartMs = localMidnightMs - offsetMs;
  const utcEndMs = utcStartMs + 24 * 60 * 60 * 1000 - 1; // 加上几乎一整天
  return [new Date(utcStartMs).toISOString(), new Date(utcEndMs).toISOString()];
}
