import { Hono } from 'hono';
import { StatsPage } from '../views/stats.js';
import { DatabaseManager } from '../../lib/db.js';
import { localDateToUtcRange } from '../../lib/time-utils.js';

export function createStatsRoute() {
  const app = new Hono();

  app.get('/admin/stats', async (c) => {
    try {
      const dbManager = DatabaseManager.getExistingInstance();
      if (!dbManager) {
        return c.html('<h1>数据库未初始化</h1>');
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
      const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
      const limit = 20;
      const offset = (page - 1) * limit;

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

      // 1. 概览聚合
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

      // 2. 按模型分组
      const byModelRows = db.prepare(`
        SELECT
          custom_model AS model,
          COUNT(*) AS requests,
          SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successful,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed,
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

      // 3. 按 Provider 分组
      const byProviderRows = db.prepare(`
        SELECT
          COALESCE(provider, 'unknown') AS provider,
          COUNT(*) AS requests,
          SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successful,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed,
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

      // 4. 按小时分布
      const byHourRows = db.prepare(`
        SELECT
          strftime('%Y-%m-%d %H:00', timestamp) AS hour,
          COUNT(*) AS requests,
          SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successful,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed,
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

      // 5. 分页请求列表
      const recentRequests = db.prepare(`
        SELECT
          id,
          request_id AS requestId,
          timestamp,
          user_name AS userName,
          custom_model AS customModel,
          model_group AS modelGroup,
          real_model AS realModel,
          provider,
          status_code AS statusCode,
          duration_ms AS durationMs,
          prompt_tokens AS promptTokens,
          completion_tokens AS completionTokens,
          total_tokens AS totalTokens,
          cached_tokens AS cachedTokens,
          is_streaming AS isStreaming,
          error_message AS errorMessage
        FROM requests
        WHERE ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as Array<{
        id: number;
        requestId: string;
        timestamp: string;
        userName: string | null;
        customModel: string;
        modelGroup: string | null;
        realModel: string | null;
        provider: string | null;
        statusCode: number;
        durationMs: number | null;
        promptTokens: number | null;
        completionTokens: number | null;
        totalTokens: number | null;
        cachedTokens: number | null;
        isStreaming: number | null;
        errorMessage: string | null;
      }>;

      // 6. 总条数
      const totalRow = db.prepare(`
        SELECT COUNT(*) AS total
        FROM requests
        WHERE ${whereClause}
      `).get(...params) as { total: number };
      const totalPages = Math.max(1, Math.ceil(totalRow.total / limit));

      // 7. 用户列表（用于筛选下拉框）
      const userRows = db.prepare(`
        SELECT DISTINCT user_name AS userName
        FROM requests
        WHERE user_name IS NOT NULL AND user_name != ''
        ORDER BY user_name
      `).all() as Array<{ userName: string }>;
      const userNames = userRows.map(r => r.userName);

      // 8. 模型列表（用于筛选按钮）
      const modelRows = db.prepare(`
        SELECT DISTINCT custom_model AS model
        FROM requests
        WHERE custom_model IS NOT NULL AND custom_model != ''
        ORDER BY custom_model
      `).all() as Array<{ model: string }>;
      const modelNames = modelRows.map(r => r.model);

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

      return c.html(
        <StatsPage
          stats={stats}
          dateRange={`${startDate} ~ ${endDate}`}
          currentType="date"
          currentValue={startDate}
          recentRequests={recentRequests}
          page={page}
          totalPages={totalPages}
          totalItems={totalRow.total}
          userNames={userNames}
          modelNames={modelNames}
          selectedUser={selectedUser}
          selectedModel={selectedModel}
          startDate={startDate}
          endDate={endDate}
          tzOffset={tzOffset}
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
