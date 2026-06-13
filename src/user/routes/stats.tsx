import { Hono } from 'hono';
import { StatsView } from '../views/stats.js';
import { getCurrentUser } from '../middleware/auth.js';
import { loadFullConfig } from '../../config.js';
import { DatabaseManager } from '../../lib/db.js';

export { StatsView };

export function createStatsRoute(configPath?: string) {
  const app = new Hono();
  if (!configPath) return app;

  const config = loadFullConfig(configPath);
  const isAuthEnabled = !!(config.userApiKeys && config.userApiKeys.length > 0);

  app.get('/', (c) => {
    const currentUser = getCurrentUser(c, configPath);

    // 已启用认证但未登录 -> redirect
    if (isAuthEnabled && !currentUser) {
      return c.redirect('/user/login');
    }

    const userName = currentUser?.name || 'Guest';

    const dbManager = DatabaseManager.getExistingInstance();
    if (!dbManager) {
      return c.html('<h1>数据库未初始化</h1>');
    }
    const db = dbManager.getDb();

    // 解析日期参数
    const now = new Date();
    const todayStart = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 00:00:00`;
    const todayEnd = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 23:59:59`;

    const queryStartDate = (c.req.query('startDate') || todayStart) as string;
    const queryEndDate = (c.req.query('endDate') || todayEnd) as string;
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    // 1. 概览聚合
    const overview = db.prepare(`
      SELECT
        COUNT(*) AS totalRequests,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(prompt_tokens), 0) AS totalInputTokens,
        COALESCE(SUM(completion_tokens), 0) AS totalOutputTokens,
        COALESCE(AVG(duration_ms), 0) AS avgDuration
      FROM requests
      WHERE user_name = ?
        AND timestamp >= ? AND timestamp <= ?
    `).get(userName, queryStartDate, queryEndDate) as {
      totalRequests: number;
      totalTokens: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      avgDuration: number;
    };

    // 2. 按模型分组
    const byModel = db.prepare(`
      SELECT
        custom_model AS model,
        COUNT(*) AS requests,
        SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successful,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed,
        COALESCE(SUM(prompt_tokens), 0) AS inputTokens,
        COALESCE(SUM(completion_tokens), 0) AS outputTokens,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(AVG(duration_ms), 0) AS avgDuration
      FROM requests
      WHERE user_name = ?
        AND timestamp >= ? AND timestamp <= ?
      GROUP BY custom_model
      ORDER BY requests DESC
    `).all(userName, queryStartDate, queryEndDate) as Array<{
      model: string;
      requests: number;
      successful: number;
      failed: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      avgDuration: number;
    }>;

    // 3. 按小时分布
    const byHour = db.prepare(`
      SELECT
        strftime('%Y-%m-%d %H:00', timestamp) AS hour,
        COUNT(*) AS requests,
        SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successful,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed,
        COALESCE(SUM(prompt_tokens), 0) AS inputTokens,
        COALESCE(SUM(completion_tokens), 0) AS outputTokens,
        COALESCE(SUM(total_tokens), 0) AS totalTokens
      FROM requests
      WHERE user_name = ?
        AND timestamp >= ? AND timestamp <= ?
      GROUP BY hour
      ORDER BY hour ASC
    `).all(userName, queryStartDate, queryEndDate) as Array<{
      hour: string;
      requests: number;
      successful: number;
      failed: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }>;

    // 4. 分页列表
    const recentRequests = db.prepare(`
      SELECT
        id,
        request_id AS requestId,
        timestamp,
        custom_model AS customModel,
        real_model AS realModel,
        provider,
        status_code AS statusCode,
        duration_ms AS durationMs,
        prompt_tokens AS promptTokens,
        completion_tokens AS completionTokens,
        total_tokens AS totalTokens,
        is_streaming AS isStreaming,
        error_message AS errorMessage
      FROM requests
      WHERE user_name = ?
        AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(userName, queryStartDate, queryEndDate, limit, offset) as Array<{
      id: number;
      requestId: string;
      timestamp: string;
      customModel: string;
      realModel: string | null;
      provider: string | null;
      statusCode: number;
      durationMs: number | null;
      promptTokens: number | null;
      completionTokens: number | null;
      totalTokens: number | null;
      isStreaming: number | null;
      errorMessage: string | null;
    }>;

    // 5. 总条数（分页）
    const totalRow = db.prepare(`
      SELECT COUNT(*) AS total
      FROM requests
      WHERE user_name = ?
        AND timestamp >= ? AND timestamp <= ?
    `).get(userName, queryStartDate, queryEndDate) as { total: number };

    const totalPages = Math.max(1, Math.ceil(totalRow.total / limit));

    return c.html(<StatsView
      overview={overview}
      byModel={byModel}
      byHour={byHour}
      recentRequests={recentRequests}
      userName={userName}
      startDate={queryStartDate}
      endDate={queryEndDate}
      page={page}
      totalPages={totalPages}
    />);
  });

  return app;
}
