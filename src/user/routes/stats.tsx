import { Hono } from 'hono';
import { StatsView } from '../views/stats.js';
import { getCurrentUser } from '../middleware/auth.js';
import { loadFullConfig } from '../../config.js';
import { DatabaseManager } from '../../lib/db.js';
import { localDateToUtcRange } from '../../lib/time-utils.js';

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

    // 解析日期参数 — 使用客户端时区将本地日期转为 UTC 范围
    // DB 中 timestamp 存的是 UTC ISO 字符串 (如 2026-06-14T10:00:00.000Z)
    const now = new Date();
    const localToday = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');

    const startDate = c.req.query('startDate') || localToday;
    const endDate = c.req.query('endDate') || startDate;
    // 如果客户端没传 tzOffset，用服务端时区
    const tzOffset = c.req.query('tzOffset') !== undefined
      ? parseInt(c.req.query('tzOffset')!, 10)
      : new Date().getTimezoneOffset();

    const [utcStart] = localDateToUtcRange(startDate, tzOffset);
    const [, utcEnd] = localDateToUtcRange(endDate, tzOffset);
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
    `).get(userName, utcStart, utcEnd) as {
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
    `).all(userName, utcStart, utcEnd) as Array<{
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
    `).all(userName, utcStart, utcEnd) as Array<{
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
    `).all(userName, utcStart, utcEnd, limit, offset) as Array<{
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
    `).get(userName, utcStart, utcEnd) as { total: number };

    const totalPages = Math.max(1, Math.ceil(totalRow.total / limit));

    // Props 传给视图：用原始本地日期（用户友好），以及 tzOffset
    const displayStart = startDate;
    const displayEnd = endDate;

    return c.html(<StatsView
      overview={overview}
      byModel={byModel}
      byHour={byHour}
      recentRequests={recentRequests}
      userName={userName}
      startDate={displayStart}
      endDate={displayEnd}
      page={page}
      totalPages={totalPages}
      tzOffset={tzOffset}
    />);
  });

  return app;
}
