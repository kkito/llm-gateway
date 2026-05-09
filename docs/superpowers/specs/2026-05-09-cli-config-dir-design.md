# CLI 配置目录统一设计文档

**日期**: 2026-05-09
**状态**: Draft

## 问题

当前 CLI 有 `--dir`, `--config`, `--log-dir` 三个参数，概念交叉且 `--stop` 时 PID 文件查找与 `--config` 不匹配：

```
--dir      → 工作目录（默认 ~/.llm-gateway/）
--config   → 配置文件路径（与 --dir 交叉）
--log-dir  → 日志目录（与 --dir 交叉）
```

## 解决方案

### 目录结构约定

```
<configDir>/
├─ config.json          # 配置文件
├─ llm-gateway.pid      # PID 文件（后台服务）
└─ logs/
   ├─ proxy/            # 结构化日志
   └─ ...               # 详细日志
```

### ConfigContext 接口

```typescript
// src/lib/config-context.ts
export interface ConfigContext {
  configDir: string;     // 工作目录
  configPath: string;    // config.json 路径
  logDir: string;        // logs/proxy 路径
  detailLogDir: string;  // logs 路径
  pidFile: string;       // llm-gateway.pid 路径
}

export function createConfigContext(configDir?: string): ConfigContext;
```

### 文件修改清单

#### 1. `src/lib/config-context.ts` (新增)

- 定义 `ConfigContext` 接口
- 实现 `createConfigContext(configDir?: string)` 工厂函数
- 内部调用 `paths.ts` 中的 `*FromDir()` 工具函数
- 默认值: 未传 `configDir` 时使用 `getProxyDir()` 返回 `~/.llm-gateway`

#### 2. `src/lib/paths.ts` (修改)

- 保留现有默认函数 (`getProxyDir()`, `getConfigPath()`, `getLogDir()`, `getDetailLogDir()`)
- 新增 `*FromDir()` 系列函数：
  - `getConfigPathFromDir(configDir: string): string`
  - `getLogDirFromDir(configDir: string): string`
  - `getDetailLogDirFromDir(configDir: string): string`
  - `getPidFileFromDir(configDir: string): string`

#### 3. `src/cli/start.ts` (修改)

- **移除**: `--dir`, `--config`, `--log-dir` 选项
- **新增**: `-C, --config-dir <path>` 选项
- 简化 `resolvePaths()` → 使用 `createConfigContext()`
- `--stop` 逻辑使用 `ctx.pidFile`，正确匹配 PID 文件
- Daemon 模式子进程传递 `--config-dir` 参数

CLI 帮助文本更新：
```
-C, --config-dir <path>  工作目录 (默认 ~/.llm-gateway/)
-p, --port <number>      服务端口
-t, --timeout <ms>       请求超时 (ms)
-D, --daemon             后台启动
--stop                   停止后台服务
--debug                  启用详细日志
```

#### 4. `src/cli/stats.ts` (修改)

- **移除**: `--dir`, `--log-dir` 选项
- **新增**: `-C, --config-dir <path>` 选项
- 使用 `createConfigContext().logDir` 获取日志目录

#### 5. `src/server.ts` (修改)

- 参数从 `configPath?: string` 改为 `configDir?: string`
- 内部创建 `ConfigContext`，获取所有路径
- 路由传参使用 `ctx.configPath`，路由签名不变

```typescript
export function createServer(
  config: ProxyConfig,
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number = 300000,
  configDir?: string  // 改为 configDir
): Hono {
  const ctx = createConfigContext(configDir);
  // ... 路由使用 ctx.configPath, ctx.logDir 等
}
```

#### 6. `src/admin/routes/stats*.ts`, `src/user/routes/stats.tsx`

- 这些文件通过 `getLogDir()` 获取默认路径，不需要改动
- 若需要通过 ConfigContext 动态获取日志路径，可在 server.ts 层转换后传入

### 测试计划

#### `tests/lib/config-context.test.ts` (新增)

- 默认配置目录 (`~/.llm-gateway`)
- 指定配置目录后路径派生正确性
- 各路径拼接正确: config.json, logs/proxy, logs, llm-gateway.pid

#### `tests/cli/start.test.ts` (新增)

- `--config-dir` 指定后路径解析正确
- `--stop` 使用正确 PID 文件路径
- 默认行为不变
- 测试中 mock `existsSync`, `readFileSync`, `spawn` 等

#### `tests/config.test.ts` (修改)

- 保留 `getProxyDir()` 测试

### 向后兼容

- `getProxyDir()`, `getConfigPath()`, `getLogDir()`, `getDetailLogDir()` 保留不变
- 路由接收 `configPath` 的签名不变（由 server.ts 内部转换）
- 现有测试无需修改

### 示例用法

```bash
# 默认 ~/.llm-gateway/
kkito-llm-gateway

# 指定工作目录
kkito-llm-gateway -C /my/work
kkito-llm-gateway --config-dir /my/work

# 后台启动
kkito-llm-gateway -C /my/work --daemon

# 停止服务
kkito-llm-gateway -C /my/work --stop

# 查看统计
llm-gateway-stats -C /my/work
```
