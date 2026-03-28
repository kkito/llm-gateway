import { Hono } from 'hono';
import { StatsPage } from '../views/stats.js';
import { loadStats } from '../../lib/stats-core.js';
import { getProxyDir } from '../../config.js';
import { join } from 'path';

export function createStatsRoute() {
  const app = new Hono();

  // 统计页面
  app.get('/admin/stats', (c) => {
    try {
      const date = c.req.query('date');
      const week = c.req.query('week');
      const month = c.req.query('month');
      const byHour = c.req.query('byHour') === 'true';

      // 解析日志目录
      const defaultDir = getProxyDir();
      const logDir = join(defaultDir, 'logs/proxy');

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
        // 简单显示周数
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
