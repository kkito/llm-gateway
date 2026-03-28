import { Hono } from 'hono';
import { StatsView } from '../views/stats.js';
import { getCurrentUser } from '../middleware/auth.js';
import { loadStats } from '../../lib/stats-core.js';
import { loadFullConfig } from '../../config.js';

export function createStatsRoute(configPath?: string) {
  const app = new Hono();

  app.get('/', (c) => {
    // 检查是否启用了认证
    let isAuthEnabled = false;
    if (configPath) {
      const fullConfig = loadFullConfig(configPath);
      isAuthEnabled = !!(fullConfig.userApiKeys && fullConfig.userApiKeys.length > 0);
    }

    // 未启用认证时，直接显示统计页面
    if (!isAuthEnabled) {
      const stats = loadStats('./logs/proxy', {});
      return c.html(<StatsView stats={stats} userName="Guest" />);
    }

    // 已启用认证，需要登录
    const currentUser = getCurrentUser(c, configPath);
    if (!currentUser) {
      return c.redirect('/user/login');
    }

    const stats = loadStats('./logs/proxy', { userName: currentUser.name });

    return c.html(<StatsView stats={stats} userName={currentUser.name} />);
  });

  return app;
}
