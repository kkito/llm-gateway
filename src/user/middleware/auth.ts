import { Context, Next } from 'hono';
import { loadFullConfig } from '../../config.js';
import type { UserApiKey } from '../../config.js';

/**
 * 用户 Session 存储（内存）
 */
export const userSessions = new Map<string, UserApiKey>();

/**
 * 生成用户 Session ID
 */
function generateUserSessionId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * 用户登录（通过 API Key）
 */
export function loginUserSession(apiKey: string, configPath: string): string | null {
  const config = loadFullConfig(configPath);
  const user = config.userApiKeys?.find(u => u.apikey === apiKey);
  if (!user) return null;

  const sessionId = generateUserSessionId();
  userSessions.set(sessionId, user);
  return sessionId;
}

/**
 * 获取当前登录用户
 */
export function getCurrentUser(c: Context, configPath?: string): UserApiKey | null {
  // 1. 优先从 API Key 获取（API 调用）
  const apiKey =
    c.req.header('Authorization')?.replace('Bearer ', '') ||
    c.req.header('x-api-key');

  if (apiKey && configPath) {
    const config = loadFullConfig(configPath);
    return config.userApiKeys?.find(u => u.apikey === apiKey) || null;
  }

  // 2. 从 Session 获取（Web 界面）
  const sessionId =
    c.req.header('Cookie')?.match(/user_session=([^;]+)/)?.[1] ||
    c.req.query('session');

  if (sessionId && userSessions.has(sessionId)) {
    return userSessions.get(sessionId)!;
  }

  return null;
}

/**
 * 用户认证中间件
 */
export function createUserAuthMiddleware(configPath: string) {
  return async (c: Context, next: Next) => {
    const config = loadFullConfig(configPath);
    const isAuthEnabled = config.userApiKeys && config.userApiKeys.length > 0;

    // 未启用认证，直接放行
    if (!isAuthEnabled) {
      await next();
      return;
    }

    // 登录页面和登出路由无需认证
    if (c.req.path === '/user/login' || c.req.path === '/user/logout') {
      await next();
      return;
    }

    // 从 Session 获取用户（Web 界面）
    const sessionId =
      c.req.header('Cookie')?.match(/user_session=([^;]+)/)?.[1] ||
      c.req.query('session');

    if (sessionId && userSessions.has(sessionId)) {
      (c as any).currentUser = userSessions.get(sessionId)!;
      await next();
      return;
    }

    // 提取 API Key（支持两种方式）
    const apiKey =
      c.req.header('Authorization')?.replace('Bearer ', '') ||
      c.req.header('x-api-key');

    if (!apiKey) {
      // Web 页面请求，重定向到登录页
      if (c.req.path.startsWith('/user/')) {
        return c.redirect('/user/login');
      }
      // API 请求，返回 401
      return c.json({ error: { message: 'Missing API Key' } }, 401);
    }

    // 验证 API Key 是否存在
    const validUser = config.userApiKeys?.find(u => u.apikey === apiKey);
    if (!validUser) {
      // Web 页面请求，重定向到登录页
      if (c.req.path.startsWith('/user/')) {
        return c.redirect('/user/login');
      }
      // API 请求，返回 401
      return c.json({ error: { message: 'Invalid API Key' } }, 401);
    }

    // 将用户信息注入上下文
    (c as any).currentUser = validUser;
    await next();
  };
}
