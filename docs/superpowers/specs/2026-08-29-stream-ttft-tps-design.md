# 流式 TTFT / TPS 落库与展示

- 日期：2026-08-29
- 状态：已与用户确认设计
- 关联：`src/lib/schema.ts` / `src/lib/db.ts` / `src/lib/request-logger.ts` / `src/routes/*/stream-handler.ts` / `src/admin/routes/stats*.ts` / `src/admin/views/stats.tsx`

## 背景与目标

`admin/stats` 的"请求列表"当前仅展示`耗时(duration_ms)`与 token 数，缺少面向流式的两个核心体验指标：

- **TTFT (Time To First Token)**：从网关收到请求到首个 `data:` 帧发往下游的耗时，单位 ms。
- **TPS (Tokens Per Second)**：平均生成速率，`completionTokens / 生成阶段秒数`，保留一位小数。

目标：在**不增加单独迁移命令**的前提下（每次启动自动 `drizzle migrate`），为每条 `requests` 记录新增 `ttft_ms / tps`，仅流式有效，存量不回填，列表追加两列。

## 决策记录

| 议题 | 决定 | 理由 |
| --- | --- | --- |
| 适用范围 | A：仅 `is_streaming=1` 有效，非流式/失败存 `NULL` 显 `—` | 与用户确认：非流式无"首 token"语义，不造值 |
| 落库形态 | A：`ttft_ms INTEGER` + `tps REAL` 双列落库 | 列表分页直接取，无需查询时计算；与用户确认 |
| 存量回填 | A：不回填，`ALTER TABLE ADD COLUMN` 后存量为 `NULL` | 最简单，`—` 即表示无数据 |
| 展示 | 追加两列：`TTFT`、`TPS` 在 `耗时` 之后；`tps.toFixed(1) tok/s` / `formatDuration(ttft)` | 与用户确认；失败行留 `NULL` 不做 tooltip |
| 计算层 | B：网关层统一、首个 `controller.enqueue` 即 TTFT，不过滤空 `delta` | 用户选 B，逻辑最简单；在 3 个流处理器内埋点 |
| 空 delta | 不过滤，首个 `data:` 即算 TTFT | 用户确认"简单点" |

## 设计

### 1. 目标与范围

- `requests.ttft_ms INTEGER NULL`、`requests.tps REAL NULL`。
- 仅流式成功且流内产出过至少 1 个 `data:` 帧时写入；其余 `NULL`。
- `admin/stats` 与 `admin/api/stats` 的请求列表在"耗时"后追加两列；`user/stats` 如需同步则同改。
- 迁移幂等、无需额外命令；全新安装兜底建表同步补列。

### 2. 数据模型与迁移

**2.1 Schema (`src/lib/schema.ts`)**

```ts
export const requests = sqliteTable('requests', {
  // ...existing
  durationMs: integer('duration_ms'),
  isStreaming: integer('is_streaming', { mode: 'boolean' }),
  ttftMs: integer('ttft_ms'),
  tps: real('tps'),
  // promptTokens ... responseMetadata
});
```

- 均为可空、无默认值，避免存量 `NOT NULL` 迁移失败。
- `real` 来自 `drizzle-orm/sqlite-core`。

**2.2 迁移产物**

- `npx drizzle-kit generate` 生成 `migrations/0001_*.sql`：
  ```sql
  ALTER TABLE `requests` ADD COLUMN `ttft_ms` integer;
  ALTER TABLE `requests` ADD COLUMN `tps` real;
  ```
- 同步更新 `migrations/meta/_journal.json` 与 `0001_snapshot.json`。
- `package.json` 无 `files` 白名单，`migrations/` 默认随 `npm pack` 发布，已验证 `migrations/0000_*.sql` 在包内；新增迁移同理被包含。

**2.3 启动时自动迁移 (`src/lib/db.ts`)**

- `DatabaseManager.initialize()` 每次正常启动必走（`server.ts:131`，`--daemon` fork 子进程亦同；仅 `!configDir` 测试环境跳过）：
  ```ts
  const migrationsFolder = join(__dirname, '../../migrations');
  if (existsSync(migrationsFolder)) migrate(drizzle, { migrationsFolder });
  else { /* 兜底 CREATE TABLE */ }
  ```
- `migrate()` 基于 `__drizzle_migrations` 幂等，重复启动不重复执行。
- 兜底分支 `CREATE TABLE IF NOT EXISTS requests (...)` 必须同步追加 `ttft_ms integer, tps real`，否则仅 `COPY dist` 的镜像会建出旧表。

**2.4 写入映射 (`src/lib/request-logger.ts`)**

- `RequestLogEntry` 新增 `ttftMs?: number | null; tps?: number | null;`
- `writeBatch()` 的 `drizzle.insert(requests).values(...)` 映射两字段。
- `writeBatchIndividually()` 的 `INSERT OR IGNORE INTO requests (... ttft_ms, tps ...) VALUES (... @ttftMs, @tps ...)` 同步追加列与占位。
- 未传时显式 `?? null`，与 `schema` 可空一致。

### 3. 计算口径（方案 B：不过滤空 delta）

**3.1 TTFT(ms)**

- 定义：`TTFT = 首个 controller.enqueue 成功时刻 - handler startTime`。
- 仅流式路径；在 3 个 `handleStream` 的 `ReadableStream.start` 内新增 `let firstEnqueueAt: number | null = null` 状态。
- 触发点：每次 `controller.enqueue(...)` 成功后，若 `firstEnqueueAt === null` 则置 `firstEnqueueAt = Date.now()` 并 `logEntry.ttftMs = firstEnqueueAt - startTime`。
- 计数规则（B 方案简化）：
  - `: ping` 这类被 `if (part.startsWith(':')) continue` 跳过的帧不触发 `enqueue`，自然不计。
  - 首个 `data:` 即算，即使 `choices[0].delta.content === ""` 或 `content_block_delta` 为空；首个 `[DONE]` 亦算（空流场景）。
  - 空流（`chunks.length === 0` 且无 `data:`）保持 `null`。
- 非流式、鉴权失败、上游无 body、异常 `controller.error` 分支不设 `ttftMs`，保持 `null`。

**3.2 总时长修正**

- 现状缺陷：`handler.ts` 在拿到上游 `Response` 头后即冻结 `logEntry.durationMs = Date.now() - startTime`（实为 TTFB），传给 `handleStream` 后不再更新。
- 修正：`done` 分支（`reader.read() done === true`）内覆盖 `logEntry.durationMs = Date.now() - startTime`，作为 TPS 分母依据与落库值。

**3.3 TPS(tok/s)**

- 定义：`TPS = completionTokens / ((durationMs - ttftMs) / 1000)`，流式生成阶段速率。
- `completionTokens` 取结束时从 `chunks` 反查的 `usage`：
  - `chat-completions/stream-handler.ts`：`findFinalUsageFromChunks(chunks, 'openai')`
  - `messages/stream-handler.ts`：`findFinalUsageFromChunks(chunks, 'anthropic')`
  - `responses/stream-handler.ts`：`extractUsageFromResponsesChunks(chunks)`（`response.usage`）
- 保护：
  ```ts
  if (logEntry.ttftMs != null && logEntry.completionTokens != null
      && logEntry.durationMs > logEntry.ttftMs) {
    const secs = (logEntry.durationMs - logEntry.ttftMs) / 1000;
    logEntry.tps = Math.round((logEntry.completionTokens / secs) * 10) / 10;
  } else {
    logEntry.tps = null;
  }
  ```
- 非流式/失败/无 `usage`/`durationMs <= ttftMs`/`secs <= 0` 均 `null`；存 `REAL` 一位小数精度由写入时 `round` 保证，展示再 `toFixed(1)`。

**3.4 非流式与失败**

- 6 条非流式落库路径（`chat-completions/handler.ts` 的 404/401/非流成功/兜底、`messages/handler.ts`、`responses/handler.ts` 同理）不传两字段，落 `NULL`。

### 4. 写入与展示链路

**4.1 写入（3 个流处理器）**

- `src/routes/chat-completions/stream-handler.ts`
- `src/routes/messages/stream-handler.ts`
- `src/routes/responses/stream-handler.ts`

改动形态一致（以 chat 为例）：

```ts
let firstEnqueueAt: number | null = null;
function markTtft() {
  if (firstEnqueueAt === null) {
    firstEnqueueAt = Date.now();
    logEntry.ttftMs = firstEnqueueAt - startTime;
  }
}
// 每次 controller.enqueue 成功后调用 markTtft()
// done 分支：
logEntry.durationMs = Date.now() - startTime;
if (firstEnqueueAt != null && logEntry.completionTokens != null
    && logEntry.durationMs > logEntry.ttftMs!) { /* 计算 tps */ }
requestLogger.log({ ...logEntry, ttftMs: logEntry.ttftMs ?? null, tps: logEntry.tps ?? null });
```

- `responses/stream-handler.ts` 当前 `requestLogger.log` 未传 usage，需一并补 `promptTokens/completionTokens/totalTokens/cachedTokens/ttftMs/tps`。

**4.2 读取**

- `src/admin/routes/stats.tsx`：`recentRequests SELECT` 追加 `ttft_ms AS ttftMs, tps`，`RecentRequestEntry` 追加两字段，无聚合改动。
- `src/admin/routes/stats-api.ts`：同上，`GET /admin/api/stats` 返回的分页数据带两字段。
- 排序/过滤不依赖新列。

**4.3 展示**

- `src/admin/views/stats.tsx`：表头 `耗时` 后追加 `TTFT`、`TPS`，单元格：
  ```tsx
  <td>{req.ttftMs != null ? formatDuration(req.ttftMs) : '—'}</td>
  <td>{req.tps != null ? `${req.tps.toFixed(1)} tok/s` : '—'}</td>
  ```
- `src/user/views/stats.tsx`：如需保持一致则同改（可选，不在本次必做）。
- 存量 `NULL` 行自然显示 `—`。

### 5. 边界与异常

| 场景 | 行为 |
| --- | --- |
| 存量行 | `ttft_ms/tps` 为 `NULL`，列表 `—`，`ORDER` 不依赖新列 |
| 空流（无 `data:`） | `ttftMs=null, tps=null` |
| 流异常 `controller.error` | 未走到 `done` 分支，不落两字段（或落 `null`），不阻断服务 |
| `durationMs <= ttftMs` | `tps=null`（除零保护） |
| 无 `completionTokens` | `tps=null`，`ttftMs` 仍可落 |
| 非流式/401/404 | 两字段 `null` |
| `migrate` 失败 | 不应阻断启动；`db.ts` 已有 `existsSync` 守卫，异常可日志告警 |

### 6. 测试与验证

- 单测（新增或扩展）：
  - `utils`：`tps = completionTokens*1000/(durationMs-ttftMs)` 的正常/零/空/负分母用例，一位小数 round。
  - `RequestLogger`：批量写入对 `ttft_ms/tps` 的映射（含 `INSERT OR IGNORE` 列清单）。
  - `admin/stats` 路由：`SELECT` 含两列、接口返回含 `ttftMs/tps`。
- 手工：`npm run build && npm test`；发版后重启一次观察 `gateway.db` 的 `PRAGMA table_info(requests)` 含两列，流式请求后列表出现数值，非流式为 `—`。

### 7. 不做

- 存量回填（保持 `NULL`）。
- 聚合统计 `AVG(ttft_ms)/AVG(tps)`（后续按需）。
- 前端 tooltip `仅流式有效`（用户确认不过度提示）。
- 响应头 `X-TTFT` 等透传（网关内计量即可）。

### 8. 文件清单

- 修改：`src/lib/schema.ts`、`src/lib/db.ts`、`src/lib/request-logger.ts`、`src/routes/chat-completions/stream-handler.ts`、`src/routes/messages/stream-handler.ts`、`src/routes/responses/stream-handler.ts`、`src/admin/routes/stats.tsx`、`src/admin/routes/stats-api.ts`、`src/admin/views/stats.tsx`
- 生成：`migrations/0001_*.sql`、`migrations/meta/_journal.json`、`migrations/meta/0001_snapshot.json`
- 可选：`src/user/routes/stats.tsx`、`src/user/views/stats.tsx`

### 9. 风险

- `else CREATE TABLE` 漏补列会导致全新安装表结构滞后 -> 通过提交时同步修改规避。
- 3 个流处理器逻辑重复 -> 抽 `src/lib/stream-metrics.ts: calcTps()` 小工具收敛计算，埋点仍分散但计算唯一。
