export function calcTps(
  completionTokens: number | null | undefined,
  durationMs: number | null | undefined,
  ttftMs: number | null | undefined,
): number | null {
  if (completionTokens == null || durationMs == null || ttftMs == null) return null;
  if (completionTokens <= 0) return null;
  if (durationMs <= ttftMs) return null;
  const secs = (durationMs - ttftMs) / 1000;
  if (secs <= 0) return null;
  return Math.round((completionTokens / secs) * 10) / 10;
}
