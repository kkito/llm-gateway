import { Hono } from 'hono';
import type { ProviderConfig } from '../../config.js';
import { HomePage } from '../views/home.js';
import { getCurrentUser } from '../middleware/auth.js';
import { loadFullConfig } from '../../config.js';

export function createHomeRoute(config: ProviderConfig[] | (() => ProviderConfig[]), configPath?: string) {
  const app = new Hono();

  // 根路径重定向到 /user/main
  app.get('/', (c) => {
    return c.redirect('/user/main');
  });

  // 用户主页/配置指南
  app.get('/user/main', (c) => {
    // 检查是否启用了认证
    let isAuthEnabled = false;
    if (configPath) {
      const fullConfig = loadFullConfig(configPath);
      isAuthEnabled = !!(fullConfig.userApiKeys && fullConfig.userApiKeys.length > 0);
    }

    // 未启用认证时，直接显示页面（无需登录）
    if (!isAuthEnabled) {
      const currentConfig = typeof config === 'function' ? config() : config;
      // 未启用认证时，不显示用户名（无 Guest 概念）
      return c.html(<HomePage models={currentConfig} userName={undefined} />);
    }

    // 已启用认证，需要登录
    const currentUser = getCurrentUser(c, configPath);
    if (!currentUser) {
      return c.redirect('/user/login');
    }

    const currentConfig = typeof config === 'function' ? config() : config;
    return c.html(<HomePage models={currentConfig} userName={currentUser.name} />);
  });

  return app;
}
