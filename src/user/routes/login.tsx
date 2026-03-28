import { Hono } from 'hono';
import { LoginPage } from '../views/login.js';
import { loginUserSession } from '../middleware/auth.js';
import { loadFullConfig } from '../../config.js';

interface RouteDeps {
  configPath?: string;
}

export function createLoginRoute(deps?: RouteDeps) {
  const { configPath } = deps || {};
  const app = new Hono();

  // 显示登录页
  app.get('/user/login', (c) => {
    return c.html(<LoginPage />);
  });

  // 处理登录
  app.post('/user/login', async (c) => {
    try {
      const body = await c.req.parseBody();
      const apikey = body.apikey as string;

      if (!apikey) {
        return c.html(<LoginPage error="请输入 API Key" />);
      }

      // 验证 API Key 并创建 Session
      const sessionId = loginUserSession(apikey, configPath);

      if (!sessionId) {
        return c.html(<LoginPage error="无效的 API Key" />);
      }

      // 设置 Session Cookie 并重定向
      const newRes = c.redirect('/user/main');
      newRes.headers.set('Set-Cookie', `user_session=${sessionId}; Path=/; HttpOnly`);
      return newRes;
    } catch (error: any) {
      return c.html(<LoginPage error={`登录失败：${error.message}`} />);
    }
  });

  return app;
}
