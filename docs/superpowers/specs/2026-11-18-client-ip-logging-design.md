# 记录客户端来源 IP — 设计文档

## 需求

网关需要记录每次代理请求的客户端来源 IP，以便后续追溯请求来源。

## 目标

以后每次代理请求都能追溯来源 IP：

1. 数据库 `requests` 表保存 `client_ip`。
2. proxy 文件日志（每条 JSON 行）带 `clientIp` 字段。
3. 不改 admin 统计页、不加按 IP 过滤/聚合。

非目标：

- 不记录到 detail logger（`detailLogEnabled=false` 时无详细日志）。
- 不引入可信代理白名单配置（直接信任代理头）。
- 不回填历史数据（历史行 `client_ip` 为 NULL）。

## 架构与组件

### 1. 客户端 IP 解析工具

新增 `src/lib/client-ip.ts`，导出纯函数：

```ts
export function getClientIp(c: any): string | null
```

解析优先级：

1. `x-forwarded-for` 头第一段（trim 后非空）
2. `x-real-ip` 头（trim 后非空）
3. Hono/Node 连接 IP：`c.env?.incoming?.socket?.remoteAddress`，必要时去掉 IPv6 mapped 前缀 `::ffff:`
4. 以上都没有 → `null`

纯函数，不依赖全局状态，便于单测。复用现有入口处已经写头的模式，避免重复解析逻辑分散在多个 handler。

### 2. 请求入口改造

涉及三个代理入口：

- `src/routes/chat-completions/handler.ts`
- `src/routes/responses/handler.ts`
- `src/routes/messages/handler.ts`

在每个 handler 入口处计算一次 `const clientIp = getClientIp(c)`，然后：

- 把现有传给拦截器的 `clientIp: c.req.header(...)` 替换为该值（行为等价但统一）。
- 所有 `requestLogger.log({...})` 调用补上 `clientIp`（含各自 stream-handler、response-processor、fallback 中的日志写入点）。

使用统一值可保证同一次请求的多条日志（非流式中继/流式最终统计）IP 一致。

### 3. 数据层

- `src/lib/schema.ts`：`requests` 表增加 `clientIp: text('client_ip')`，表选项增加 `index('idx_client_ip').on(t.clientIp)`。
- `src/lib/request-logger.ts`：`RequestLogEntry` 增加 `clientIp?: string | null`；drizzle insert 和原生 SQL fallback 两条写入路径都写入 `client_ip`。
- `src/lib/db.ts`：`ensureColumns()` 增加 `client_ip` 列与 `idx_client_ip` 索引的兜底（`CREATE INDEX IF NOT EXISTS`），兼容老库或 drizzle migrations 表缺失/异常的场景。
- 新增 `migrations/0002_add_client_ip.sql`：
  ```sql
  ALTER TABLE `requests` ADD `client_ip` text;
  --> statement-breakpoint
  CREATE INDEX `idx_client_ip` ON `requests` (`client_ip`);
  ```

启动顺序保证安全：`server.ts` 中先 `dbManager.initialize()`（执行 migrate/ensureColumns），再创建并启动 `RequestLogger`，所以写日志时列一定存在。

### 4. 文件日志

`src/logger.ts`（proxy logger）在序列化每条请求日志时加入 `clientIp`：

- 有值：字符串
- 无值：`null`

日志字段命名与数据库保持一致语义但沿用 JS 风格：`clientIp`（DB 为 `client_ip`）。

## 错误与边界处理

- `x-forwarded-for` 可能包含多个逗号分隔值或空白，取第一段并 trim。
- 代理头可能被伪造；当前部署信任入口代理，安全增强（白名单）列为后续独立需求。
- 连接 IP 可能是 `::ffff:127.0.0.1` 或 IPv6，保留原始值，仅规范化 IPv4-mapped 前缀。
- 获取失败一律写 `null`，不能因为 IP 解析导致请求失败。
- `clientIp` 是可选字段，不影响已有调用方（如测试里的日志断言）。

## 测试

遵循项目“每个 src 模块都有对应测试”的规则：

- `tests/lib/client-ip.test.ts`：XFF 多段、X-Real-IP、连接 IP、IPv4-mapped、全无返回 null。
- `tests/lib/request-logger.test.ts`：新增断言 `clientIp` 写入数据库，覆盖 drizzle 批量路径和 UNIQUE fallback 原生 SQL 路径。
- `tests/integration/sqlite-logging.test.ts`：迁移后 `client_ip` 列存在且可查询。
- 现有路由测试补断言：`requestLogger.log()` 的 entry 含 `clientIp`（来自 handler 传入的 mock `c` 头）。

验证命令：`npm test`、`pnpm build`。

## 部署步骤

1. 升级前先备份数据库文件。
2. 发布新版本（构建后替换 dist）。
3. 重启网关进程；启动时自动执行 migration。
4. 发一条测试请求，确认 DB 和 proxy 日志出现 `client_ip` / `clientIp`。
