import { Hono } from 'hono';
import { StatsView } from '../views/stats.js';
import { getCurrentUser } from '../middleware/auth.js';
import { loadStats } from '../../lib/stats-core.js';
import { loadFullConfig, getProxyDir } from '../../config.js';
import { join } from 'path';

export function createStatsRoute(configPath?: string) {
  const app = new Hono();

  app.get('/', async (c) => {
    try {
      // 检查是否启用了认证
      let isAuthEnabled = false;
      if (configPath) {
        const fullConfig = loadFullConfig(configPath);
        isAuthEnabled = !!(fullConfig.userApiKeys && fullConfig.userApiKeys.length > 0);
      }

      // 获取正确的日志目录
      const logDir = join(getProxyDir(), 'logs/proxy');

      // 未启用认证时，直接显示统计页面
      if (!isAuthEnabled) {
        const stats = loadStats(logDir, {});
        return c.html(<StatsView stats={stats} userName="Guest" />);
      }

      // 已启用认证，需要登录
      const currentUser = getCurrentUser(c, configPath);
      if (!currentUser) {
        return c.redirect('/user/login');
      }

      const stats = loadStats(logDir, { userName: currentUser.name });

      return c.html(<StatsView stats={stats} userName={currentUser.name} />);
    } catch (error) {
      console.error('获取用户统计失败:', error);
      return c.html('<h1>获取统计信息失败</h1>');
    }
  });

  return app;
}
