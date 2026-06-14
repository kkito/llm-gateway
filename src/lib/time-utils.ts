/**
 * UTC ISO 时间与本地时间转换工具
 * DB 中 timestamp 存的是 UTC ISO 字符串 (如 "2026-06-14T10:00:00.000Z")，
 * 这些函数用于在客户端/服务端将其转为本地时间。
 *
 * 该模块同时支持两种模式：
 * - tzOffset 模式：使用分钟偏移（浏览器 Date.getTimezoneOffset() 约定）
 * - IANA 时区模式：使用 IANA 时区名（如 Asia/Shanghai），支持 DST
 *
 * tzOffset 模式用于 CLI（本地机器时区固定），IANA 模式用于 Web 页面。
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

// ────────────────────────────────────────────
// IANA 时区模式（方案 B）
// ────────────────────────────────────────────

// 缓存 Intl.DateTimeFormat 实例（同一时区复用，避免反复构造）
const tzFormatCache = new Map<string, Intl.DateTimeFormat>();

function getTzFormat(timeZone: string): Intl.DateTimeFormat {
  let fmt = tzFormatCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric' as const,
      month: '2-digit' as const,
      day: '2-digit' as const,
    });
    tzFormatCache.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * 用 Intl.DateTimeFormat 格式化时间戳，返回 [year, month, day]
 * en-CA locale 输出格式为 "YYYY-MM-DD"
 */
function formatTzDate(ms: number, fmt: Intl.DateTimeFormat): [number, number, number] {
  const parts = fmt.formatToParts(new Date(ms));
  let y = 0, m = 0, d = 0;
  for (const part of parts) {
    if (part.type === 'year') y = Number(part.value);
    else if (part.type === 'month') m = Number(part.value);
    else if (part.type === 'day') d = Number(part.value);
  }
  return [y, m, d];
}

/**
 * 用 Intl.DateTimeFormat 格式化时间戳，返回本地时间的 [year, month, day, hour]
 * en-US locale + hour12: false 输出 hour 为 0-23
 */
function formatTzDateTime(ms: number, timeZone: string): [number, number, number, number] {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  let y = 0, m = 0, d = 0, h = 0;
  for (const part of parts) {
    if (part.type === 'year') y = Number(part.value);
    else if (part.type === 'month') m = Number(part.value);
    else if (part.type === 'day') d = Number(part.value);
    else if (part.type === 'hour') h = Number(part.value);
  }
  return [y, m, d, h];
}

/**
 * 校验 IANA 时区名是否有效
 *
 * 通过尝试构造 Intl.DateTimeFormat 来判断。无效时区会抛出 RangeError。
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取指定时区的"今天"日期字符串
 *
 * @param timeZone IANA 时区名（如 "Asia/Shanghai"）
 * @returns "YYYY-MM-DD" 格式
 */
export function getLocalToday(timeZone: string): string {
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const fmt = getTzFormat(tz);
  const [y, m, d] = formatTzDate(Date.now(), fmt);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * 将 IANA 时区下的本地日期转为 UTC 时间戳（毫秒）
 *
 * 核心算法：
 * 1) 假设本地午夜 = UTC 午夜，构造初始 ms
 * 2) 用 Intl.DateTimeFormat 将该 ms 格式化成指定时区的本地日期
 * 3) 如果格式化后的日期与目标日期一致，结束
 * 4) 否则用 24h 的倍数修正 ms（diffDays * 86400000）
 * 5) 通常 1-2 次迭代收敛
 *
 * @param localDate "YYYY-MM-DD"
 * @param timeZone IANA 时区名
 * @returns 该本地日期 00:00 对应的 UTC 毫秒时间戳
 */
export function localDateToUtcMs(localDate: string, timeZone: string): number {
  const [y, m, d] = localDate.split('-').map(Number);

  // 从 Date.UTC(y,m-1,d,0,0,0,0) 开始，迭代修正直至本地日期匹配且本地小时为 0
  let ms = Date.UTC(y, m - 1, d, 0, 0, 0, 0);

  for (let i = 0; i < 3; i++) {
    const [localY, localM, localD, localH] = formatTzDateTime(ms, timeZone);

    if (localY === y && localM === m && localD === d) {
      // 日期匹配：如果 localH === 0，找到了本地午夜
      if (localH === 0) break;
      // 否则往回推 localH 小时
      ms -= localH * 3600 * 1000;
    } else {
      // 日期不匹配，按天调整
      const targetMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
      const fmtMs = Date.UTC(localY, localM - 1, localD, 0, 0, 0, 0);
      const diffDays = Math.round((fmtMs - targetMs) / 86400000);
      ms -= diffDays * 86400000;
    }
  }

  return ms;
}

/**
 * 将 IANA 时区下的本地日期转为 UTC 日期范围
 *
 * @param localDate 本地日期 "YYYY-MM-DD"
 * @param timeZone  IANA 时区名（如 "Asia/Shanghai"），无效时退回到 "UTC"
 * @returns [utcStart, utcEnd] UTC ISO 字符串数组
 */
export function localDateToUtcRangeTz(localDate: string, timeZone: string): [string, string] {
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const utcStartMs = localDateToUtcMs(localDate, tz);
  const utcEndMs = utcStartMs + 24 * 60 * 60 * 1000 - 1;
  return [new Date(utcStartMs).toISOString(), new Date(utcEndMs).toISOString()];
}
