# 用户统计页面 — SQLite 数据源

**日期：** 2026-06-14
**状态：** 待实现

## 目标

将 `/user/stats` 页面的数据源从 JSON 日志文件切换到 SQLite `requests` 表，新增日期范围筛选、小时分布统计、分页详细请求列表、数值自动格式化，并在无认证模式下隐藏该页面。

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 数据源 | SQLite `requests` 表 | 已双写，数据完整，查询比解析 JSON 更快更灵活 |
| 查询方式 | 原生 SQL（better-sqlite3） | 简单聚合查询，不需要 Drizzle ORM 的开销 |
| 分页 | 服务端分页，固定 20 条/页 | 简单可预测，避免大结果集 |
| 日期筛选 | 开始日期 ~ 结束日期 | 灵活，用户选任意范围 |
| 认证模式 | 无认证时不注册路由 | 不暴露页面入口 |
| 前端 | Hono JSX SSR | 与现有 user 页面一致 |

## 架构概览

```
/user/stats?start=2026-06-01&end=2026-06-14&page=1
  │
  ├─ createStatsRoute() — 无认证时跳过注册
  │
  └─ 有认证时:
       ├─ 查询概览: 聚合 COUNT / SUM / AVG
       │     └─ SELECT COUNT, SUM(tokens), AVG(duration) WHERE timestamp BETWEEN ? AND ? AND user_name = ?
       │
       ├─ 查询小时分布: 按小时分组
       │     └─ SELECT strftime, COUNT, SUM(tokens) WHERE ... GROUP BY hour ORDER BY hour
       │
       └─ 查询分页列表: 最近请求
             └─ SELECT * WHERE ... ORDER BY timestamp DESC LIMIT 20 OFFSET ?
```

## 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/user/routes/stats.tsx` | **重写** | 路由逻辑改为 SQLite 查询，支持日期范围 + 分页 |
| `src/user/views/stats.tsx` | **重写** | 全新 UI：概览卡片 + 小时分布 + 分页表格 |
| `src/user/components/Layout.tsx` | **修改** | 无认证时隐藏导航栏"统计"链接 |
| `src/user/views/home.tsx` | **修改** | 无认证时隐藏"统计"入口链接 |

**不修改：** 现有 admin stats、CLI stats 仍走 JSON 日志，不受影响。

## 页面布局

```
┌──────────────────────────────────────────┐
│  📊 使用统计 — [userName]                 │
│  ┌─ [开始日期] ─ [结束日期] ── [查询] ─┐ │
│  │  快捷: 今天 │ 最近7天 │ 最近30天     │ │
│  └──────────────────────────────────────┘ │
│                                            │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐    │
│  │总请求 │ │成功率 │ │Token │ │平均耗时│   │
│  │ 1,234 │ │ 98.5%│ │ 456K │ │ 2.3s  │   │
│  └──────┘ └──────┘ └──────┘ └──────┘    │
│                                            │
│  📈 Token 用量                             │
│  输入: 234K  输出: 222K  总计: 456K  缓存: 12K│
│                                            │
│  📊 按模型                                  │
│  [模型名] 请求数 成功率 Token              │
│  claude-3   856   98.2%   234K             │
│  gpt-4      378   99.5%   222K             │
│                                            │
│  📈 小时分布                                │
│  ████████ 08:00  45 req                    │
│  ████████████ 09:00  78 req                │
│  ...                                       │
│                                            │
│  📋 最近请求                                │
│  ┌────┬──────┬──────┬────┬───┬────┬───┐  │
│  │ # │ 时间  │ 模型 │状态│耗时│Tkns│错误│  │
│  ├────┼──────┼──────┼────┼───┼────┼───┤  │
│  │ 1 │ 14:30│ claude│ 200│2.1s│1.2K│ — │  │
│  │ 2 │ 14:29│ gpt-4 │ 200│1.5s│ 890│ — │  │
│  └────┴──────┴──────┴────┴───┴────┴───┘  │
│  ← 上一页  第 1/10 页  下一页 →            │
└──────────────────────────────────────────┘
```

## 概览指标

SQL 查询（单次聚合）：

```sql
SELECT
  COUNT(*) AS total_requests,
  SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successful,
  SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed,
  AVG(CASE WHEN status_code >= 200 AND status_code < 300 THEN duration_ms ELSE NULL END) AS avg_duration_ms,
  COALESCE(SUM(prompt_tokens), 0) AS total_input_tokens,
  COALESCE(SUM(completion_tokens), 0) AS total_output_tokens,
  COALESCE(SUM(total_tokens), 0) AS total_tokens,
  COALESCE(SUM(cached_tokens), 0) AS total_cached_tokens
FROM requests
WHERE timestamp >= ? AND timestamp <= ?
  AND user_name = ?
```

用户筛选：有认证时按当前用户筛选；无认证时不注册路由，不存在此情况。

## 按模型统计

```sql
SELECT
  custom_model,
  COUNT(*) AS requests,
  SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successful,
  SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed,
  COALESCE(SUM(total_tokens), 0) AS total_tokens,
  COALESCE(SUM(cached_tokens), 0) AS cached_tokens
FROM requests
WHERE timestamp >= ? AND timestamp <= ?
  AND user_name = ?
GROUP BY custom_model
ORDER BY requests DESC
```

## 小时分布

```sql
SELECT
  strftime('%Y-%m-%d %H:00', timestamp) AS hour,
  COUNT(*) AS requests,
  COALESCE(SUM(total_tokens), 0) AS total_tokens
FROM requests
WHERE timestamp >= ? AND timestamp <= ?
  AND user_name = ?
GROUP BY hour
ORDER BY hour ASC
```

## 分页详细列表

```sql
SELECT
  request_id, timestamp, custom_model, provider, status_code,
  duration_ms, total_tokens, prompt_tokens, completion_tokens,
  cached_tokens, error_message, error_type, endpoint
FROM requests
WHERE timestamp >= ? AND timestamp <= ?
  AND user_name = ?
ORDER BY timestamp DESC
LIMIT 20 OFFSET ?
```

分页参数从 query string 获取：`?start=2026-06-01&end=2026-06-14&page=2`

总条数单独查询：

```sql
SELECT COUNT(*) AS total FROM requests WHERE timestamp >= ? AND timestamp <= ? AND user_name = ?
```

### 数值格式化规则

| 范围 | 格式 | 示例 |
|------|------|------|
| 0–999 | 原样 | 500 |
| 1,000–999,999 | X.XK | 1.2K, 234.5K |
| 1,000,000+ | X.XM | 1.5M, 23.4M |

**耗时：**
| 范围 | 格式 | 示例 |
|------|------|------|
| 0–999ms | Xms | 500ms |
| 1,000ms+ | X.Xs | 2.3s, 12.1s |

## 路由注册逻辑

```ts
// src/user/routes/stats.tsx
export function createStatsRoute(configPath?: string) {
  if (!configPath) return new Hono(); // 无认证模式，不注册

  const config = loadFullConfig(configPath);
  const isAuthEnabled = !!(config.userApiKeys && config.userApiKeys.length > 0);
  if (!isAuthEnabled) {
    return new Hono(); // 无认证模式，返回空路由
  }

  const app = new Hono();
  app.get('/', async (c) => {
    const currentUser = getCurrentUser(c, configPath);
    if (!currentUser) return c.redirect('/user/login');
    // ... SQLite 查询 + 渲染
  });
  return app;
}
```

## 测试计划

| 测试 | 说明 |
|------|------|
| 无认证模式不注册路由 | `createStatsRoute()` 返回空 Hono 实例 |
| 有认证模式需要登录 | 未登录重定向到 `/user/login` |
| SQLite 查询 — 概览 | 验证聚合查询返回正确值 |
| SQLite 查询 — 按模型 | 验证 GROUP BY 正确 |
| SQLite 查询 — 小时分布 | 验证按小时 GROUP BY |
| SQLite 查询 — 分页 | 验证 LIMIT/OFFSET + 总条数 |
| 数值格式化 | formatNumber() / formatDuration() 单元测试 |
| 日期范围筛选 | 不同日期范围返回对应数据 |
| 无数据时显示空状态 | 日期范围无数据时不报错，显示空提示 |
