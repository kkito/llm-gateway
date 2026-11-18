/**
 * Resolve the client IP for an incoming Hono request.
 * Priority: X-Forwarded-For (first entry) -> X-Real-IP -> connection socket address.
 */
export function getClientIp(c: any): string | null {
  const header = (name: string): string | null => {
    try {
      const value = c?.req?.header?.(name);
      return typeof value === 'string' && value.trim() ? value : null;
    } catch {
      return null;
    }
  };

  const forwarded = header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = header('x-real-ip');
  if (realIp) return realIp.trim();

  try {
    const raw: unknown = c?.env?.incoming?.socket?.remoteAddress;
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim().replace(/^::ffff:/, '');
    }
  } catch {
    // ignore
  }

  return null;
}
