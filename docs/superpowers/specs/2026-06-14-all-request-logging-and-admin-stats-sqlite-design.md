# 全量请求记录 + Admin Stats SQLite 改造

**日期：** 2026-06-14
**状态：** 待实现
**依赖：** `2026-06-14-user-stats-sqlite-design.md`（User Stats SQLite 改造已完成）

## 目标

三个功能：

1. **全量请求记录**：所有请求（无论是否登录）都记录到 SQLite `requests` 表
2. **Admin Stats SQLite 化**：`/admin/stats` 和 `/admin/api/stats` 从 JSONL 文本日志切换到 SQLite 查询
3. **Admin Stats 筛选增强**：支持按用户和按模型筛选统计数据

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 未登录请求的 user_name | `null` | schema 已允许 nullable，匿名请求无用户标识 |
| 记录方式 | 移除 `if (requestLogger && currentUser)` 守卫 | 最小改动，不引入新抽象 |
| Admin Stats 数据源 | SQLite（原生 SQL） | 与 User Stats 一致，查询快 |
| Admin Stats 日期范围 | `startDate`/`endDate` + `tzOffset` | 与 User Stats 统一 |
| Admin Stats 筛选维度 | 用户 + 模型（双维度） | 覆盖管理场景 |
| 请求列表 | 添加分页表格 | 与 User Stats 对齐，方便排查问题 |
| StatsProvider | 弃用（Admin Stats 不再使用） | SQLite 查询足够快，无需内存缓存层 |

## 一、全量请求记录

### 变更范围

所有调用 `requestLogger.log()` 的位置，将守卫从 `if (requestLogger && currentUser)` 改为 `if (requestLogger)`。

### 调用点清单

| 文件 | 改动 |
|------|------|
| `src/routes/chat-completions/handler.ts` | 6 处：移除 `&& currentUser`，`userName` 改为 `currentUser?.name ?? null` |
| `src/routes/chat-completions/stream-handler.ts` | 1 处：同上 |
| `src/routes/messages/handler.ts` | 6 处：同上 |
| `src/routes/messages/stream-handler.ts` | 1 处：同上 |

### 示例变更

```ts
// 变更前
if (requestLogger && currentUser) {
  requestLogger.log({
    requestId,
    userName: currentUser.name,
    // ...
  });
}

// 变更后
if (requestLogger) {
  requestLogger.log({
    requestId,
    userName: currentUser?.name ?? null,
    // ...
  });
}
```

### 影响

- SQLite schema 不变（`user_name` 已是 nullable）
- 无认证模式下的请求也会被记录，`user_name` 为 `null`
- User Stats 页面不受影响（已通过 `WHERE user_name = ?` 过滤）

## 二、Admin Stats SQLite 化

### 路由变更

**`src/admin/routes/stats.tsx`** — 页面路由

- 移除对 `stats-core.ts` 的 `loadStats()` 调用
- 改为直接用 `better-sqlite3` 执行 SQL 查询
- 接收 `startDate`/`endDate`/`tzOffset` 参数（与 User Stats 一致）
- 可选接收 `userName`/`model` 筛选参数
- 传入新 Props 给 `StatsPage` 视图

**`src/admin/routes/stats-api.ts`** — API 路由

- 移除对 `StatsProvider` 的依赖
- 改为直接执行 SQL 查询
- 返回格式保持不变（`{ success, data, dateRange }`）

### SQL 查询（5 个）

#### 查询 1：概览聚合

```sql
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
  [AND user_name = ?]
  [AND custom_model = ?]
```

#### 查询 2：按模型分组

```sql
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
  [AND user_name = ?]
  [AND custom_model = ?]
GROUP BY custom_model
ORDER BY requests DESC
```

#### 查询 3：按 Provider 分组（Admin 独有）

```sql
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
  [AND user_name = ?]
  [AND custom_model = ?]
GROUP BY provider
ORDER BY requests DESC
```

#### 查询 4：按小时分布

```sql
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
  [AND user_name = ?]
  [AND custom_model = ?]
GROUP BY hour
ORDER BY hour ASC
```

#### 查询 5：分页请求列表 + 总数

```sql
-- 列表
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
  [AND user_name = ?]
  [AND custom_model = ?]
ORDER BY timestamp DESC
LIMIT ? OFFSET ?

-- 总数
SELECT COUNT(*) AS total
FROM requests
WHERE timestamp >= ? AND timestamp <= ?
  [AND user_name = ?]
  [AND custom_model = ?]
```

### 视图变更

**`src/admin/views/stats.tsx`** — 重写

Props 新增：

```ts
interface Props {
  stats: Stats;
  startDate: string;
  endDate: string;
  tzOffset: number;
  // 筛选参数
  selectedUser: string;
  selectedModel: string;
  // 分页
  page: number;
  totalPages: number;
  recentRequests: RequestRow[];
  // 用户列表（用于筛选下拉框）
  userList: string[];
  // 模型列表（用于筛选按钮）
  modelList: string[];
}
```

页面布局：

```
┌──────────────────────────────────────────┐
│  📊 统计 Dashboard                        │
│  ┌─ [开始日期] ~ [结束日期] ─ [查询] ─┐   │
│  │  快捷: 今天                          │   │
│  └──────────────────────────────────────┘ │
│                                            │
│  🔍 筛选                                   │
│  用户: [全部 ▾]  模型: [全部] [claude] [gpt] │
│                                            │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐    │
│  │总请求 │ │成功   │ │失败   │ │成功率 │    │
│  └──────┘ └──────┘ └──────┘ └──────┘    │
│                                            │
│  📈 Token 用量                             │
│  输入: 234K  输出: 222K  缓存: 12K         │
│                                            │
│  🤖 按模型统计（含模型筛选按钮）            │
│  ☁️ 按 Provider 统计                       │
│  📊 按小时分布                              │
│                                            │
│  📋 最近请求列表（分页表格）                │
│  # | 时间 | 用户 | 模型 | 状态 | 耗时 | Token | 错误 │
│  ← 上一页  第 1/10 页  下一页 →            │
└──────────────────────────────────────────┘
```

### 用户筛选 UI

- 从 `SELECT DISTINCT user_name FROM requests WHERE user_name IS NOT NULL ORDER BY user_name` 获取用户列表
- 渲染为下拉框（`<select>`），选项包括 "全部" + 各用户名
- 未登录用户显示为 `(匿名)`
- 选中后跳转 `?startDate=...&endDate=...&userName=xxx`

### 模型筛选 UI

- 与 User Stats 相同的按钮栏方式
- 从 `SELECT DISTINCT custom_model FROM requests` 获取模型列表
- 选中后跳转 `?startDate=...&endDate=...&model=xxx`

## 三、可清理的代码

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/stats-core.ts` | **删除** | 不再被任何代码使用 |
| `src/lib/stats-provider.ts` | **删除** | 不再需要内存缓存层 |
| `src/admin/routes/stats-api.ts` 中的 `StatsProvider` 引用 | **移除** | 直接用 SQLite |
| `src/server.ts` 中 `StatsProvider` 初始化 | **移除** | 不再需要 |

> **注意**：`src/cli/stats.ts` 也使用 `stats-core.ts`，需要确认 CLI stats 命令是否也要改为 SQLite。如果要改，一并迁移；如果不改，保留 `stats-core.ts` 仅供 CLI 使用。

## 四、不变更的部分

- SQLite schema（`requests` 表结构不变）
- User Stats 页面（已独立完成）
- 日志文件写入（`Logger` 类继续写 JSONL，用于实时日志查看）
- 拦截器系统

## 测试计划

| 测试 | 说明 |
|------|------|
| 全量记录 — 有用户 | 登录用户请求写入 SQLite，user_name 非 null |
| 全量记录 — 无用户 | 未登录请求写入 SQLite，user_name 为 null |
| 全量记录 — 无认证模式 | 所有请求都记录，user_name 全部为 null |
| Admin Stats — 日期范围 | 不同 startDate/endDate 返回对应数据 |
| Admin Stats — 用户筛选 | userName 参数过滤正确 |
| Admin Stats — 模型筛选 | model 参数过滤正确 |
| Admin Stats — 双维度筛选 | 同时指定 userName + model |
| Admin Stats — 分页 | LIMIT/OFFSET + 总页数正确 |
| Admin Stats — 空数据 | 无数据时不报错，显示空状态 |
| Admin Stats API | JSON 返回格式正确 |
| StatsProvider 清理 | 确认无残留引用 |
| 构建 + 类型检查 | `pnpm build` 通过 |
| 全量测试 | `pnpm test` 通过 |
