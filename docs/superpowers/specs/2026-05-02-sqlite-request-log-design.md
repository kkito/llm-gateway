# SQLite 请求日志系统设计文档

**日期：** 2026-05-02  
**状态：** 待实现  
**分支：** dev

## 目标

用 SQLite 替换现有的 JSON 日志文件存储方案，将请求元数据（token 消耗、耗时、模型、provider 等）持久化到 SQLite 数据库中，提升统计查询性能，简化架构。

**历史数据不需要迁移。**

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 存储 | 完全替换 JSON 日志 | 单一数据源，避免双写不一致 |
| 写入 | 异步批量写入 | 不影响请求响应延迟 |
| 查询 | 直接从 SQLite 读取 | 删除旧的日志解析逻辑，架构更干净 |
| 限流 | 内存计数器 + SQLite 冷启动 | 性能好，重启后自动恢复计数 |
| 依赖 | better-sqlite3 | 同步 API，性能好，生态成熟 |

## 架构概览

```
请求完成 → RequestLogger.log(entry) → 推入内存队列 → 立即返回
                                              ↓
                                    [后台 worker 每 100ms]
                                              ↓
                                    批量 INSERT 到 SQLite
                                              ↓
                                    ~/.llm-gateway/gateway.db
                                              ↓
                    ┌─────────────────────────┼─────────────────────────┐
                    ↓                         ↓                         ↓
              统计查询                    限流冷启动                未来扩展
            (SQL 聚合查询)          (启动时加载计数到内存)
```

## 模块设计

### 1. 数据库初始化（`src/lib/db.ts`）

**DatabaseManager 类（单例）**

- `getInstance(configDir: string): DatabaseManager` — 获取或创建单例
- `initialize(): void` — 打开数据库，配置 WAL 模式，创建表和索引
- `getDb(): Database` — 获取 better-sqlite3 Database 实例
- `close(): void` — 关闭数据库连接
- `resetInstance(): void` — 测试用，重置单例

**数据库配置：**
- 路径：`~/.llm-gateway/gateway.db`
- `PRAGMA journal_mode = WAL` — 更好的并发
- `PRAGMA synchronous = NORMAL` — 性能与安全的平衡

**表结构：**

```sql
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT UNIQUE NOT NULL,
  timestamp TEXT NOT NULL,
  custom_model TEXT,
  real_model TEXT,
  provider TEXT,
  endpoint TEXT,
  status_code INTEGER,
  duration_ms INTEGER,
  is_streaming INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cached_tokens INTEGER,
  user_name TEXT,
  model_group TEXT,
  actual_model TEXT,
  error_message TEXT,
  error_type TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_timestamp ON requests(timestamp);
CREATE INDEX IF NOT EXISTS idx_custom_model ON requests(custom_model);
CREATE INDEX IF NOT EXISTS idx_user_name ON requests(user_name);
CREATE INDEX IF NOT EXISTS idx_created_at ON requests(created_at);
```

### 2. 异步写入队列（`src/lib/request-logger.ts`）

**RequestLogger 类（单例）**

- `getInstance(dbManager: DatabaseManager): RequestLogger` — 获取或创建单例
- `start(): void` — 启动后台 worker，每 100ms 批量写入
- `log(entry: LogEntry): void` — 将请求推入队列（非阻塞）
- `stop(): void` — 刷空队列后关闭
- `resetInstance(): void` — 测试用

**队列行为：**
- 内存数组存储待写入的 `LogEntry`
- 后台 worker 用 `setInterval` 每 100ms 唤醒
- 批量取出队列数据，用单事务 `INSERT OR IGNORE` 写入
- 队列积压上限：500 条，超限时丢弃最老条目并记录警告

**写入流程：**
```ts
// 批量插入时使用单条 prepared statement 循环
const stmt = db.prepare(`
  INSERT OR IGNORE INTO requests 
    (request_id, timestamp, custom_model, ..., created_at)
  VALUES (?, ?, ?, ..., ?)
`);

db.transaction((entries) => {
  for (const e of entries) stmt.run(...);
})(batch);
```

### 3. 统计查询改造

#### 3.1 `src/lib/stats-core.ts`

**保留的函数：**
- `getWeekRange()`, `getMonthRange()` — 日期范围计算
- 类型定义：`Stats`, `ModelStats`, `StatsOptions`

**删除的函数：**
- `parseLogFile()` — 不再需要
- `getLogFilesForRange()` — 不再需要
- `loadStats()` — 替换为 SQLite 版本

**新增函数：**
```ts
function calculateStats(db: Database, options: StatsOptions): Stats
function getHourlyBreakdown(db: Database, options: StatsOptions): HourlyStats[]
function getDailyBreakdown(db: Database, options: StatsOptions): DailyStats[]
```

**SQL 查询示例：**
```sql
-- 按模型聚合
SELECT 
  custom_model,
  provider,
  COUNT(*) as requests,
  SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as successful,
  SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as failed,
  SUM(prompt_tokens) as inputTokens,
  SUM(completion_tokens) as outputTokens,
  SUM(total_tokens) as totalTokens,
  SUM(cached_tokens) as cachedTokens
FROM requests
WHERE timestamp >= ? AND timestamp <= ?
GROUP BY custom_model, provider
```

#### 3.2 `src/lib/stats-provider.ts`

**改造：**
- 删除 `loadFromLogs()` 方法
- `getStats()` 直接调用 `stats-core.ts` 的 SQLite 版本
- `ensureCountersLoaded()` 保留，改为从 SQLite 初始化

#### 3.3 `src/lib/stats-api.ts`

**改造：**
- 删除日志文件解析的 fallback 逻辑
- 直接走 SQLite 查询路径

### 4. 限流系统改造（`src/lib/usage-tracker.ts`）

**改造点：**
- `UsageTracker` 启动时从 SQLite 加载今日/本周/本月计数器
- 后续请求成功后仅更新内存计数器
- 滑动窗口清理逻辑保持不变

**启动加载示例：**
```ts
async loadInitialCounters() {
  const today = dayStart();
  const todayEnd = dayEnd();
  
  const todayData = db.prepare(`
    SELECT custom_model, COUNT(*) as requests, SUM(prompt_tokens) as inputTokens
    FROM requests 
    WHERE timestamp >= ? AND timestamp < ?
    GROUP BY custom_model
  `).all(today, todayEnd);

  for (const row of todayData) {
    initCounter(row.custom_model, { 
      requests: row.requests, 
      inputTokens: row.inputTokens 
    });
  }
  // 本周、本月同理
}
```

### 5. server.ts 改造

**启动时：**
```ts
const dbManager = DatabaseManager.getInstance(getConfigDir());
dbManager.initialize();

const requestLogger = RequestLogger.getInstance(dbManager);
requestLogger.start();
```

**关闭时：**
```ts
process.on('SIGTERM', () => {
  requestLogger.stop();
  dbManager.close();
});
```

**路由中：**
- `handler.ts` 中调用 `requestLogger.log(logEntry)` 替代原来写日志逻辑
- 原有的 `logger.log()` 保留，仅用于普通应用日志（启动、错误等）
- `detail-logger.ts` 保留，`--debug` 模式下的详细日志继续写文件

### 6. 依赖变更

```json
{
  "dependencies": {
    "better-sqlite3": "^12.x"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.x"
  }
}
```

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/db.ts` | 新建 | 数据库初始化管理 |
| `src/lib/request-logger.ts` | 新建 | 异步写入队列 |
| `src/lib/stats-core.ts` | 修改 | 改为 SQL 聚合查询 |
| `src/lib/stats-provider.ts` | 修改 | 删除日志加载逻辑 |
| `src/lib/stats-api.ts` | 修改 | 删除日志 fallback |
| `src/lib/usage-tracker.ts` | 修改 | SQLite 冷启动 |
| `src/server.ts` | 修改 | 启动/关闭 DB 和队列 |
| `src/routes/chat-completions/handler.ts` | 修改 | 调用 requestLogger |
| `src/routes/messages/handler.ts` | 修改 | 调用 requestLogger |
| `src/logger.ts` | 保留 | 仅用于应用日志 |
| `src/detail-logger.ts` | 保留 | debug 模式继续写文件 |
| `package.json` | 修改 | 新增 better-sqlite3 依赖 |
| `tests/**` | 新建/修改 | 新增测试 |

## 测试策略

1. **db.ts 单元测试** — 初始化、表创建、关闭、reset
2. **request-logger.ts 单元测试** — 队列推入、批量写入、队列满丢弃、stop 刷空
3. **stats-core.ts 单元测试** — SQL 聚合查询正确性、时间范围过滤
4. **usage-tracker.ts 单元测试** — 冷启动加载计数、内存更新一致性
5. **集成测试** — 模拟完整请求流程 → 检查 SQLite 有记录 → 统计查询返回正确结果

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 异步写入丢失数据 | 队列有上限，stop() 时刷空；极端崩溃最多丢 100ms 内的数据 |
| better-sqlite3 编译问题 | 需要 node-gyp，CI/CD 确保有构建工具链 |
| SQLite 单文件性能瓶颈 | 单机代理服务请求量不高，WAL 模式已足够 |
| 队列积压过大 | 超 500 条时丢弃最老并记录警告 |
