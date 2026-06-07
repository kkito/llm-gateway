# SQLite 请求日志设计文档

**日期：** 2026-06-07
**状态：** 待实现
**分支：** feature/sqlite-request-log-v2

## 目标

使用 SQLite 记录已认证用户的 LLM 请求数据，包括 token 用量、请求耗时、状态码、以及上游 API 返回的完整 usage metadata，用于后续的用量查询和统计。

**不记录匿名用户请求。**

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| ORM | Drizzle ORM | TypeScript 原生类型安全，内置 migration 支持，轻量 tree-shakeable，与 better-sqlite3 原生兼容 |
| 写入方式 | 异步批量队列 | 不阻塞请求响应，每 100ms flush 一次 |
| 记录范围 | 仅认证用户 | 匿名请求直接跳过，不入队列 |
| 错误记录 | 全部记录 | 成功和失败（401/429/500 等）都记 |
| JSON 日志 | 双写过渡期 | SQLite 和 JSON 文件同时写，稳定后移除 JSON |
| 数据保留 | 90 天 | cleanupOldRequests() 定时清理 requests 表 |
| Metadata 存储 | 固定字段 + JSON 兜底 | prompt_tokens 等常用字段独立列，完整 usage 对象存 response_metadata |
| 费用计算 | 不自行计算 | API 返回中有 cost 则记入 response_metadata，没有就不记 |
| Migration | drizzle-kit generate + migrate | 开发阶段生成 SQL，线上启动自动执行未运行迁移 |

## 架构概览

```
请求完成 → handler.ts
  ├─ logger.log(entry)       → JSON 文件（双写过渡期，保持不变）
  └─ requestLogger.log()     → 内存队列
                                  │
                         [每 100ms flush]
                                  │
                         Drizzle db.insert(requests).values(batch)
                                  │
                         SQLite gateway.db (WAL 模式)
                                  │
                     ┌────────────┼────────────┐
                     ↓            ↓            ↓
                 统计查询      90天清理      未来扩展
```

## 模块设计

### 1. Drizzle Schema（`src/lib/schema.ts`）

```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const requests = sqliteTable('requests', {
  // 标识
  id: integer('id').primaryKey({ autoIncrement: true }),
  requestId: text('request_id').notNull().unique(),
  timestamp: text('timestamp').notNull(),
  createdAt: integer('created_at').notNull(),

  // 用户
  userName: text('user_name'),

  // 模型
  customModel: text('custom_model'),
  realModel: text('real_model'),
  provider: text('provider'),
  modelGroup: text('model_group'),
  actualModel: text('actual_model'),

  // 请求元信息
  endpoint: text('endpoint'),
  statusCode: integer('status_code'),
  durationMs: integer('duration_ms'),
  isStreaming: integer('is_streaming', { mode: 'boolean' }),

  // Token 用量（固定字段，方便 SQL 聚合查询）
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),
  cachedTokens: integer('cached_tokens'),

  // 错误信息
  errorMessage: text('error_message'),
  errorType: text('error_type'),

  // 上游 API 原始 usage 全量存档（JSON）
  // 包含不同 provider 的扩展字段，如 cached_tokens、cost 等
  responseMetadata: text('response_metadata'),
});
```

索引：
- `idx_timestamp ON requests(timestamp)`
- `idx_user_name ON requests(user_name)`
- `idx_custom_model ON requests(custom_model)`
- `idx_created_at ON requests(created_at)` — 用于清理查询

### 2. DatabaseManager（`src/lib/db.ts`）

单例，管理 better-sqlite3 连接和 Drizzle 实例。

```typescript
initialize():
  - 打开/创建 gateway.db（~/.llm-gateway/gateway.db）
  - PRAGMA journal_mode = WAL
  - PRAGMA synchronous = NORMAL
  - 创建 Drizzle 实例
  - 执行 migrate() 自动应用未运行的迁移

cleanupOldRequests(retentionDays = 90):
  - DELETE FROM requests WHERE created_at < cutoff

close():
  - 关闭数据库连接
```

### 3. RequestLogger（`src/lib/request-logger.ts`）

单例，异步批量写入队列。

- `start()` — 启动 setInterval，每 100ms flush
- `log(entry)` — 推入内存队列（上限 500 条，超限丢弃最旧）
- `stop()` — 刷空队列后关闭

flush 时调用 `db.insert(requests).values(batch).run()`。

### 4. Migration 配置（`drizzle.config.ts`）

```typescript
export default defineConfig({
  schema: './src/lib/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  dbCredentials: { url: './gateway.db' },
});
```

工作流：
```
pnpm drizzle-kit generate    → migrations/0000_xxx.sql
pnpm drizzle-kit migrate     → 应用到本地 DB
git add migrations/ schema/
```

### 5. server.ts 改造

启动时：
```typescript
const dbManager = DatabaseManager.getInstance(configDir);
dbManager.initialize();
const requestLogger = RequestLogger.getInstance(dbManager);
requestLogger.start();
```

定时清理（复用现有每小时定时器）：
```typescript
cleanupInterval = setInterval(() => {
  statsProvider.cleanup();
  dbManager.cleanupOldRequests(90);  // 只清理 requests 表
}, 60 * 60 * 1000);
```

关闭时：
```typescript
process.on('SIGTERM', () => {
  requestLogger.stop();
  dbManager.close();
});
```

### 6. handler.ts 改造

在 handler 的 `logger.log(entry)` 位置追加条件判断：

```typescript
// 匿名用户跳过 SQLite 记录
if (currentUser) {
  requestLogger.log({
    requestId, timestamp, userName: currentUser.name,
    customModel, realModel, provider, endpoint,
    statusCode, durationMs, isStreaming,
    promptTokens, completionTokens, totalTokens, cachedTokens,
    modelGroup, actualModel, errorMessage, errorType,
    responseMetadata: JSON.stringify(upstreamUsage ?? {}),
  });
}
```

涉及修改的文件：
- `src/routes/chat-completions/handler.ts`
- `src/routes/chat-completions/stream-handler.ts`
- `src/routes/chat-completions/non-stream-handler.ts`
- `src/routes/messages/handler.ts`

## 依赖变更

```json
{
  "dependencies": {
    "better-sqlite3": "^12.x",
    "drizzle-orm": "^0.x"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.x",
    "drizzle-kit": "^0.x"
  }
}
```

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `package.json` | 修改 | 新增依赖 |
| `drizzle.config.ts` | 新建 | Drizzle Kit 配置 |
| `src/lib/schema.ts` | 新建 | Drizzle 表定义 |
| `src/lib/db.ts` | 新建 | DatabaseManager 单例 |
| `src/lib/request-logger.ts` | 新建 | 异步写入队列 |
| `migrations/0000_initial.sql` | 生成 | drizzle-kit 生成初始迁移 |
| `src/server.ts` | 修改 | 初始化 DB/RequestLogger，追加清理 |
| `src/routes/chat-completions/handler.ts` | 修改 | 追加 requestLogger.log() |
| `src/routes/chat-completions/stream-handler.ts` | 修改 | 同上 |
| `src/routes/chat-completions/non-stream-handler.ts` | 修改 | 同上 |
| `src/routes/messages/handler.ts` | 修改 | 同上 |
| `tests/lib/db.test.ts` | 新建 | 单元测试 |
| `tests/lib/request-logger.test.ts` | 新建 | 单元测试 |
| `tests/lib/schema.test.ts` | 新建 | 单元测试 |
| `tests/integration/sqlite-logging.test.ts` | 新建 | 集成测试 |

## 测试策略

| 测试 | 内容 |
|------|------|
| db.test.ts | 单例模式、WAL 模式初始化、migrate 执行、close、双初始化幂等 |
| request-logger.test.ts | 入队、批量 flush、INSERT OR IGNORE 去重、队列满丢弃、stop 刷空 |
| schema.test.ts | 表列名和类型匹配 Drizzle 定义、索引存在 |
| integration | 模拟请求 → SQLite 有记录 → 统计查询正确 |

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| migration 失败导致启动异常 | migrate() 内用事务包裹，失败回滚不破坏 DB |
| 队列积压丢失数据 | 500 条上限 + 丢弃最旧并 warn；stop() 时同步刷空 |
| better-sqlite3 编译问题 | 需要 node-gyp，Docker/CI 确保有构建工具链 |
| 双写期间 JSON 和 SQLite 不一致 | 以 JSON 为准（稳定方案），SQLite 逐步验证后切换 |
