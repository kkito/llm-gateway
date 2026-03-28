import { Hono } from 'hono';
import { loadStats } from '../../lib/stats-core.js';
import { getProxyDir } from '../../config.js';
import { join } from 'path';

export function createStatsApiRoute() {
  const app = new Hono();

  // 统计数据 API
  app.get('/admin/api/stats', (c) => {
    try {
      const date = c.req.query('date');
      const week = c.req.query('week');
      const month = c.req.query('month');
      const byHour = c.req.query('byHour') === 'true';
      const logDir = c.req.query('logDir');

      // 解析日志目录
      const defaultDir = getProxyDir();
      const actualLogDir = logDir || join(defaultDir, 'logs/proxy');

      // 构建查询选项
      const options: { date?: string; week?: string; month?: string; byHour?: boolean } = {};
      if (date) options.date = date;
      if (week) options.week = week;
      if (month) options.month = month;
      if (byHour) options.byHour = true;

      // 加载统计数据
      const stats = loadStats(actualLogDir, options);

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
