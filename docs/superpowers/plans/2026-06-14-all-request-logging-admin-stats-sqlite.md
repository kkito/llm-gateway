# 全量请求记录 + Admin Stats SQLite 改造 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 所有请求记录到 SQLite（不限登录用户），Admin Stats 改用 SQLite 数据源，支持用户/模型筛选和请求列表

**架构:** 移除 `requestLogger.log()` 的 `currentUser` 守卫实现全量记录；Admin Stats 路由从读 JSONL 文件改为直接 SQLite 查询；Admin Stats 视图增加用户下拉筛选 + 模型按钮筛选 + 分页请求列表

**Tech Stack:** TypeScript, Hono JSX, better-sqlite3, SQLite

---

### Task 1: 移除 requestLogger.log() 的 currentUser 守卫

**Files:**
- Modify: `src/routes/chat-completions/handler.ts`
- Modify: `src/routes/chat-completions/stream-handler.ts`
- Modify: `src/routes/messages/handler.ts`
- Modify: `src/routes/messages/stream-handler.ts`

所有 `if (requestLogger && currentUser)` 改为 `if (requestLogger)`，`userName` 从 `currentUser.name` 改为 `currentUser?.name ?? null`。

- [ ] **Step 1: 修改 chat-completions/handler.ts**

  该文件有 6 处 `requestLogger.log()` 调用。逐个修改：

  ```ts
  // 每处变更模式相同：
  // 变更前：
  if (requestLogger && currentUser) {
    requestLogger.log({
      // ...
      userName: currentUser.name,
      // ...
    });
  }

  // 变更后：
  if (requestLogger) {
    requestLogger.log({
      // ...
      userName: currentUser?.name ?? null,
      // ...
    });
  }
  ```

  具体位置（行号为近似值，以实际文件为准）：
  1. 约 L150 — model not found 404 错误
  2. 约 L232 — auth check 401 错误
  3. 约 L265 — non-stream 成功响应
  4. 约 L295 — stream fallback（非 OK 或空 body 前的 log）
  5. 约 L357 — catch 块 500 错误
  6. 在这些调用中，所有 `userName: currentUser.name` 改为 `userName: currentUser?.name ?? null`

- [ ] **Step 2: 修改 chat-completions/stream-handler.ts**

  该文件有 1 处 `requestLogger.log()` 调用（约 L110）：

  ```ts
  // 变更前：
  if (requestLogger && currentUser) {
    requestLogger.log({
      // ...
      userName: currentUser.name,
      // ...
    });
  }

  // 变更后：
  if (requestLogger) {
    requestLogger.log({
      // ...
      userName: currentUser?.name ?? null,
      // ...
    });
  }
  ```

- [ ] **Step 3: 修改 messages/handler.ts**

  该文件有 6 处 `requestLogger.log()` 调用，模式与 chat-completions/handler.ts 完全相同。逐个修改：

  1. 约 L144 — model not found 404 错误
  2. 约 L222 — auth check 401 错误
  3. 约 L243 — non-stream 成功响应
  4. 约 L275 — stream fallback
  5. 约 L337 — catch 块 500 错误
  6. 所有 `userName: currentUser.name` → `userName: currentUser?.name ?? null`

- [ ] **Step 4: 修改 messages/stream-handler.ts**

  该文件有 1 处 `requestLogger.log()` 调用（约 L94）：

  ```ts
  // 变更前：
  if (requestLogger && currentUser) {
    requestLogger.log({
      // ...
      userName: currentUser.name,
      // ...
    });
  }

  // 变更后：
  if (requestLogger) {
    requestLogger.log({
      // ...
      userName: currentUser?.name ?? null,
      // ...
    });
  }
  ```

- [ ] **Step 5: 构建验证**

  Run: `pnpm build`
  Expected: 编译成功，无类型错误

- [ ] **Step 6: 运行现有测试**

  Run: `pnpm test`
  Expected: 所有测试通过

- [ ] **Step 7: Commit**

  ```bash
  git add src/routes/chat-completions/handler.ts src/routes/chat-completions/stream-handler.ts src/routes/messages/handler.ts src/routes/messages/stream-handler.ts
  git commit -m "feat: 移除 requestLogger 的 currentUser 守卫，所有请求均记录到 SQLite"
  ```

---

### Task 2: 重写 Admin Stats 路由为 SQLite 数据源

**Files:**
- Modify: `src/admin/routes/stats.tsx`
- Modify: `src/admin/routes/stats-api.ts`

- [ ] **Step 1: 重写 stats.tsx 页面路由**

  将 `loadStats(logDir, options)` 替换为 SQLite 查询。新路由接收 `startDate`/`endDate`/`tzOffset` 参数（与 User Stats 一致），支持可选的 `userName` 和 `model` 筛选。

  ```tsx
  import { Hono } from 'hono';
  import { StatsPage } from '../views/stats.js';
  import { DatabaseManager } from '../../lib/db.js';
  import { localDateToUtcRange } from '../../lib/time-utils.js';

  export function createStatsRoute() {
    const app = new Hono();

    app.get('/admin/stats', (c) => {
      const dbManager = DatabaseManager.getExistingInstance();
      if (!dbManager) {
        return c.html('<h1>数据库未初始化</h1>');
      }
      const db = dbManager.getDb();

      // 解析日期参数
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

      // 构建可选过滤条件
      const userCondition = selectedUser ? 'AND user_name = ?' : '';
      const modelCondition = selectedModel ? 'AND custom_model = ?' : '';
      const baseParams: any[] = [utcStart, utcEnd];
      if (selectedUser) baseParams.push(selectedUser === '__null__' ? null : selectedUser);
      if (selectedModel) baseParams.push(selectedModel);

      // 1. 概览聚合
      const overview = db.prepare(`
        SELECT
          COUNT(*) AS totalRequests,
          SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successfulRequests,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failedRequests,
          COALESCE(AVG(duration_ms), 0) AS avgDuration,
          COALESCE(SUM(prompt_tokens), 0) AS totalInputTokens,
          COALESCE(SUM(completion_tokens), 0) AS totalOutputTokens,
          COALESCE(SUM(total_tokens), 0) AS totalTokens,
          COALESCE(SUM(cached_tokens), 0) AS totalCachedTokens
        FROM requests
        WHERE timestamp >= ? AND timestamp <= ?
        ${userCondition}
        ${modelCondition}
      `).get(...baseParams);

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
          COALESCE(SUM(cached_tokens), 0) AS cachedTokens,
          COALESCE(AVG(duration_ms), 0) AS avgDuration
        FROM requests
        WHERE timestamp >= ? AND timestamp <= ?
        ${userCondition}
        ${modelCondition}
        GROUP BY custom_model
        ORDER BY requests DESC
      `).all(...baseParams);

      // 3. 按 Provider 分组
      const byProvider = db.prepare(`
        SELECT
          provider,
          COUNT(*) AS requests,
          SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successful,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed,
          COALESCE(SUM(prompt_tokens), 0) AS inputTokens,
          COALESCE(SUM(completion_tokens), 0) AS outputTokens,
          COALESCE(SUM(total_tokens), 0) AS totalTokens,
          COALESCE(SUM(cached_tokens), 0) AS cachedTokens
        FROM requests
        WHERE timestamp >= ? AND timestamp <= ?
        AND provider IS NOT NULL
        ${userCondition}
        ${modelCondition}
        GROUP BY provider
        ORDER BY requests DESC
      `).all(...baseParams);

      // 4. 按小时分布
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
        WHERE timestamp >= ? AND timestamp <= ?
        ${userCondition}
        ${modelCondition}
        GROUP BY hour
        ORDER BY hour ASC
      `).all(...baseParams);

      // 5. 分页请求列表
      const recentRequests = db.prepare(`
        SELECT
          id, request_id AS requestId, timestamp,
          user_name AS userName, custom_model AS customModel,
          model_group AS modelGroup, real_model AS realModel,
          provider, status_code AS statusCode, duration_ms AS durationMs,
          prompt_tokens AS promptTokens, completion_tokens AS completionTokens,
          total_tokens AS totalTokens, cached_tokens AS cachedTokens,
          is_streaming AS isStreaming, error_message AS errorMessage
        FROM requests
        WHERE timestamp >= ? AND timestamp <= ?
        ${userCondition}
        ${modelCondition}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `).all(...baseParams, limit, offset);

      // 6. 总条数
      const totalRow = db.prepare(`
        SELECT COUNT(*) AS total
        FROM requests
        WHERE timestamp >= ? AND timestamp <= ?
        ${userCondition}
        ${modelCondition}
      `).get(...baseParams);
      const totalPages = Math.max(1, Math.ceil(totalRow.total / limit));

      // 7. 用户列表（用于筛选下拉框）
      const userListRows = db.prepare(`
        SELECT DISTINCT user_name
        FROM requests
        WHERE user_name IS NOT NULL
        ORDER BY user_name
      `).all() as Array<{ user_name: string }>;
      const userList = userListRows.map(r => r.user_name);

      // 8. 模型列表（用于筛选按钮）
      const modelListRows = db.prepare(`
        SELECT DISTINCT custom_model
        FROM requests
        ORDER BY custom_model
      `).all() as Array<{ custom_model: string }>;
      const modelList = modelListRows.map(r => r.custom_model);

      return c.html(
        <StatsPage
          stats={overview}
          byModel={byModel}
          byProvider={byProvider}
          byHour={byHour}
          recentRequests={recentRequests}
          startDate={startDate}
          endDate={endDate}
          tzOffset={tzOffset}
          selectedUser={selectedUser}
          selectedModel={selectedModel}
          page={page}
          totalPages={totalPages}
          userList={userList}
          modelList={modelList}
        />
      );
    });

    return app;
  }
  ```

- [ ] **Step 2: 重写 stats-api.ts API 路由**

  移除 `StatsProvider` 依赖，改为 SQLite 查询：

  ```ts
  import { Hono } from 'hono';
  import { DatabaseManager } from '../../lib/db.js';
  import { localDateToUtcRange } from '../../lib/time-utils.js';

  export function createStatsApiRoute() {
    const app = new Hono();

    app.get('/admin/api/stats', (c) => {
      const dbManager = DatabaseManager.getExistingInstance();
      if (!dbManager) {
        return c.json({ success: false, error: 'Database not initialized' }, 500);
      }
      const db = dbManager.getDb();

      const startDate = c.req.query('startDate');
      const endDate = c.req.query('endDate');
      const selectedUser = c.req.query('userName');
      const selectedModel = c.req.query('model');
      const tzOffset = c.req.query('tzOffset') !== undefined
        ? parseInt(c.req.query('tzOffset')!, 10)
        : new Date().getTimezoneOffset();

      const now = new Date();
      const localToday = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');

      const start = startDate || localToday;
      const end = endDate || start;
      const [utcStart] = localDateToUtcRange(start, tzOffset);
      const [, utcEnd] = localDateToUtcRange(end, tzOffset);

      const userCondition = selectedUser ? 'AND user_name = ?' : '';
      const modelCondition = selectedModel ? 'AND custom_model = ?' : '';
      const params: any[] = [utcStart, utcEnd];
      if (selectedUser) params.push(selectedUser === '__null__' ? null : selectedUser);
      if (selectedModel) params.push(selectedModel);

      const overview = db.prepare(`
        SELECT
          COUNT(*) AS totalRequests,
          SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successfulRequests,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failedRequests,
          COALESCE(AVG(duration_ms), 0) AS avgDuration,
          COALESCE(SUM(prompt_tokens), 0) AS totalInputTokens,
          COALESCE(SUM(completion_tokens), 0) AS totalOutputTokens,
          COALESCE(SUM(total_tokens), 0) AS totalTokens,
          COALESCE(SUM(cached_tokens), 0) AS totalCachedTokens
        FROM requests WHERE timestamp >= ? AND timestamp <= ? ${userCondition} ${modelCondition}
      `).get(...params);

      const byModel = db.prepare(`
        SELECT custom_model AS model, COUNT(*) AS requests,
          SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successful,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed,
          COALESCE(SUM(prompt_tokens), 0) AS inputTokens,
          COALESCE(SUM(completion_tokens), 0) AS outputTokens,
          COALESCE(SUM(total_tokens), 0) AS totalTokens,
          COALESCE(SUM(cached_tokens), 0) AS cachedTokens
        FROM requests WHERE timestamp >= ? AND timestamp <= ? ${userCondition} ${modelCondition}
        GROUP BY custom_model ORDER BY requests DESC
      `).all(...params);

      return c.json({
        success: true,
        data: { ...overview, byModel },
        dateRange: `${start} ~ ${end}`
      });
    });

    return app;
  }

  // StatsProvider 相关函数保留导出签名但不再使用
  export function resetStatsProvider(): void {}
  export function initStatsProvider(_provider: any): void {}
  export function getStatsProvider(): null { return null; }
  ```

- [ ] **Step 3: 修改 server.ts 移除 StatsProvider 初始化**

  ```ts
  // 变更前：
  import { StatsProvider } from './lib/stats-provider.js';
  // ...
  const statsProvider = new StatsProvider(usageTracker, logDir);
  initStatsProvider(statsProvider);

  // 变更后：
  // 删除 StatsProvider import 和 initStatsProvider 调用
  // 保留 initStatsProvider 的空函数导入（因为 resetStatsProvider 仍在 cleanup 中使用）
  ```

  具体修改 `src/server.ts`：
  - 删除 `import { StatsProvider } from './lib/stats-provider.js';`
  - 删除 `const statsProvider = new StatsProvider(usageTracker, logDir);`
  - 删除 `initStatsProvider(statsProvider);`
  - cleanup interval 中的 `statsProvider.cleanup()` 改为只保留 `dbManager.cleanupOldRequests(90)`

- [ ] **Step 4: 构建验证**

  Run: `pnpm build`
  Expected: 编译成功

- [ ] **Step 5: Commit**

  ```bash
  git add src/admin/routes/stats.tsx src/admin/routes/stats-api.ts src/server.ts
  git commit -m "feat: Admin Stats 改用 SQLite 数据源，支持用户/模型筛选"
  ```

---

### Task 3: 重写 Admin Stats 视图

**Files:**
- Modify: `src/admin/views/stats.tsx`

- [ ] **Step 1: 重写视图组件**

  新增 Props：`selectedUser`、`selectedModel`、`userList`、`modelList`、`recentRequests`、`page`、`totalPages`、`tzOffset`、`byProvider`

  视图需要包含：
  1. 日期范围选择器（startDate/endDate + 快捷按钮"今天"）
  2. 用户筛选下拉框（从 userList 渲染）
  3. 模型筛选按钮栏（从 modelList 渲染）
  4. 概览卡片（4 个：总请求、成功、失败、成功率）
  5. Token 用量卡片（输入、缓存、输出）
  6. 按模型统计卡片
  7. 按 Provider 统计卡片
  8. 按小时分布柱状图
  9. 最近请求分页表格

  新的 Props 接口：

  ```ts
  interface RequestRow {
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
  }

  interface StatsOverview {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    avgDuration: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCachedTokens: number;
  }

  interface ModelStatRow {
    model: string;
    requests: number;
    successful: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedTokens: number;
    avgDuration: number;
  }

  interface ProviderStatRow {
    provider: string;
    requests: number;
    successful: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedTokens: number;
  }

  interface HourStatRow {
    hour: string;
    requests: number;
    successful: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }

  interface Props {
    stats: StatsOverview;
    byModel: ModelStatRow[];
    byProvider: ProviderStatRow[];
    byHour: HourStatRow[];
    recentRequests: RequestRow[];
    startDate: string;
    endDate: string;
    tzOffset: number;
    selectedUser: string;
    selectedModel: string;
    page: number;
    totalPages: number;
    userList: string[];
    modelList: string[];
  }
  ```

  保留现有的 CSS 样式（卡片、柱状图等），新增：
  - 用户筛选下拉框样式
  - 请求列表表格样式
  - 分页控件样式

  用户筛选下拉框 HTML：

  ```tsx
  <div class="filter-bar">
    <label>用户:</label>
    <select id="user-filter" onchange="window.location.href=buildUrl('userName', this.value)">
      <option value="">全部</option>
      {userList.map(u => (
        <option value={u} selected={selectedUser === u}>{u}</option>
      ))}
    </select>
    <label>模型:</label>
    <div class="model-filter-bar">
      <a href={buildUrl('model', '')} class={`model-filter-btn${selectedModel ? '' : ' active'}`}>全部</a>
      {modelList.map(m => (
        <a href={buildUrl('model', m)} class={`model-filter-btn${selectedModel === m ? ' active' : ''}`}>{m}</a>
      ))}
    </div>
  </div>
  ```

  请求列表表格 HTML：

  ```tsx
  <div class="stats-section-card">
    <h2 class="stats-section-title">📋 最近请求</h2>
    <div class="stats-table-wrapper">
      <table class="stats-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>用户</th>
            <th>模型</th>
            <th>模型组</th>
            <th>状态</th>
            <th>耗时</th>
            <th>输入 Token</th>
            <th>输出 Token</th>
            <th>错误</th>
          </tr>
        </thead>
        <tbody>
          {recentRequests.map(r => (
            <tr>
              <td>{formatTime(r.timestamp)}</td>
              <td>{r.userName || '(匿名)'}</td>
              <td>{r.customModel}</td>
              <td>{r.modelGroup || '-'}</td>
              <td class={r.statusCode >= 200 && r.statusCode < 300 ? 'status-success' : 'status-error'}>{r.statusCode}</td>
              <td>{formatDuration(r.durationMs)}</td>
              <td>{formatNumber(r.promptTokens)}</td>
              <td>{formatNumber(r.completionTokens)}</td>
              <td class="error-cell">{r.errorMessage || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {/* 分页控件 */}
    <div class="pagination">
      {page > 1 && <a href={buildPageUrl(page - 1)}>← 上一页</a>}
      <span>第 {page}/{totalPages} 页</span>
      {page < totalPages && <a href={buildPageUrl(page + 1)}>下一页 →</a>}
    </div>
  </div>
  ```

  客户端脚本（UTC 转本地时间）保持与 User Stats 一致。

- [ ] **Step 2: 构建验证**

  Run: `pnpm build`
  Expected: 编译成功

- [ ] **Step 3: 运行测试**

  Run: `pnpm test`
  Expected: 所有测试通过

- [ ] **Step 4: Commit**

  ```bash
  git add src/admin/views/stats.tsx
  git commit -m "feat: Admin Stats 视图重写——用户/模型筛选 + 请求列表表格"
  ```

---

### Task 4: 清理弃用代码

**Files:**
- Delete: `src/lib/stats-core.ts`（确认 CLI stats 不再使用后）
- Delete: `src/lib/stats-provider.ts`
- Modify: `src/cli/stats.ts`（改为 SQLite 查询或标记弃用）

- [ ] **Step 1: 检查 CLI stats 是否仍依赖 stats-core.ts**

  `src/cli/stats.ts` 目前使用 `loadStats`、`formatDateRange`、`getLogFilesForRange`、`parseLogFile` 等从 `stats-core.ts` 导入。

  **方案 A（推荐）**：CLI stats 也改为 SQLite 查询，然后删除 `stats-core.ts`
  **方案 B**：保留 `stats-core.ts` 仅供 CLI 使用，仅删除 `StatsProvider`

  采用方案 A：重写 `src/cli/stats.ts` 使用 SQLite 查询。

- [ ] **Step 2: 重写 CLI stats 使用 SQLite**

  ```ts
  #!/usr/bin/env node

  import { Command } from 'commander';
  import { createConfigContext } from '../lib/config-context.js';
  import { DatabaseManager } from '../lib/db.js';
  import { localDateToUtcRange } from '../lib/time-utils.js';

  // ... formatModelStats, formatStats 函数保持不变 ...

  function main() {
    const program = new Command();
    program
      .name('llm-gateway-stats')
      .description('查看代理服务器统计')
      .option('-C, --config-dir <path>', '工作目录 (默认 ~/.llm-gateway/)')
      .option('--date <date>', '指定日期 (YYYY-MM-DD)')
      .option('--start <start>', '开始日期 (YYYY-MM-DD)')
      .option('--end <end>', '结束日期 (YYYY-MM-DD)')
      .option('--by-hour', '按小时分布统计')
      .option('--json', '输出 JSON 格式')
      .action((options) => {
        try {
          const ctx = createConfigContext(options.configDir);
          const dbManager = DatabaseManager.getInstance(ctx.configDir);
          dbManager.initialize();
          const db = dbManager.getDb();

          // 解析日期范围
          const now = new Date();
          const localToday = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0');

          let startDate = options.start || options.date || localToday;
          let endDate = options.end || startDate;
          const tzOffset = new Date().getTimezoneOffset();
          const [utcStart] = localDateToUtcRange(startDate, tzOffset);
          const [, utcEnd] = localDateToUtcRange(endDate, tzOffset);

          // SQLite 查询概览
          const overview = db.prepare(`
            SELECT COUNT(*) AS totalRequests,
              SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successfulRequests,
              SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failedRequests,
              COALESCE(SUM(prompt_tokens), 0) AS totalInputTokens,
              COALESCE(SUM(completion_tokens), 0) AS totalOutputTokens,
              COALESCE(SUM(total_tokens), 0) AS totalTokens,
              COALESCE(SUM(cached_tokens), 0) AS totalCachedTokens
            FROM requests WHERE timestamp >= ? AND timestamp <= ?
          `).get(utcStart, utcEnd);

          // 按模型
          const byModel = db.prepare(`
            SELECT custom_model AS model, COUNT(*) AS requests,
              SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successful,
              SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed,
              COALESCE(SUM(prompt_tokens), 0) AS inputTokens,
              COALESCE(SUM(completion_tokens), 0) AS outputTokens,
              COALESCE(SUM(total_tokens), 0) AS totalTokens,
              COALESCE(SUM(cached_tokens), 0) AS cachedTokens
            FROM requests WHERE timestamp >= ? AND timestamp <= ?
            GROUP BY custom_model ORDER BY requests DESC
          `).all(utcStart, utcEnd);

          // 按 provider
          const byProvider = db.prepare(`
            SELECT provider, COUNT(*) AS requests,
              SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successful,
              SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed,
              COALESCE(SUM(prompt_tokens), 0) AS inputTokens,
              COALESCE(SUM(completion_tokens), 0) AS outputTokens,
              COALESCE(SUM(total_tokens), 0) AS totalTokens,
              COALESCE(SUM(cached_tokens), 0) AS cachedTokens
            FROM requests WHERE timestamp >= ? AND timestamp <= ? AND provider IS NOT NULL
            GROUP BY provider ORDER BY requests DESC
          `).all(utcStart, utcEnd);

          // 构建 Stats 对象
          const stats = {
            ...overview,
            byModel: Object.fromEntries(byModel.map((r: any) => [r.model, r])),
            byProvider: Object.fromEntries(byProvider.map((r: any) => [r.provider, r])),
          };

          if (options.json) {
            console.log(JSON.stringify(stats, null, 2));
          } else {
            console.log(formatStats(stats, { startDate, endDate }));
          }

          dbManager.close();
        } catch (error: any) {
          console.error('❌ 统计失败:', error.message);
          process.exit(1);
        }
      });

    program.parse();
  }

  main();
  ```

- [ ] **Step 3: 删除 stats-core.ts**

  Run: `rm src/lib/stats-core.ts`

- [ ] **Step 4: 删除 stats-provider.ts**

  Run: `rm src/lib/stats-provider.ts`

- [ ] **Step 5: 清理 server.ts 中残留引用**

  确认 `server.ts` 中不再有 `statsProvider`、`StatsProvider`、`initStatsProvider` 的引用（Step 2 已处理）。

- [ ] **Step 6: 构建验证**

  Run: `pnpm build`
  Expected: 编译成功，无未解析的导入

- [ ] **Step 7: 运行全量测试**

  Run: `pnpm test`
  Expected: 所有测试通过

- [ ] **Step 8: Commit**

  ```bash
  git add -A
  git commit -m "chore: 删除 stats-core.ts 和 stats-provider.ts，CLI stats 改用 SQLite"
  ```

---

### Task 5: 最终验证

- [ ] **Step 1: 完整构建**

  Run: `pnpm build`
  Expected: 编译成功

- [ ] **Step 2: 全量测试**

  Run: `pnpm test`
  Expected: 所有测试通过

- [ ] **Step 3: 手动验证清单**

  - [ ] 无认证模式：发送请求后 SQLite 中 `user_name` 为 null
  - [ ] 有认证模式：登录用户请求 `user_name` 正确记录
  - [ ] `/admin/stats` 页面：日期范围筛选正常
  - [ ] `/admin/stats` 页面：用户下拉筛选正常
  - [ ] `/admin/stats` 页面：模型按钮筛选正常
  - [ ] `/admin/stats` 页面：请求列表分页正常
  - [ ] `/admin/api/stats` API：返回正确 JSON
  - [ ] `/user/stats` 页面：不受影响，功能正常
  - [ ] CLI `llm-gateway-stats`：正常输出统计
