import { Hono } from 'hono';
import { StatsProvider } from '../../lib/stats-provider.js';
import { getLogDir } from '../../config.js';

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
      const logDir = c.req.query('logDir');
      const forceReload = c.req.query('forceReload') === 'true';

      // 使用统一的日志目录
      // 优先通过 query 参数指定的 logDir，否则从全局 StatsProvider 获取
      // 这样即使服务器启动时使用了 --log-dir 参数，API 也能找到正确的日志目录
      let actualLogDir: string;
      if (logDir) {
        actualLogDir = logDir;
      } else if (statsProvider) {
        actualLogDir = statsProvider.getLogDir();
      } else {
        actualLogDir = getLogDir();
      }

      // 构建查询选项
      const options: { date?: string; week?: string; month?: string; byHour?: boolean; forceReload?: boolean } = {};
      if (date) options.date = date;
      if (week) options.week = week;
      if (month) options.month = month;
      if (byHour) options.byHour = true;
      if (forceReload) options.forceReload = true;

      // 优先使用 StatsProvider（内存缓存），如果未初始化则回退到直接加载
      let stats;
      if (statsProvider && !forceReload) {
        stats = await statsProvider.getStats(options);
      } else {
        // 回退到旧的 loadStats 方法
        const { loadStats } = await import('../../lib/stats-core.js');
        stats = loadStats(actualLogDir, options);
      }

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
