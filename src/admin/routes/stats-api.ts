import { Hono } from 'hono';
import { DatabaseManager } from '../../lib/db.js';
import { localDateToUtcRange } from '../../lib/time-utils.js';

/**
 * 重置 StatsProvider 实例（保留导出以兼容调用方）
 */
export function resetStatsProvider(): void {
  // no-op: StatsProvider 已移除
}

/**
 * 初始化 StatsProvider（保留导出以兼容调用方）
 */
export function initStatsProvider(_provider: any): void {
  // no-op: StatsProvider 已移除
}

export function getStatsProvider(): null {
  return null;
}

export function createStatsApiRoute() {
  const app = new Hono();

  app.get('/admin/api/stats', async (c) => {
    try {
      const dbManager = DatabaseManager.getExistingInstance();
      if (!dbManager) {
        return c.json({ success: false, error: '数据库未初始化' }, 500);
      }
      const db = dbManager.getDb();

      const now = new Date();
      const localToday = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');

      const startDate = c.req.query('startDate') || localToday;
      const endDate = c.req.query('endDate') || startDate;
      const selectedUser = c.req.query('userName') || '';
      const selectedModel = c.req.query('model') || '';
      const tzOffset = c.req.query('tzOffset') !== undefined
        ? parseInt(c.req.query('tzOffset')!, 10)
        : new Date().getTimezoneOffset();

      const [utcStart] = localDateToUtcRange(startDate, tzOffset);
      const [, utcEnd] = localDateToUtcRange(endDate, tzOffset);

      const conditions: string[] = ['timestamp >= ?', 'timestamp <= ?'];
      const params: any[] = [utcStart, utcEnd];

      if (selectedUser) {
        conditions.push('user_name = ?');
        params.push(selectedUser);
      }
      if (selectedModel) {
        conditions.push('custom_model = ?');
        params.push(selectedModel);
      }

      const whereClause = conditions.join(' AND ');

      // 概览聚合
      const overview = db.prepare(`
        SELECT
          COUNT(*) AS totalRequests,
          COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END), 0) AS successfulRequests,
          COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) AS failedRequests,
          COALESCE(AVG(duration_ms), 0) AS avgDuration,
          COALESCE(SUM(prompt_tokens), 0) AS totalInputTokens,
          COALESCE(SUM(completion_tokens), 0) AS totalOutputTokens,
          COALESCE(SUM(total_tokens), 0) AS totalTokens,
          COALESCE(SUM(cached_tokens), 0) AS totalCachedTokens
        FROM requests
        WHERE ${whereClause}
      `).get(...params) as {
        totalRequests: number;
        successfulRequests: number;
        failedRequests: number;
        avgDuration: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        totalTokens: number;
        totalCachedTokens: number;
      };

      // 按模型分组
      const byModelRows = db.prepare(`
        SELECT
          custom_model AS model,
          COUNT(*) AS requests,
          COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END), 0) AS successful,
          COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) AS failed,
          COALESCE(SUM(prompt_tokens), 0) AS inputTokens,
          COALESCE(SUM(completion_tokens), 0) AS outputTokens,
          COALESCE(SUM(total_tokens), 0) AS totalTokens,
          COALESCE(SUM(cached_tokens), 0) AS cachedTokens
        FROM requests
        WHERE ${whereClause}
        GROUP BY custom_model
        ORDER BY requests DESC
      `).all(...params) as Array<{
        model: string;
        requests: number;
        successful: number;
        failed: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cachedTokens: number;
      }>;

      const byModel: Record<string, any> = {};
      for (const row of byModelRows) {
        byModel[row.model] = {
          requests: row.requests,
          successful: row.successful,
          failed: row.failed,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          totalTokens: row.totalTokens,
          cachedTokens: row.cachedTokens,
        };
      }

      // 按 Provider 分组
      const byProviderRows = db.prepare(`
        SELECT
          COALESCE(provider, 'unknown') AS provider,
          COUNT(*) AS requests,
          COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END), 0) AS successful,
          COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) AS failed,
          COALESCE(SUM(prompt_tokens), 0) AS inputTokens,
          COALESCE(SUM(completion_tokens), 0) AS outputTokens,
          COALESCE(SUM(total_tokens), 0) AS totalTokens,
          COALESCE(SUM(cached_tokens), 0) AS cachedTokens
        FROM requests
        WHERE ${whereClause}
        GROUP BY provider
        ORDER BY requests DESC
      `).all(...params) as Array<{
        provider: string;
        requests: number;
        successful: number;
        failed: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cachedTokens: number;
      }>;

      const byProvider: Record<string, any> = {};
      for (const row of byProviderRows) {
        byProvider[row.provider] = {
          requests: row.requests,
          successful: row.successful,
          failed: row.failed,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          totalTokens: row.totalTokens,
          cachedTokens: row.cachedTokens,
        };
      }

      // 按小时分布
      const byHourRows = db.prepare(`
        SELECT
          strftime('%Y-%m-%d %H:00', timestamp) AS hour,
          COUNT(*) AS requests,
          COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END), 0) AS successful,
          COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) AS failed,
          COALESCE(SUM(prompt_tokens), 0) AS inputTokens,
          COALESCE(SUM(completion_tokens), 0) AS outputTokens,
          COALESCE(SUM(total_tokens), 0) AS totalTokens,
          COALESCE(SUM(cached_tokens), 0) AS cachedTokens
        FROM requests
        WHERE ${whereClause}
        GROUP BY hour
        ORDER BY hour ASC
      `).all(...params) as Array<{
        hour: string;
        requests: number;
        successful: number;
        failed: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cachedTokens: number;
      }>;

      const byHour: Record<string, any> = {};
      for (const row of byHourRows) {
        byHour[row.hour] = {
          requests: row.requests,
          successful: row.successful,
          failed: row.failed,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          totalTokens: row.totalTokens,
          cachedTokens: 0,
        };
      }

      const stats = {
        totalRequests: overview.totalRequests,
        successfulRequests: overview.successfulRequests,
        failedRequests: overview.failedRequests,
        byModel,
        byProvider,
        totalInputTokens: overview.totalInputTokens,
        totalOutputTokens: overview.totalOutputTokens,
        totalTokens: overview.totalTokens,
        totalCachedTokens: overview.totalCachedTokens,
        byHour,
      };

      return c.json({
        success: true,
        data: stats,
        dateRange: `${startDate} ~ ${endDate}`
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
