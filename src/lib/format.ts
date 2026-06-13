/**
 * 格式化大数字为人类可读形式
 * 0-999 → 原样
 * 1,000-999,999 → X.XK
 * 1,000,000+ → X.XM
 */
export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

/**
 * 格式化耗时
 * 0-999ms → Xms
 * 1,000ms+ → X.Xs
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1).replace(/\.0$/, '') + 's';
}

/**
 * 格式化百分比
 */
export function formatPct(value: number, total: number): string {
  if (total <= 0) return '0%';
  return ((value / total) * 100).toFixed(1) + '%';
}
