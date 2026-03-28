import { Context, Next } from 'hono';

// 简单的内存 Session 存储
const sessions = new Set<string>();

/**
 * 生成 Session ID
 */
function generateSessionId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * 认证中间件 - 检查是否已登录
 */
export async function authMiddleware(c: Context, next: Next) {
  const sessionId = c.req.header('Authorization')?.replace('Bearer ', '') || 
                    c.req.query('session') ||
                    (c as any).session?.id;

  if (!sessionId || !sessions.has(sessionId)) {
    // 未登录，重定向到登录页
    return c.redirect('/admin/login');
  }

  await next();
}

/**
 * 设置 Session
 */
export function setSession(sessionId: string): void {
  sessions.add(sessionId);
}

/**
 * 清除 Session
 */
export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/**
 * 检查是否已配置密码
 */
export function isPasswordConfigured(adminPassword?: string): boolean {
  return !!adminPassword && adminPassword.length > 0;
}
