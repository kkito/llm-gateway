import { Hono } from 'hono';
import { userSessions } from '../middleware/auth.js';

export function createLogoutRoute() {
  const app = new Hono();

  // 处理登出
  app.get('/user/logout', (c) => {
    // 从 Cookie 获取 Session ID
    const sessionId = c.req.header('Cookie')?.match(/user_session=([^;]+)/)?.[1];
    
    if (sessionId) {
      // 清除 Session
      userSessions.delete(sessionId);
    }

    // 清除 Cookie 并重定向到登录页
    const newRes = c.redirect('/user/login');
    newRes.headers.set('Set-Cookie', 'user_session=; Path=/; Max-Age=0; HttpOnly');
    return newRes;
  });

  return app;
}
