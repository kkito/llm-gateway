import { Hono } from 'hono';
import { StatsPage } from '../views/stats.js';
import { loadStats } from '../../lib/stats-core.js';
import { getLogDir } from '../../config.js';
import { getStatsProvider } from './stats-api.js';

export function createStatsRoute() {
  const app = new Hono();

  // 统计页面
  app.get('/admin/stats', async (c) => {
    try {
      const date = c.req.query('date');
      const week = c.req.query('week');
      const month = c.req.query('month');
      const byHour = c.req.query('byHour') === 'true';
      const logDirOverride = c.req.query('logDir');

      // 获取日志目录
      let logDir: string;
      const statsProvider = getStatsProvider();
      if (logDirOverride) {
        logDir = logDirOverride;
      } else if (statsProvider) {
        logDir = statsProvider.getLogDir();
      } else {
        logDir = getLogDir();
      }

      // 构建查询选项
      const options: { date?: string; week?: string; month?: string; byHour?: boolean } = {};
      let currentType: 'today' | 'date' | 'week' | 'month' = 'today';
      let currentValue = '';

      if (date) {
        options.date = date;
        currentType = 'date';
        currentValue = date;
      } else if (week) {
        options.week = week;
        currentType = 'week';
        currentValue = week;
      } else if (month) {
        options.month = month;
        currentType = 'month';
        currentValue = month;
      }

      if (byHour) options.byHour = true;

      // 加载统计数据
      const stats = loadStats(logDir, options);

      // 构建日期范围显示
      let dateRange = '今日';
      if (date) dateRange = date;
      else if (week) {
        dateRange = week;
      } else if (month) {
        dateRange = month;
      }

      return c.html(
        <StatsPage
          stats={stats}
          dateRange={dateRange}
          currentType={currentType}
          currentValue={currentValue}
        />
      );

    } catch (error: any) {
      console.error('统计页面错误:', error.message);
      return c.html(
        <html>
          <head>
            <title>错误</title>
          </head>
          <body>
            <h1>❌ 统计失败</h1>
            <p>{error.message}</p>
            <a href="/admin/stats">返回首页</a>
          </body>
        </html>
      );
    }
  });

  return app;
}
