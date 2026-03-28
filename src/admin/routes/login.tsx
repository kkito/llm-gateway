import { Hono } from 'hono';
import { LoginPage } from '../views/login.js';
import { hashPassword, verifyPassword, loadFullConfig, saveConfig } from '../../config.js';
import { setSession, isPasswordConfigured } from '../middleware/auth.js';

interface RouteDeps {
  configPath: string;
}

function generateSessionId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export function createLoginRoute(deps: RouteDeps) {
  const { configPath } = deps;
  const app = new Hono();

  // 显示登录页
  app.get('/admin/login', (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      const isSetup = !isPasswordConfigured(proxyConfig.adminPassword);
      return c.html(<LoginPage isSetup={isSetup} />);
    } catch (error: any) {
      return c.html(<LoginPage error="配置加载失败" />);
    }
  });

  // 处理登录
  app.post('/admin/login', async (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      const body = await c.req.parseBody();
      const password = body.password as string;

      if (!password) {
        return c.html(<LoginPage error="请输入密码" />);
      }

      // 首次设置密码
      if (!isPasswordConfigured(proxyConfig.adminPassword)) {
        const digest = hashPassword(password);
        proxyConfig.adminPassword = digest;

        // 保存配置
        saveConfig(proxyConfig, configPath);

        // 设置 Session
        const sessionId = generateSessionId();
        setSession(sessionId);

        // 重定向到模型列表
        const newRes = c.redirect('/admin/models');
        newRes.headers.set('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly`);
        return newRes;
      }

      // 验证密码
      if (!verifyPassword(password, proxyConfig.adminPassword!)) {
        return c.html(<LoginPage error="密码错误" />);
      }

      // 设置 Session
      const sessionId = generateSessionId();
      setSession(sessionId);

      // 重定向到模型列表
      const newRes = c.redirect('/admin/models');
      newRes.headers.set('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly`);
      return newRes;
    } catch (error: any) {
      return c.html(<LoginPage error={`登录失败：${error.message}`} />);
    }
  });

  return app;
}
