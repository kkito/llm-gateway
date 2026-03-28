import { Hono } from 'hono';
import type { ProviderConfig } from '../../config.js';
import { HomePage } from '../views/home.js';
import { getCurrentUser } from '../middleware/auth.js';

export function createHomeRoute(config: ProviderConfig[] | (() => ProviderConfig[])) {
  const app = new Hono();

  // 根路径重定向到 /user/main
  app.get('/', (c) => {
    return c.redirect('/user/main');
  });

  // 用户主页/配置指南
  app.get('/user/main', (c) => {
    const currentUser = getCurrentUser(c);
    if (!currentUser) {
      return c.redirect('/user/login');
    }

    const currentConfig = typeof config === 'function' ? config() : config;
    return c.html(<HomePage models={currentConfig} userName={currentUser.name} />);
  });

  return app;
}
