import { Hono } from 'hono';
import { UsageTracker } from '../../lib/usage-tracker.js';

let usageTracker: UsageTracker | null = null;

/**
 * 初始化 UsageTracker（在 server.ts 中调用）
 */
export function initUsageApiTracker(tracker: UsageTracker): void {
  usageTracker = tracker;
}

export function createUsageApiRoute() {
  const app = new Hono();

  // 实时用量 API - 直接从 UsageTracker 内存读取
  app.get('/admin/api/usage', (c) => {
    if (!usageTracker) {
      return c.json({ error: 'UsageTracker not initialized' }, 500);
    }

    const model = c.req.query('model');
    if (!model) {
      return c.json({ error: 'model parameter required' }, 400);
    }

    const counter = usageTracker.getCounter(model);
    
    return c.json({
      success: true,
      data: {
        model,
        requests: counter.today.requests,
        inputTokens: counter.today.inputTokens,
        cost: counter.today.cost,
        date: counter.today.date
      }
    });
  });

  return app;
}
