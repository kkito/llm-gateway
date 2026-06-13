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
 * tzOffset 使用浏览器 Date.getTimezoneOffset() 的约定：
 *   UTC+8 → -480, UTC-5 → 300, UTC+0 → 0
 *
 * 原理：本地日期 00:00 对应的 UTC 毫秒数 = Date.UTC(y,m-1,d) + tzOffset * 60000
 * 因为 Date.UTC 已按 UTC 0:00 计算，东时区需要往回偏移（负数 offset），
 * 西时区需要往前偏移（正数 offset）。
 *
 * @param localDate 本地日期 "YYYY-MM-DD"
 * @param tzOffset  客户端时区偏移分钟数（UTC+8 → -480）
 * @returns [utcStart, utcEnd] UTC ISO 字符串数组
 */
export function localDateToUtcRange(localDate: string, tzOffset: number): [string, string] {
  const [y, m, d] = localDate.split('-').map(Number);
  const localMidnightMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const utcStartMs = localMidnightMs + tzOffset * 60 * 1000;
  const utcEndMs = utcStartMs + 24 * 60 * 60 * 1000 - 1;
  return [new Date(utcStartMs).toISOString(), new Date(utcEndMs).toISOString()];
}
