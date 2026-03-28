import { Hono } from 'hono';
import { LoginView } from '../views/login.js';
import { loginUserSession } from '../middleware/auth.js';

export const loginRoute = new Hono();

loginRoute.get('/', (c) => {
  return c.html(<LoginView />);
});

loginRoute.post('/', async (c) => {
  const body = await c.req.parseBody();
  const apiKey = body.apikey as string;

  if (!apiKey) {
    return c.html(<LoginView error="请输入 API Key" />, 400);
  }

  const sessionId = loginUserSession(apiKey);
  if (!sessionId) {
    return c.html(<LoginView error="无效的 API Key" />, 401);
  }

  // 设置 Session Cookie
  c.header('Set-Cookie', `user_session=${sessionId}; Path=/; HttpOnly`);
  return c.redirect('/user/main');
});
