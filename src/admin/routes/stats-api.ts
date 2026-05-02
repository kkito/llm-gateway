import { Hono } from 'hono';
import { StatsProvider } from '../../lib/stats-provider.js';

// 全局 StatsProvider 实例（延迟初始化）
let statsProvider: StatsProvider | null = null;

/**
 * 初始化 StatsProvider
 * 需要在 server.ts 中调用 initStatsProvider 进行初始化
 */
export function initStatsProvider(provider: StatsProvider): void {
  statsProvider = provider;
}

export function getStatsProvider(): StatsProvider | null {
  return statsProvider;
}

export function createStatsApiRoute() {
  const app = new Hono();

  // 统计数据 API
  app.get('/admin/api/stats', async (c) => {
    try {
      const date = c.req.query('date');
      const week = c.req.query('week');
      const month = c.req.query('month');
      const byHour = c.req.query('byHour') === 'true';
      const forceReload = c.req.query('forceReload') === 'true';

      // 构建查询选项
      const options: { date?: string; week?: string; month?: string; byHour?: boolean; forceReload?: boolean } = {};
      if (date) options.date = date;
      if (week) options.week = week;
      if (month) options.month = month;
      if (byHour) options.byHour = true;
      if (forceReload) options.forceReload = true;

      // 使用 StatsProvider 获取统计
      if (!statsProvider) {
        return c.json({
          success: false,
          error: 'StatsProvider 未初始化'
        }, 500);
      }

      const stats = await statsProvider.getStats(options);

      return c.json({
        success: true,
        data: stats,
        dateRange: date || week || month || '今日'
      });

    } catch (error: any) {
      console.error('统计 API 错误:', error.message);
      return c.json({
        success: false,
        error: error.message
      }, 500);
    }
  });

  return app;
}
