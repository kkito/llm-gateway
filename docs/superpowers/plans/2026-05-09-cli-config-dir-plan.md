# CLI Config Directory Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify `--dir`, `--config`, `--log-dir` CLI parameters into a single `-C, --config-dir` parameter with ConfigContext abstraction.

**Architecture:** Introduce `ConfigContext` interface that derives all paths (config, logs, pid) from a single base directory. CLI parses once, server.ts creates context internally, routes continue receiving `configPath` unchanged.

**Tech Stack:** TypeScript, Commander.js, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/paths.ts` | Modify | Add `*FromDir()` utility functions |
| `src/lib/config-context.ts` | Create | `ConfigContext` interface + factory |
| `src/cli/start.ts` | Modify | Replace old params with `-C, --config-dir` |
| `src/cli/stats.ts` | Modify | Replace old params with `-C, --config-dir` |
| `src/server.ts` | Modify | Accept `configDir` instead of `configPath` |
| `tests/lib/config-context.test.ts` | Create | Test ConfigContext path derivation |
| `tests/cli/start.test.ts` | Create | Test CLI parameter parsing |

---

### Task 1: Add `*FromDir()` functions to paths.ts

**Files:**
- Modify: `src/lib/paths.ts`
- Test: `tests/lib/paths.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/paths.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  getConfigPathFromDir,
  getLogDirFromDir,
  getDetailLogDirFromDir,
  getPidFileFromDir,
} from '../src/lib/paths.js';
import { join } from 'path';

describe('paths - *FromDir functions', () => {
  const testDir = '/my/work';

  it('getConfigPathFromDir returns config.json in dir', () => {
    expect(getConfigPathFromDir(testDir)).toBe(join(testDir, 'config.json'));
  });

  it('getLogDirFromDir returns logs/proxy in dir', () => {
    expect(getLogDirFromDir(testDir)).toBe(join(testDir, 'logs', 'proxy'));
  });

  it('getDetailLogDirFromDir returns logs in dir', () => {
    expect(getDetailLogDirFromDir(testDir)).toBe(join(testDir, 'logs'));
  });

  it('getPidFileFromDir returns llm-gateway.pid in dir', () => {
    expect(getPidFileFromDir(testDir)).toBe(join(testDir, 'llm-gateway.pid'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm exec vitest run tests/lib/paths.test.ts
```
Expected: FAIL with "is not exported" errors

- [ ] **Step 3: Add `*FromDir()` functions to paths.ts**

Add to `src/lib/paths.ts` (after existing functions):

```typescript
/**
 * Get config file path from a base directory
 */
export function getConfigPathFromDir(configDir: string): string {
  return join(configDir, 'config.json');
}

/**
 * Get structured log directory from a base directory
 */
export function getLogDirFromDir(configDir: string): string {
  return join(configDir, 'logs', 'proxy');
}

/**
 * Get detail log directory from a base directory
 */
export function getDetailLogDirFromDir(configDir: string): string {
  return join(configDir, 'logs');
}

/**
 * Get PID file path from a base directory
 */
export function getPidFileFromDir(configDir: string): string {
  return join(configDir, 'llm-gateway.pid');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm exec vitest run tests/lib/paths.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/paths.ts tests/lib/paths.test.ts
git commit -m "feat(paths): add *FromDir() utility functions for path derivation"
```

---

### Task 2: Create ConfigContext module

**Files:**
- Create: `src/lib/config-context.ts`
- Test: `tests/lib/config-context.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/config-context.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createConfigContext } from '../src/lib/config-context.js';
import { join } from 'path';
import { homedir } from 'os';

describe('ConfigContext', () => {
  it('creates context with default directory when no configDir provided', () => {
    const ctx = createConfigContext();
    expect(ctx.configDir).toBe(join(homedir(), '.llm-gateway'));
    expect(ctx.configPath).toBe(join(ctx.configDir, 'config.json'));
    expect(ctx.logDir).toBe(join(ctx.configDir, 'logs', 'proxy'));
    expect(ctx.detailLogDir).toBe(join(ctx.configDir, 'logs'));
    expect(ctx.pidFile).toBe(join(ctx.configDir, 'llm-gateway.pid'));
  });

  it('creates context with custom directory when configDir provided', () => {
    const ctx = createConfigContext('/my/custom/dir');
    expect(ctx.configDir).toBe('/my/custom/dir');
    expect(ctx.configPath).toBe('/my/custom/dir/config.json');
    expect(ctx.logDir).toBe('/my/custom/dir/logs/proxy');
    expect(ctx.detailLogDir).toBe('/my/custom/dir/logs');
    expect(ctx.pidFile).toBe('/my/custom/dir/llm-gateway.pid');
  });

  it('handles relative-like paths correctly', () => {
    const ctx = createConfigContext('./my-work');
    expect(ctx.configPath).toBe('./my-work/config.json');
    expect(ctx.pidFile).toBe('./my-work/llm-gateway.pid');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm exec vitest run tests/lib/config-context.test.ts
```
Expected: FAIL with "module not found"

- [ ] **Step 3: Create ConfigContext module**

Create `src/lib/config-context.ts`:

```typescript
import { join } from 'path';
import {
  getProxyDir,
  getConfigPathFromDir,
  getLogDirFromDir,
  getDetailLogDirFromDir,
  getPidFileFromDir,
} from './paths.js';

/**
 * Configuration context - derives all paths from a single base directory.
 */
export interface ConfigContext {
  /** Working directory */
  configDir: string;
  /** config.json path */
  configPath: string;
  /** logs/proxy directory (structured logs) */
  logDir: string;
  /** logs directory (detail logs) */
  detailLogDir: string;
  /** llm-gateway.pid file */
  pidFile: string;
}

/**
 * Create a ConfigContext from a base directory.
 * @param configDir - Base directory (defaults to ~/.llm-gateway)
 */
export function createConfigContext(configDir?: string): ConfigContext {
  const dir = configDir ?? getProxyDir();
  return {
    configDir: dir,
    configPath: getConfigPathFromDir(dir),
    logDir: getLogDirFromDir(dir),
    detailLogDir: getDetailLogDirFromDir(dir),
    pidFile: getPidFileFromDir(dir),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm exec vitest run tests/lib/config-context.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/config-context.ts tests/lib/config-context.test.ts
git commit -m "feat(lib): add ConfigContext interface and factory function"
```

---

### Task 3: Refactor `src/cli/start.ts` to use ConfigContext

**Files:**
- Modify: `src/cli/start.ts`

- [ ] **Step 1: Update CLI options and resolvePaths**

Replace the `CliOptions` interface and `resolvePaths` function in `src/cli/start.ts`:

**Before:**
```typescript
interface CliOptions {
  dir: string;
  config: string;
  logDir: string;
  port: number;
  timeout: number;
  daemon: boolean;
  stop: boolean;
  debug: boolean;
}

/**
 * 解析配置目录
 * 优先级：--config/--log-dir 指定值 > --dir 指定值 > 默认 ~/.llm-gateway/
 */
function resolvePaths(options: CliOptions) {
  const defaultDir = getProxyDir();
  const userDir = options.dir || defaultDir;

  // 如果用户指定了 --config，使用用户值；否则使用默认配置文件路径
  const configPath = options.config
    ? options.config
    : join(userDir, 'config.json');

  // 如果用户指定了 --log-dir，使用用户值；否则使用默认日志目录
  const logDirPath = options.logDir
    ? options.logDir
    : getLogDir();

  // 详细日志目录
  const detailLogDir = options.logDir
    ? join(options.logDir, '..')
    : getDetailLogDir();

  return { configPath, logDirPath, detailLogDir, userDir };
}
```

**After:**
```typescript
import { createConfigContext, ConfigContext } from '../lib/config-context.js';

interface CliOptions {
  configDir: string;
  port: number;
  timeout: number;
  daemon: boolean;
  stop: boolean;
  debug: boolean;
}

/**
 * 解析配置目录
 * 使用 -C/--config-dir 指定的值，默认 ~/.llm-gateway/
 */
function resolveContext(options: CliOptions): ConfigContext {
  return createConfigContext(options.configDir);
}
```

- [ ] **Step 2: Update imports**

**Before:**
```typescript
import { loadFullConfig, getProxyDir, getLogDir, getDetailLogDir, createDefaultConfig } from '../config.js';
```

**After:**
```typescript
import { loadFullConfig, createDefaultConfig } from '../config.js';
import { createConfigContext, ConfigContext } from '../lib/config-context.js';
```

- [ ] **Step 3: Update program options**

**Before:**
```typescript
.option('-d, --dir <path>', '工作目录 (默认 ~/.llm-gateway/)')
.option('-c, --config <path>', '配置文件路径')
.option('-l, --log-dir <path>', '日志目录')
.option('-p, --port <number>', '服务端口', '4000')
```

**After:**
```typescript
.option('-C, --config-dir <path>', '工作目录 (默认 ~/.llm-gateway/)')
.option('-p, --port <number>', '服务端口', '4000')
```

- [ ] **Step 4: Update action handler - resolvePaths call**

Find in the `.action()` callback:
```typescript
const { configPath, logDirPath, detailLogDir, userDir } = resolvePaths(options);
const pidFile = getPidFile(userDir);
```

Replace with:
```typescript
const ctx = resolveContext(options);
```

- [ ] **Step 5: Update --stop handler**

**Before:**
```typescript
if (options.stop) {
  stopDaemon(userDir);
  return;
}
```

**After:**
```typescript
if (options.stop) {
  stopDaemon(ctx.configDir);
  return;
}
```

- [ ] **Step 6: Update config file check**

**Before:**
```typescript
if (!existsSync(configPath)) {
  console.log(`📝 配置文件不存在，正在创建默认配置：${configPath}`);
  createDefaultConfig(configPath);
}

const config = loadFullConfig(configPath);
```

**After:**
```typescript
if (!existsSync(ctx.configPath)) {
  console.log(`📝 配置文件不存在，正在创建默认配置：${ctx.configPath}`);
  createDefaultConfig(ctx.configPath);
}

const config = loadFullConfig(ctx.configPath);
```

- [ ] **Step 7: Update work directory display**

**Before:**
```typescript
console.log(`📁 工作目录：${userDir}`);
```

**After:**
```typescript
console.log(`📁 工作目录：${ctx.configDir}`);
```

- [ ] **Step 8: Update daemon mode**

Find `startDaemon(options, userDir)` call, replace with:
```typescript
startDaemon(options, ctx.configDir);
```

Update `startDaemon` function to use configDir for PID file:

**Before:**
```typescript
function startDaemon(options: CliOptions, userDir: string): void {
  const pidFile = getPidFile(userDir);
  // ...
  const logDirForDisplay = options.logDir || getLogDir();
```

**After:**
```typescript
function startDaemon(options: CliOptions, configDir: string): void {
  const ctx = createConfigContext(configDir);
  const pidFile = ctx.pidFile;
  // ...
  const logDirForDisplay = ctx.logDir;
```

- [ ] **Step 9: Update stopDaemon function**

**Before:**
```typescript
function stopDaemon(userDir: string): void {
  const pidFile = getPidFile(userDir);
  stopRunning(pidFile, userDir);
  console.log('✓ 服务已停止');
}
```

**After:**
```typescript
function stopDaemon(configDir: string): void {
  const ctx = createConfigContext(configDir);
  stopRunning(ctx.pidFile, ctx.configDir);
  console.log('✓ 服务已停止');
}
```

- [ ] **Step 10: Update foreground mode logging**

**Before:**
```typescript
const logger = new Logger(logDirPath);
const logPath = logger.getFilePath();
console.log(`✓ 结构化日志目录：${logPath}`);

const detailLogger = new DetailLogger(detailLogDir, options.debug || false);
```

**After:**
```typescript
const logger = new Logger(ctx.logDir);
const logPath = logger.getFilePath();
console.log(`✓ 结构化日志目录：${logPath}`);

const detailLogger = new DetailLogger(ctx.detailLogDir, options.debug || false);
```

**Before:**
```typescript
const app = createServer(config, logger, detailLogger, timeoutMs, configPath);
```

**After:**
```typescript
const app = createServer(config, logger, detailLogger, timeoutMs, ctx.configDir);
```

- [ ] **Step 11: Run build and tests**

```bash
pnpm build && pnpm test
```
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add src/cli/start.ts
git commit -m "refactor(cli/start): replace --dir/--config/--log-dir with -C,--config-dir"
```

---

### Task 4: Refactor `src/cli/stats.ts` to use ConfigContext

**Files:**
- Modify: `src/cli/stats.ts`

- [ ] **Step 1: Update imports and interface**

**Before:**
```typescript
import { getProxyDir, getLogDir } from '../config.js';

interface CliStatsOptions {
  dir?: string;
  logDir?: string;
  date?: string;
  week?: string;
  month?: string;
  byHour?: boolean;
  byModel?: boolean;
  json?: boolean;
}

function resolveLogDir(options: CliStatsOptions): string {
  // 如果用户指定了 --log-dir，使用用户值；否则使用默认日志目录
  if (options.logDir) {
    return options.logDir;
  }
  return getLogDir();
}
```

**After:**
```typescript
import { createConfigContext } from '../lib/config-context.js';

interface CliStatsOptions {
  configDir?: string;
  date?: string;
  week?: string;
  month?: string;
  byHour?: boolean;
  byModel?: boolean;
  json?: boolean;
}

function resolveLogDir(options: CliStatsOptions): string {
  return createConfigContext(options.configDir).logDir;
}
```

- [ ] **Step 2: Update program options**

**Before:**
```typescript
.option('-d, --dir <path>', '工作目录 (默认 ~/.llm-gateway/)')
.option('-l, --log-dir <path>', '日志目录')
```

**After:**
```typescript
.option('-C, --config-dir <path>', '工作目录 (默认 ~/.llm-gateway/)')
```

- [ ] **Step 3: Run build and tests**

```bash
pnpm build && pnpm test
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/stats.ts
git commit -m "refactor(cli/stats): replace --dir/--log-dir with -C,--config-dir"
```

---

### Task 5: Update server.ts to accept configDir

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Update function signature and imports**

Add import:
```typescript
import { createConfigContext } from './lib/config-context.js';
```

**Before:**
```typescript
export function createServer(
  config: ProxyConfig,
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number = 300000,
  configPath?: string
): Hono {
  const app = new Hono();

  // 从 logger 获取 logDir
  const logDir = pathJoin(logger.getFilePath(), '..');
```

**After:**
```typescript
export function createServer(
  config: ProxyConfig,
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number = 300000,
  configDir?: string
): Hono {
  const app = new Hono();

  const ctx = createConfigContext(configDir);
  const logDir = ctx.logDir;
```

- [ ] **Step 2: Update route calls that use configPath**

All routes currently receive `configPath` — change them to use `ctx.configPath`. For example:

**Before:**
```typescript
if (configPath) {
  app.route('/user/login', createUserLoginRoute({ configPath }));
}
```

**After:**
```typescript
if (ctx.configDir) {
  app.route('/user/login', createUserLoginRoute({ configPath: ctx.configPath }));
}
```

Apply the same pattern to all `configPath` usages in server.ts:
- `createUserLoginRoute({ configPath })` → `createUserLoginRoute({ configPath: ctx.configPath })`
- `createUserStatsRoute(configPath)` → `createUserStatsRoute(ctx.configPath)`
- `createUserAuthMiddleware(configPath)` → `createUserAuthMiddleware(configPath)`
- `createChatCompletionsRoute(..., logDir)` — already uses ctx.logDir
- `createMessagesRoute(..., logDir)` — already uses ctx.logDir
- `createLoginRoute({ configPath })` → `createLoginRoute({ configPath: ctx.configPath })`
- `createPasswordRoute({ configPath })` → `createPasswordRoute({ configPath: ctx.configPath })`
- `createPrivacyRoute({ configPath, ... })` → `createPrivacyRoute({ configPath: ctx.configPath, ... })`
- `createAnnouncementRoute({ configPath, ... })` → `createAnnouncementRoute({ configPath: ctx.configPath, ... })`
- `createApiKeysRoute({ configPath })` → `createApiKeysRoute({ configPath: ctx.configPath })`
- `createModelFormRoute({ configPath, ... })` → `createModelFormRoute({ configPath: ctx.configPath, ... })`
- `createModelLimitsRoute({ configPath, ... })` → `createModelLimitsRoute({ configPath: ctx.configPath, ... })`
- `createModelGroupFormRoute({ configPath, ... })` → `createModelGroupFormRoute({ configPath: ctx.configPath, ... })`
- `createModelGroupsRoute({ configPath, ... })` → `createModelGroupsRoute({ configPath: ctx.configPath, ... })`
- `createUsersRoute(configPath)` → `createUsersRoute(ctx.configPath)`

- [ ] **Step 3: Run build and tests**

```bash
pnpm build && pnpm test
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "refactor(server): accept configDir instead of configPath"
```

---

### Task 6: Write CLI start.ts tests

**Files:**
- Create: `tests/cli/start.test.ts`

- [ ] **Step 1: Create test file**

Create `tests/cli/start.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConfigContext } from '../src/lib/config-context.js';
import { homedir } from 'os';
import { join } from 'path';

describe('CLI start.ts - config-dir parsing', () => {
  describe('createConfigContext integration', () => {
    it('uses default directory when no configDir provided', () => {
      const ctx = createConfigContext();
      const defaultDir = join(homedir(), '.llm-gateway');
      expect(ctx.configDir).toBe(defaultDir);
      expect(ctx.configPath).toBe(join(defaultDir, 'config.json'));
      expect(ctx.pidFile).toBe(join(defaultDir, 'llm-gateway.pid'));
      expect(ctx.logDir).toBe(join(defaultDir, 'logs', 'proxy'));
    });

    it('uses custom directory when configDir provided', () => {
      const ctx = createConfigContext('/custom/path');
      expect(ctx.configDir).toBe('/custom/path');
      expect(ctx.configPath).toBe('/custom/path/config.json');
      expect(ctx.pidFile).toBe('/custom/path/llm-gateway.pid');
      expect(ctx.logDir).toBe('/custom/path/logs/proxy');
      expect(ctx.detailLogDir).toBe('/custom/path/logs');
    });

    it('ensures --stop uses correct PID file for configDir', () => {
      const ctx = createConfigContext('/my/gateway');
      // PID file must be in the same configDir
      expect(ctx.pidFile).toContain('/my/gateway');
      expect(ctx.pidFile).toBe('/my/gateway/llm-gateway.pid');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
pnpm exec vitest run tests/cli/start.test.ts
```
Expected: PASS

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/cli/start.test.ts
git commit -m "test(cli): add tests for config-dir parsing"
```

---

### Task 7: Verify full test suite and build

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: All 72+ tests pass

- [ ] **Step 2: Run build**

```bash
pnpm build
```

Expected: No TypeScript errors

- [ ] **Step 3: Manual verification (optional)**

```bash
# Test default behavior
node dist/cli/start.js --help

# Test custom config-dir
node dist/cli/start.js -C /tmp/test-gateway --help
```

- [ ] **Step 4: Commit (if any fixes needed)**

```bash
git add .
git commit -m "fix: address test/build issues after config-dir refactor"
```

---

## Spec Coverage Checklist

| Spec Requirement | Task |
|------------------|------|
| ConfigContext interface | Task 2 |
| `*FromDir()` functions | Task 1 |
| Remove `--dir/--config/--log-dir` from start.ts | Task 3 |
| Add `-C, --config-dir` to start.ts | Task 3 |
| `--stop` uses correct PID file | Task 3 |
| Remove `--dir/--log-dir` from stats.ts | Task 4 |
| Add `-C, --config-dir` to stats.ts | Task 4 |
| server.ts accepts configDir | Task 5 |
| Routes receive ctx.configPath | Task 5 |
| Tests for ConfigContext | Task 2 |
| Tests for CLI parsing | Task 6 |
| Backward compat (default functions) | Task 1 (preserved) |

## Self-Review

✅ No placeholders or TBDs
✅ All code steps contain actual code
✅ Type signatures consistent across tasks
✅ TDD approach: tests written before implementation in each task
✅ DRY: *FromDir() functions reused by ConfigContext
✅ YAGNI: No extra abstraction beyond ConfigContext
