import { Hono } from 'hono';
import { StatsView } from '../views/stats.js';
import { getCurrentUser } from '../middleware/auth.js';
import { loadFullConfig } from '../../config.js';
import { DatabaseManager } from '../../lib/db.js';
import { localDateToUtcRangeTz, getLocalToday } from '../../lib/time-utils.js';

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

    // 解析日期参数 — 使用客户端的 IANA 时区将本地日期转为 UTC 范围
    // DB 中 timestamp 存的是 UTC ISO 字符串 (如 2026-06-14T10:00:00.000Z)
    const timezone = c.req.query('timezone') || 'UTC';
    const localToday = getLocalToday(timezone);

    const startDate = c.req.query('startDate') || localToday;
    const endDate = c.req.query('endDate') || startDate;
    const selectedModel = c.req.query('model') || '';

    const [utcStart] = localDateToUtcRangeTz(startDate, timezone);
    const [, utcEnd] = localDateToUtcRangeTz(endDate, timezone);
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    // 构建可选的 model 过滤条件
    const modelCondition = selectedModel ? 'AND custom_model = ?' : '';
    const baseParams = selectedModel
      ? [userName, utcStart, utcEnd, selectedModel]
      : [userName, utcStart, utcEnd];

    // 1. 概览聚合
    const overview = db.prepare(`
      SELECT
        COUNT(*) AS totalRequests,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(prompt_tokens), 0) AS totalInputTokens,
        COALESCE(SUM(completion_tokens), 0) AS totalOutputTokens,
        COALESCE(SUM(cached_tokens), 0) AS totalCachedTokens,
        COALESCE(AVG(duration_ms), 0) AS avgDuration
      FROM requests
      WHERE user_name = ?
        AND timestamp >= ? AND timestamp <= ?
        ${modelCondition}
    `).get(...baseParams) as {
      totalRequests: number;
      totalTokens: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalCachedTokens: number;
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
        ${modelCondition}
      GROUP BY custom_model
      ORDER BY requests DESC
    `).all(...baseParams) as Array<{
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
        ${modelCondition}
      GROUP BY hour
      ORDER BY hour ASC
    `).all(...baseParams) as Array<{
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
      WHERE user_name = ?
        AND timestamp >= ? AND timestamp <= ?
        ${modelCondition}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(...baseParams, limit, offset) as Array<{
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

    // 5. 总条数（分页）
    const totalRow = db.prepare(`
      SELECT COUNT(*) AS total
      FROM requests
      WHERE user_name = ?
        AND timestamp >= ? AND timestamp <= ?
        ${modelCondition}
    `).get(...baseParams) as { total: number };

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
      tzOffset={0} // 不再使用，保留兼容；视图已改用 timezone
      timezone={timezone}
      selectedModel={selectedModel}
    />);
  });

  return app;
}
