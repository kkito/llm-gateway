import { Hono } from 'hono';
import { LoginView } from '../views/login.js';
import { loginUserSession } from '../middleware/auth.js';

interface RouteDeps {
  configPath: string;
}

export function createLoginRoute(deps: RouteDeps) {
  const { configPath } = deps;
  const app = new Hono();

  app.get('/', (c) => {
    return c.html(<LoginView />);
  });

  app.post('/', async (c) => {
    const body = await c.req.parseBody();
    const apiKey = body.apikey as string;

    if (!apiKey) {
      return c.html(<LoginView error="请输入 API Key" />, 200);
    }

    const sessionId = loginUserSession(apiKey, configPath);
    if (!sessionId) {
      return c.html(<LoginView error="无效的 API Key" />, 200);
    }

    // 设置 Session Cookie
    c.header('Set-Cookie', `user_session=${sessionId}; Path=/; HttpOnly`);
    return c.redirect('/user/main');
  });

  return app;
}
