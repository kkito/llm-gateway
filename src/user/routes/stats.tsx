import { Hono } from 'hono';
import { StatsView } from '../views/stats.js';
import { getCurrentUser } from '../middleware/auth.js';
import { loadStats } from '../../lib/stats-core.js';
import { DatabaseManager } from '../../lib/db.js';
import { join } from 'path';
import { getProxyDir } from '../../config.js';

export function createStatsRoute(configPath?: string) {
  const app = new Hono();

  app.get('/', async (c) => {
    try {
      // 检查是否启用了认证
      let isAuthEnabled = false;
      if (configPath) {
        const { loadFullConfig } = await import('../../config.js');
        const fullConfig = loadFullConfig(configPath);
        isAuthEnabled = !!(fullConfig.userApiKeys && fullConfig.userApiKeys.length > 0);
      }

      // 初始化数据库
      const configDir = join(getProxyDir(), 'logs', '..');
      const dbManager = DatabaseManager.getInstance(configDir);
      dbManager.initialize();

      // 未启用认证时，直接显示统计页面
      if (!isAuthEnabled) {
        const stats = await loadStats(dbManager.getDb(), {});
        dbManager.close();
        return c.html(<StatsView stats={stats} userName="Guest" />);
      }

      // 已启用认证，需要登录
      const currentUser = getCurrentUser(c, configPath);
      if (!currentUser) {
        dbManager.close();
        return c.redirect('/user/login');
      }

      const stats = await loadStats(dbManager.getDb(), { userName: currentUser.name });
      dbManager.close();

      return c.html(<StatsView stats={stats} userName={currentUser.name} />);
    } catch (error) {
      console.error('获取用户统计失败:', error);
      return c.html('<h1>获取统计信息失败</h1>');
    }
  });

  return app;
}
