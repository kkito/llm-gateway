# SQLite Request Log System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace JSON log file storage with SQLite for request metadata (tokens, duration, model, provider, etc.), improving stats query performance and simplifying architecture.

**Architecture:** New `DatabaseManager` initializes SQLite DB, `RequestLogger` provides async batch-write queue. Stats and usage-tracker modules switch from log-file parsing to SQL queries. Old log-writing code is removed.

**Tech Stack:** better-sqlite3, existing Hono/TypeScript stack, vitest for testing.

---

### Task 1: Add better-sqlite3 dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install better-sqlite3 and its types**

Run:
```bash
pnpm add better-sqlite3 && pnpm add -D @types/better-sqlite3
```

- [ ] **Step 2: Verify install**

Run:
```bash
node -e "import('better-sqlite3').then(() => console.log('OK')).catch(e => console.error(e))"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add better-sqlite3 dependency"
```

---

### Task 2: Create DatabaseManager (`src/lib/db.ts`)

**Files:**
- Create: `src/lib/db.ts`
- Create: `tests/lib/db.test.ts`

- [ ] **Step 1: Write tests for DatabaseManager**

```ts
// tests/lib/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { DatabaseManager } from '../../src/lib/db.js';
import Database from 'better-sqlite3';

const testDir = '/tmp/llm-gateway-test-db';

function setupTestDir() {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });
}

describe('DatabaseManager', () => {
  beforeEach(() => {
    setupTestDir();
    DatabaseManager.resetInstance();
  });

  afterEach(() => {
    try { DatabaseManager.getInstance(testDir).close(); } catch {}
    DatabaseManager.resetInstance();
  });

  it('should create singleton instance', () => {
    const db1 = DatabaseManager.getInstance(testDir);
    const db2 = DatabaseManager.getInstance(testDir);
    expect(db1).toBe(db2);
  });

  it('should create requests table with correct schema', () => {
    const dbManager = DatabaseManager.getInstance(testDir);
    dbManager.initialize();

    const db = dbManager.getDb();
    const tableInfo = db.prepare("PRAGMA table_info(requests)").all() as any[];
    const columnNames = tableInfo.map(c => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('request_id');
    expect(columnNames).toContain('timestamp');
    expect(columnNames).toContain('custom_model');
    expect(columnNames).toContain('real_model');
    expect(columnNames).toContain('provider');
    expect(columnNames).toContain('endpoint');
    expect(columnNames).toContain('status_code');
    expect(columnNames).toContain('duration_ms');
    expect(columnNames).toContain('is_streaming');
    expect(columnNames).toContain('prompt_tokens');
    expect(columnNames).toContain('completion_tokens');
    expect(columnNames).toContain('total_tokens');
    expect(columnNames).toContain('cached_tokens');
    expect(columnNames).toContain('user_name');
    expect(columnNames).toContain('model_group');
    expect(columnNames).toContain('actual_model');
    expect(columnNames).toContain('error_message');
    expect(columnNames).toContain('error_type');
    expect(columnNames).toContain('created_at');
  });

  it('should create indexes', () => {
    const dbManager = DatabaseManager.getInstance(testDir);
    dbManager.initialize();

    const db = dbManager.getDb();
    const indexes = db.prepare("PRAGMA index_list(requests)").all() as any[];
    const indexNames = indexes.map(i => i.name);

    expect(indexNames).toContain('idx_timestamp');
    expect(indexNames).toContain('idx_custom_model');
    expect(indexNames).toContain('idx_user_name');
    expect(indexNames).toContain('idx_created_at');
  });

  it('should set WAL mode and synchronous=NORMAL', () => {
    const dbManager = DatabaseManager.getInstance(testDir);
    dbManager.initialize();

    const db = dbManager.getDb();
    const journalMode = db.prepare('PRAGMA journal_mode').get() as any;
    const synchronous = db.prepare('PRAGMA synchronous').get() as any;

    expect(journalMode.mode).toBe('wal');
    expect(synchronous.synchronous).toBe(1); // NORMAL = 1
  });

  it('should close database', () => {
    const dbManager = DatabaseManager.getInstance(testDir);
    dbManager.initialize();
    dbManager.close();

    expect(() => dbManager.getDb()).toThrow();
  });

  it('should handle double initialize gracefully', () => {
    const dbManager = DatabaseManager.getInstance(testDir);
    dbManager.initialize();
    dbManager.initialize(); // should not throw
    expect(dbManager.getDb()).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm vitest run tests/lib/db.test.ts
```

Expected: FAIL — `db.js` module not found

- [ ] **Step 3: Implement DatabaseManager**

```ts
// src/lib/db.ts
import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private db: Database.Database | null = null;
  private configDir: string;

  private constructor(configDir: string) {
    this.configDir = configDir;
  }

  static getInstance(configDir: string): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager(configDir);
    }
    return DatabaseManager.instance;
  }

  static resetInstance(): void {
    if (DatabaseManager.instance) {
      DatabaseManager.instance.close();
      DatabaseManager.instance = null;
    }
  }

  initialize(): void {
    if (this.db) return; // already initialized

    const dbPath = join(this.configDir, 'gateway.db');

    // Ensure config directory exists
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }

    this.db = new Database(dbPath);

    // Configure for better concurrency and performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    // Create table and indexes
    this.db.exec(`
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
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_timestamp ON requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_custom_model ON requests(custom_model);
      CREATE INDEX IF NOT EXISTS idx_user_name ON requests(user_name);
      CREATE INDEX IF NOT EXISTS idx_created_at ON requests(created_at);
    `);
  }

  getDb(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm vitest run tests/lib/db.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts tests/lib/db.test.ts
git commit -m "feat: add DatabaseManager for SQLite initialization"
```

---

### Task 3: Create RequestLogger async queue (`src/lib/request-logger.ts`)

**Files:**
- Create: `src/lib/request-logger.ts`
- Create: `tests/lib/request-logger.test.ts`

- [ ] **Step 1: Write tests for RequestLogger**

```ts
// tests/lib/request-logger.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { DatabaseManager } from '../../src/lib/db.js';
import { RequestLogger } from '../../src/lib/request-logger.js';
import type { LogEntry } from '../../src/logger.js';

const testDir = '/tmp/llm-gateway-test-logger';

function setupTestDir() {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });
}

function createTestEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    requestId: `test-${Date.now()}-${Math.random()}`,
    customModel: 'gpt-4',
    endpoint: '/v1/chat/completions',
    method: 'POST',
    statusCode: 200,
    durationMs: 1500,
    isStreaming: false,
    ...overrides,
  };
}

describe('RequestLogger', () => {
  let dbManager: DatabaseManager;
  let requestLogger: RequestLogger;

  beforeEach(() => {
    setupTestDir();
    DatabaseManager.resetInstance();
    RequestLogger.resetInstance();

    dbManager = DatabaseManager.getInstance(testDir);
    dbManager.initialize();

    requestLogger = RequestLogger.getInstance(dbManager);
  });

  afterEach(() => {
    try { requestLogger.stop(); } catch {}
    try { dbManager.close(); } catch {}
    DatabaseManager.resetInstance();
    RequestLogger.resetInstance();
  });

  it('should create singleton instance', () => {
    const logger1 = RequestLogger.getInstance(dbManager);
    const logger2 = RequestLogger.getInstance(dbManager);
    expect(logger1).toBe(logger2);
  });

  it('should write log entry to database after flush', async () => {
    requestLogger.start();
    const entry = createTestEntry({ customModel: 'claude-3' });
    requestLogger.log(entry);

    // Wait for async flush (100ms interval + buffer)
    await new Promise(resolve => setTimeout(resolve, 200));

    const db = dbManager.getDb();
    const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get(entry.requestId) as any;
    expect(row).toBeDefined();
    expect(row.custom_model).toBe('claude-3');
    expect(row.status_code).toBe(200);
  });

  it('should handle duplicate request_id (INSERT OR IGNORE)', async () => {
    requestLogger.start();
    const entry = createTestEntry({ requestId: 'dup-123' });
    requestLogger.log(entry);
    requestLogger.log(entry); // duplicate

    await new Promise(resolve => setTimeout(resolve, 200));

    const db = dbManager.getDb();
    const count = db.prepare('SELECT COUNT(*) as c FROM requests WHERE request_id = ?').get('dup-123') as any;
    expect(count.c).toBe(1);
  });

  it('should flush remaining entries on stop', async () => {
    // Don't start the interval - just queue entries
    const entry = createTestEntry();
    requestLogger.log(entry);

    // Stop should flush the queue
    requestLogger.stop();

    const db = dbManager.getDb();
    const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get(entry.requestId) as any;
    expect(row).toBeDefined();
  });

  it('should handle many entries', async () => {
    requestLogger.start();

    const entries: LogEntry[] = [];
    for (let i = 0; i < 50; i++) {
      const entry = createTestEntry({ customModel: `model-${i}` });
      entries.push(entry);
      requestLogger.log(entry);
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    const db = dbManager.getDb();
    const count = db.prepare('SELECT COUNT(*) as c FROM requests').get() as any;
    expect(count.c).toBe(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm vitest run tests/lib/request-logger.test.ts
```

Expected: FAIL — `request-logger.js` module not found

- [ ] **Step 3: Implement RequestLogger**

```ts
// src/lib/request-logger.ts
import type { DatabaseManager } from './db.js';
import type { LogEntry } from '../logger.js';
import Database from 'better-sqlite3';

const FLUSH_INTERVAL_MS = 100;
const MAX_QUEUE_SIZE = 500;

export class RequestLogger {
  private static instance: RequestLogger | null = null;
  private dbManager: DatabaseManager;
  private queue: LogEntry[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  static getInstance(dbManager: DatabaseManager): RequestLogger {
    if (!RequestLogger.instance) {
      RequestLogger.instance = new RequestLogger(dbManager);
    }
    return RequestLogger.instance;
  }

  static resetInstance(): void {
    if (RequestLogger.instance) {
      RequestLogger.instance.stop();
      RequestLogger.instance = null;
    }
  }

  start(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.flushQueue();
    }, FLUSH_INTERVAL_MS);
  }

  log(entry: LogEntry): void {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      // Queue full — drop oldest and warn
      this.queue.shift();
      console.warn(`[RequestLogger] 队列已满 (${MAX_QUEUE_SIZE}), 丢弃最旧的日志条目`);
    }
    this.queue.push(entry);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // Flush remaining entries synchronously
    this.flushQueue();
  }

  private flushQueue(): void {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);
    this.writeBatch(batch);
  }

  private writeBatch(entries: LogEntry[]): void {
    const db = this.dbManager.getDb();

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO requests (
        request_id, timestamp, custom_model, real_model, provider,
        endpoint, status_code, duration_ms, is_streaming,
        prompt_tokens, completion_tokens, total_tokens, cached_tokens,
        user_name, model_group, actual_model, error_message, error_type,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((batch: LogEntry[]) => {
      for (const entry of batch) {
        stmt.run(
          entry.requestId,
          entry.timestamp,
          entry.customModel,
          entry.realModel,
          entry.provider,
          entry.endpoint,
          entry.statusCode,
          entry.durationMs,
          entry.isStreaming ? 1 : 0,
          entry.promptTokens ?? null,
          entry.completionTokens ?? null,
          entry.totalTokens ?? null,
          entry.cachedTokens ?? null,
          entry.userName ?? null,
          entry.modelGroup ?? null,
          entry.actualModel ?? null,
          entry.error?.message ?? null,
          entry.error?.type ?? null,
          Date.now()
        );
      }
    });

    try {
      insertMany(entries);
    } catch (err: any) {
      console.error(`[RequestLogger] 批量写入失败: ${err.message}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm vitest run tests/lib/request-logger.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/request-logger.ts tests/lib/request-logger.test.ts
git commit -m "feat: add RequestLogger async batch-write queue"
```

---

### Task 4: Integrate into server.ts

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Modify server.ts to initialize DB and RequestLogger**

Read `src/server.ts` first. Then make these changes:

**Add imports at top:**
```ts
import { DatabaseManager } from './lib/db.js';
import { RequestLogger } from './lib/request-logger.js';
```

**After `const logDir = pathJoin(logger.getFilePath(), '..');` add:**
```ts
  // Initialize SQLite database
  const configDir = pathJoin(logDir, '..'); // ~/.llm-gateway/
  const dbManager = DatabaseManager.getInstance(configDir);
  dbManager.initialize();

  // Initialize async request logger
  const requestLogger = RequestLogger.getInstance(dbManager);
  requestLogger.start();
```

**Replace SIGINT/SIGTERM handlers to also clean up DB:**
```ts
  // Ensure process exits cleanly (only register once)
  if (!hasSetupSignalHandlers) {
    hasSetupSignalHandlers = true;
    process.on('SIGINT', () => {
      if (cleanupInterval) clearInterval(cleanupInterval);
      requestLogger.stop();
      dbManager.close();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      if (cleanupInterval) clearInterval(cleanupInterval);
      requestLogger.stop();
      dbManager.close();
      process.exit(0);
    });
  }
```

**Make `requestLogger` available to route factories.** The handler factories currently receive `(config, logger, detailLogger, timeoutMs, logDir)`. We need to pass `requestLogger` too.

Update the two route registrations:

```ts
  // 聊天完成路由
  app.route('', createChatCompletionsRoute(
    () => currentConfig,
    logger,
    detailLogger,
    timeoutMs,
    logDir,
    requestLogger
  ));

  // 消息路由
  app.route('', createMessagesRoute(
    () => currentConfig,
    logger,
    detailLogger,
    timeoutMs,
    logDir,
    requestLogger
  ));
```

- [ ] **Step 2: Verify build compiles**

Run:
```bash
pnpm build
```

Expected: Compiles without errors (handler signature changes will cause type errors in route files — that's expected, will fix in next tasks)

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: integrate SQLite DB and RequestLogger into server startup/shutdown"
```

---

### Task 5: Update chat-completions handler to use RequestLogger

**Files:**
- Modify: `src/routes/chat-completions/index.ts`
- Modify: `src/routes/chat-completions/handler.ts`

- [ ] **Step 1: Update handler signature and factory**

Read `src/routes/chat-completions/index.ts` first.

**In `index.ts`, update the factory to accept and pass `requestLogger`:**

```ts
// Find the export function and add requestLogger parameter
import type { RequestLogger } from '../../lib/request-logger.js';

export function createChatCompletionsRoute(
  config: ProxyConfig | (() => ProxyConfig),
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number,
  logDir: string,
  requestLogger: RequestLogger
) {
  // ... pass requestLogger to handler
}
```

**In `handler.ts`, update the factory signature:**

```ts
import type { RequestLogger } from '../../lib/request-logger.js';

export function createChatCompletionsHandler(
  config: ProxyConfig | (() => ProxyConfig),
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number,
  logDir: string,
  requestLogger: RequestLogger
): (c: any, endpoint: string) => Promise<Response> {
  // ...
```

- [ ] **Step 2: Add `requestLogger.log()` calls alongside existing `logger.log()` calls**

Find every `logger.log(logEntry)` call in the handler and add `requestLogger.log(logEntry)` right after it. There are multiple locations:

**Location 1 — Model not found error (~line 117):**
```ts
logger.log({ ... });
requestLogger.log({ ... }); // add same entry
```

**Location 2 — Non-stream response success (~line 185):**
```ts
logger.log(result.logEntry);
requestLogger.log(result.logEntry); // add same entry
```

**Location 3 — After non-stream response (~line 195):**
```ts
logger.log(logEntry);
requestLogger.log(logEntry); // add same entry
```

**Location 4 — Error handler (~line 215):**
```ts
logger.log({ ... });
requestLogger.log({ ... }); // add same entry
```

Note: The stream handler (`handleStream`) also calls `logger.log`. We'll handle that in the stream handler file.

- [ ] **Step 3: Verify build**

Run:
```bash
pnpm build
```

Expected: Compiles (may have errors in messages handler — will fix in next task)

- [ ] **Step 4: Commit**

```bash
git add src/routes/chat-completions/index.ts src/routes/chat-completions/handler.ts
git commit -m "feat: add RequestLogger to chat-completions handler"
```

---

### Task 6: Update messages handler to use RequestLogger

**Files:**
- Modify: `src/routes/messages/index.ts`
- Modify: `src/routes/messages/handler.ts`

- [ ] **Step 1: Same pattern as Task 5**

Read `src/routes/messages/index.ts` and `src/routes/messages/handler.ts`.

Update both files following the same pattern:
1. Add `RequestLogger` import
2. Add `requestLogger` parameter to factory functions
3. Add `requestLogger.log(entry)` after every `logger.log(entry)` call

- [ ] **Step 2: Update stream handler for messages if separate**

If the messages handler has its own stream handling, add `requestLogger.log()` there too.

- [ ] **Step 3: Verify build**

Run:
```bash
pnpm build
```

Expected: Full compilation succeeds

- [ ] **Step 4: Commit**

```bash
git add src/routes/messages/index.ts src/routes/messages/handler.ts
git commit -m "feat: add RequestLogger to messages handler"
```

---

### Task 7: Update chat-completions stream handler

**Files:**
- Modify: `src/routes/chat-completions/stream-handler.ts`

- [ ] **Step 1: Read and update stream handler**

Read `src/routes/chat-completions/stream-handler.ts`.

The stream handler receives a `logEntry` object and calls `logger.log()` at the end of the stream. 

Add `requestLogger` to the options passed to `handleStream` from the handler, and add `requestLogger.log()` at the same points where `logger.log()` is called.

**In `handler.ts`, update the `handleStream` call:**
```ts
return handleStream({
  response, provider, model, actualModel: actualModel || model,
  requestId, startTime, logEntry, rateLimiter, logger, detailLogger, c,
  privacySettings: currentConfig.privacySettings,
  requestLogger  // add this
});
```

**In `stream-handler.ts`, update the function signature and add `requestLogger.log()` calls.**

- [ ] **Step 2: Verify build**

Run:
```bash
pnpm build
```

Expected: Compiles without errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/chat-completions/stream-handler.ts src/routes/chat-completions/handler.ts
git commit -m "feat: add RequestLogger to stream handler"
```

---

### Task 8: Remove log file writing from Logger (keep app logging only)

**Files:**
- Modify: `src/logger.ts`
- Read first: `tests/logger.test.ts`

- [ ] **Step 1: Read logger.ts and understand current implementation**

The current `Logger.log()` writes JSON lines to `proxy-YYYY-MM-DD.log`. We need to **stop writing request logs** but **keep the file for application-level logs** (startup messages, errors, etc.).

The simplest approach: The `Logger` class will no longer be called for request entries (since we use `RequestLogger` now). The `Logger` class itself can remain for application logs, but we'll delete the `log()` method's request-writing behavior.

**Actually — better approach:** Keep `Logger.log()` as-is for now since it's also used for application logs. The request entries are now written via `RequestLogger` (double-write). After we verify everything works, we'll remove the `logger.log()` calls from handlers (Task 11).

**For this task, just remove the JSON-lines file creation logic.**

Read `src/logger.ts`:

```ts
// src/logger.ts — current implementation
```

The Logger constructor creates the log dir and file path. The `log()` method appends JSON lines.

**Change:** Keep the `Logger` class but modify `log()` to only write to stdout/console (for app logs), not to the proxy log file. We no longer need `proxy-YYYY-MM-DD.log`.

Actually, reviewing the code more carefully — `Logger.log()` is only called for request entries. Application logs use `console.log()`. So we can simply **remove the `Logger.log()` calls from handlers** and eventually delete the file.

For now, **no changes to `logger.ts`** — we'll stop calling it for requests in Task 11.

- [ ] **Step 1 (actual): No changes needed for this task**

The Logger class stays as-is. Request logging now goes through RequestLogger. After verification, we remove `logger.log()` calls from handlers.

- [ ] **Step 2: Commit (no-op, or skip this task)**

This task is a no-op. Move to Task 9.

---

### Task 9: Rewrite stats-core.ts to use SQLite

**Files:**
- Modify: `src/lib/stats-core.ts`
- Read first: `src/lib/types/stats.ts`, `tests/lib/stats-core.test.ts`

- [ ] **Step 1: Read current stats-core.ts and tests**

Understand the exported functions:
- `loadStats(logDir, options): Stats` — main entry
- `parseLogFile(filePath): StatsEntry[]`
- `getLogFilesForRange(logDir, options): string[]`
- `calculateStats(entries, options): Stats`
- `getTodayLogFiles(logDir): string[]`
- `getDateLogFiles(logDir, date): string[]`
- `getWeekRange(weekStr): {start, end}`
- `getMonthRange(monthStr): {start, end}`

- [ ] **Step 2: Rewrite stats-core.ts**

Keep utility functions and types. Replace log-file functions with SQLite versions:

```ts
// src/lib/stats-core.ts
import Database from 'better-sqlite3';
import type { StatsEntry, ModelStats, Stats, StatsOptions } from './types/stats.js';
import { getTodayDate, getWeekStart, getMonthStart, getPeriodRange } from './period-utils.js';

// Re-export types
export type { StatsEntry, ModelStats, Stats, StatsOptions };

/**
 * Load stats from SQLite database
 */
export function loadStats(db: Database.Database, options: StatsOptions = {}): Stats {
  const { start, end } = getPeriodRange(
    options.date || getTodayDate(),
    options.week ? 'week' : options.month ? 'month' : 'day'
  );

  const userNameFilter = options.userName ? 'AND user_name = ?' : '';
  const params = options.userName ? [start, end, options.userName] : [start, end];

  const rows = db.prepare(`
    SELECT 
      custom_model,
      provider,
      COUNT(*) as requests,
      SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as failed,
      COALESCE(SUM(prompt_tokens), 0) as inputTokens,
      COALESCE(SUM(completion_tokens), 0) as outputTokens,
      COALESCE(SUM(total_tokens), 0) as totalTokens,
      COALESCE(SUM(cached_tokens), 0) as cachedTokens
    FROM requests
    WHERE timestamp >= ? AND timestamp <= ? ${userNameFilter}
    GROUP BY custom_model, provider
  `).all(...params) as any[];

  const stats: Stats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    byModel: {},
    byProvider: {},
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalCachedTokens: 0
  };

  for (const row of rows) {
    const modelStats: ModelStats = {
      requests: row.requests,
      successful: row.successful,
      failed: row.failed,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      cachedTokens: row.cachedTokens
    };

    stats.byModel[row.custom_model] = modelStats;
    stats.totalRequests += modelStats.requests;
    stats.successfulRequests += modelStats.successful;
    stats.failedRequests += modelStats.failed;
    stats.totalInputTokens += modelStats.inputTokens;
    stats.totalOutputTokens += modelStats.outputTokens;
    stats.totalTokens += modelStats.totalTokens;
    stats.totalCachedTokens += modelStats.cachedTokens;

    // By provider
    if (row.provider) {
      if (!stats.byProvider[row.provider]) {
        stats.byProvider[row.provider] = {
          requests: 0, successful: 0, failed: 0,
          inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0
        };
      }
      stats.byProvider[row.provider].requests += modelStats.requests;
      stats.byProvider[row.provider].successful += modelStats.successful;
      stats.byProvider[row.provider].failed += modelStats.failed;
      stats.byProvider[row.provider].inputTokens += modelStats.inputTokens;
      stats.byProvider[row.provider].outputTokens += modelStats.outputTokens;
      stats.byProvider[row.provider].totalTokens += modelStats.totalTokens;
      stats.byProvider[row.provider].cachedTokens += modelStats.cachedTokens;
    }
  }

  return stats;
}

/**
 * Get hourly breakdown for a date range
 */
export function getHourlyBreakdown(db: Database.Database, options: StatsOptions): Array<{ hour: string; stats: ModelStats }> {
  const { start, end } = getPeriodRange(
    options.date || getTodayDate(),
    'day'
  );

  const userNameFilter = options.userName ? 'AND user_name = ?' : '';
  const params = options.userName ? [start, end, options.userName] : [start, end];

  const rows = db.prepare(`
    SELECT 
      substr(timestamp, 1, 13) as hour,
      COUNT(*) as requests,
      SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as failed,
      COALESCE(SUM(prompt_tokens), 0) as inputTokens,
      COALESCE(SUM(completion_tokens), 0) as outputTokens,
      COALESCE(SUM(total_tokens), 0) as totalTokens,
      COALESCE(SUM(cached_tokens), 0) as cachedTokens
    FROM requests
    WHERE timestamp >= ? AND timestamp <= ? ${userNameFilter}
    GROUP BY hour
    ORDER BY hour
  `).all(...params) as any[];

  return rows.map(row => ({
    hour: row.hour + ':00',
    stats: {
      requests: row.requests,
      successful: row.successful,
      failed: row.failed,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      cachedTokens: row.cachedTokens
    }
  }));
}

// Keep these utilities (still used by period calculations)
export { getWeekStart, getMonthStart, getPeriodRange } from './period-utils.js';

// Export helpers needed by StatsProvider
export function createEmptyModelStats(): ModelStats {
  return {
    requests: 0, successful: 0, failed: 0,
    inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0
  };
}

export function addEntryToStats(modelStats: ModelStats, entry: StatsEntry): void {
  modelStats.requests += 1;
  if (entry.statusCode >= 200 && entry.statusCode < 300) modelStats.successful += 1;
  if (entry.statusCode >= 400) modelStats.failed += 1;
  if (entry.promptTokens) modelStats.inputTokens += entry.promptTokens;
  if (entry.completionTokens) modelStats.outputTokens += entry.completionTokens;
  if (entry.totalTokens) modelStats.totalTokens += entry.totalTokens;
  if (entry.cachedTokens) modelStats.cachedTokens += entry.cachedTokens;
}
```

**Key changes:**
- `loadStats` now takes `Database` instead of `logDir`
- Removed: `parseLogFile`, `getLogFilesForRange`, `getTodayLogFiles`, `getDateLogFiles`, `getWeekRange`, `getMonthRange` (these are now in period-utils or not needed)

- [ ] **Step 3: Update tests for stats-core**

Read `tests/lib/stats-core.test.ts`. The tests currently test log file parsing. Rewrite them to test SQLite queries:

```ts
// tests/lib/stats-core.test.ts (rewrite)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import Database from 'better-sqlite3';
import { loadStats, getHourlyBreakdown } from '../../src/lib/stats-core.js';
import type { StatsOptions } from '../../src/lib/types/stats.js';

const testDir = '/tmp/llm-gateway-test-stats-core';

function setupDb(): Database.Database {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });

  const db = new Database(`${testDir}/test.db`);
  db.exec(`
    CREATE TABLE requests (
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
    )
  `);
  db.exec(`
    CREATE INDEX idx_timestamp ON requests(timestamp);
    CREATE INDEX idx_custom_model ON requests(custom_model);
    CREATE INDEX idx_user_name ON requests(user_name);
  `);
  return db;
}

function insertEntry(db: Database.Database, entry: any) {
  db.prepare(`
    INSERT INTO requests (request_id, timestamp, custom_model, provider, status_code, prompt_tokens, completion_tokens, total_tokens, cached_tokens, user_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.requestId || `req-${Date.now()}-${Math.random()}`,
    entry.timestamp,
    entry.customModel,
    entry.provider,
    entry.statusCode,
    entry.promptTokens || 0,
    entry.completionTokens || 0,
    entry.totalTokens || 0,
    entry.cachedTokens || 0,
    entry.userName || null,
    Date.now()
  );
}

describe('stats-core with SQLite', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true });
  });

  it('should return empty stats when no data', () => {
    const stats = loadStats(db);
    expect(stats.totalRequests).toBe(0);
    expect(stats.successfulRequests).toBe(0);
    expect(stats.failedRequests).toBe(0);
    expect(Object.keys(stats.byModel)).toEqual([]);
  });

  it('should aggregate stats by model', () => {
    const today = new Date().toISOString().split('T')[0];
    
    insertEntry(db, {
      timestamp: `${today}T10:00:00Z`,
      customModel: 'gpt-4',
      provider: 'openai',
      statusCode: 200,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    insertEntry(db, {
      timestamp: `${today}T11:00:00Z`,
      customModel: 'gpt-4',
      provider: 'openai',
      statusCode: 200,
      promptTokens: 200,
      completionTokens: 100,
      totalTokens: 300,
    });
    insertEntry(db, {
      timestamp: `${today}T12:00:00Z`,
      customModel: 'claude-3',
      provider: 'anthropic',
      statusCode: 200,
      promptTokens: 300,
      completionTokens: 150,
      totalTokens: 450,
    });

    const stats = loadStats(db);

    expect(stats.totalRequests).toBe(3);
    expect(stats.successfulRequests).toBe(3);
    expect(stats.byModel['gpt-4'].requests).toBe(2);
    expect(stats.byModel['gpt-4'].inputTokens).toBe(300);
    expect(stats.byModel['claude-3'].requests).toBe(1);
    expect(stats.byModel['claude-3'].inputTokens).toBe(300);
  });

  it('should count failed requests (status >= 400)', () => {
    const today = new Date().toISOString().split('T')[0];
    
    insertEntry(db, {
      timestamp: `${today}T10:00:00Z`,
      customModel: 'gpt-4',
      statusCode: 200,
      promptTokens: 100, completionTokens: 50, totalTokens: 150,
    });
    insertEntry(db, {
      timestamp: `${today}T11:00:00Z`,
      customModel: 'gpt-4',
      statusCode: 500,
      promptTokens: 0, completionTokens: 0, totalTokens: 0,
    });

    const stats = loadStats(db);

    expect(stats.totalRequests).toBe(2);
    expect(stats.successfulRequests).toBe(1);
    expect(stats.failedRequests).toBe(1);
  });

  it('should filter by userName', () => {
    const today = new Date().toISOString().split('T')[0];
    
    insertEntry(db, {
      timestamp: `${today}T10:00:00Z`,
      customModel: 'gpt-4',
      statusCode: 200,
      promptTokens: 100, completionTokens: 50, totalTokens: 150,
      userName: 'alice',
    });
    insertEntry(db, {
      timestamp: `${today}T11:00:00Z`,
      customModel: 'gpt-4',
      statusCode: 200,
      promptTokens: 200, completionTokens: 100, totalTokens: 300,
      userName: 'bob',
    });

    const stats = loadStats(db, { userName: 'alice' });

    expect(stats.totalRequests).toBe(1);
    expect(stats.totalInputTokens).toBe(100);
  });

  it('should get hourly breakdown', () => {
    const today = new Date().toISOString().split('T')[0];
    
    insertEntry(db, {
      timestamp: `${today}T10:15:00Z`,
      customModel: 'gpt-4',
      statusCode: 200,
      promptTokens: 100, completionTokens: 50, totalTokens: 150,
    });
    insertEntry(db, {
      timestamp: `${today}T10:45:00Z`,
      customModel: 'gpt-4',
      statusCode: 200,
      promptTokens: 200, completionTokens: 100, totalTokens: 300,
    });
    insertEntry(db, {
      timestamp: `${today}T11:30:00Z`,
      customModel: 'gpt-4',
      statusCode: 200,
      promptTokens: 300, completionTokens: 150, totalTokens: 450,
    });

    const hourly = getHourlyBreakdown(db);

    expect(hourly.length).toBe(2);
    expect(hourly[0].stats.requests).toBe(2);
    expect(hourly[1].stats.requests).toBe(1);
  });
});
```

- [ ] **Step 4: Run tests**

Run:
```bash
pnpm vitest run tests/lib/stats-core.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats-core.ts tests/lib/stats-core.test.ts
git commit -m "refactor: rewrite stats-core to use SQLite instead of log files"
```

---

### Task 10: Rewrite StatsProvider to use SQLite

**Files:**
- Modify: `src/lib/stats-provider.ts`

- [ ] **Step 1: Rewrite StatsProvider**

Current StatsProvider uses `UsageTracker` memory counters + log file fallback. Rewrite to use SQLite directly:

```ts
// src/lib/stats-provider.ts
import { UsageTracker } from './usage-tracker.js';
import { loadStats, getHourlyBreakdown, createEmptyModelStats, addEntryToStats } from './stats-core.js';
import type { Pricing } from './cost-calculator.js';
import type { Stats, StatsOptions, ModelStats } from './types/stats.js';
import type { DatabaseManager } from './db.js';

export class StatsProvider {
  private dbManager: DatabaseManager;
  private tracker: UsageTracker;

  constructor(dbManager: DatabaseManager, tracker: UsageTracker) {
    this.dbManager = dbManager;
    this.tracker = tracker;
  }

  /**
   * Get stats from SQLite
   */
  async getStats(options: StatsOptions = {}): Promise<Stats> {
    const db = this.dbManager.getDb();
    return loadStats(db, options);
  }

  /**
   * Get hourly breakdown
   */
  async getHourlyStats(options: StatsOptions = {}): Promise<Array<{ hour: string; stats: ModelStats }>> {
    const db = this.dbManager.getDb();
    return getHourlyBreakdown(db, { ...options, byHour: true });
  }

  /**
   * Preload counters (for rate limiter warm-up)
   * Now a no-op since stats come directly from DB
   */
  async ensureCountersLoaded(_models: string[], _pricing?: Pricing): Promise<void> {
    // No-op — stats are read directly from SQLite
  }

  /**
   * Cleanup — no-op
   */
  cleanup(): void {
    this.tracker.cleanupSlidingWindows();
  }

  /**
   * Get logDir for backward compatibility (returns empty string now)
   */
  getLogDir(): string {
    return '';
  }
}
```

- [ ] **Step 2: Update server.ts to pass DatabaseManager to StatsProvider**

In `src/server.ts`, find:
```ts
const statsProvider = new StatsProvider(usageTracker, logDir);
```

Change to:
```ts
const statsProvider = new StatsProvider(dbManager, usageTracker);
```

- [ ] **Step 3: Update stats-api.ts to handle new getStats signature**

Read `src/admin/routes/stats-api.ts`. The `loadStats` fallback call currently imports from stats-core and passes `logDir`. Update it:

```ts
// In stats-api.ts, replace the fallback:
// OLD:
// const { loadStats } = await import('../../lib/stats-core.js');
// stats = loadStats(actualLogDir, options);

// NEW — get StatsProvider's dbManager reference, or import DatabaseManager
import { DatabaseManager } from '../../lib/db.js';

// In the API handler, when statsProvider is not available:
const dbManager = DatabaseManager.getInstance(actualLogDir); // or get from a global
const db = dbManager.getDb();
const { loadStats } = await import('../../lib/stats-core.js');
stats = loadStats(db, options);
```

Actually, the cleaner approach: the stats-api always uses the global StatsProvider. If not initialized, create one lazily.

**Simpler approach:** Since server.ts always initializes StatsProvider before routes are hit, just use the global:

```ts
// In stats-api.ts
import { getStatsProvider } from '../../lib/stats-provider.js';
// ... already imported

// Replace the fallback section:
let stats;
if (statsProvider && !forceReload) {
  stats = await statsProvider.getStats(options);
} else if (statsProvider) {
  stats = await statsProvider.getStats(options); // forceReload still reads from DB
} else {
  // Should never happen in normal operation
  return c.json({ success: false, error: 'StatsProvider not initialized' }, 500);
}
```

- [ ] **Step 4: Verify build**

Run:
```bash
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats-provider.ts src/server.ts src/admin/routes/stats-api.ts
git commit -m "refactor: rewrite StatsProvider to use SQLite directly"
```

---

### Task 11: Remove logger.log() calls from handlers (deduplicate)

**Files:**
- Modify: `src/routes/chat-completions/handler.ts`
- Modify: `src/routes/chat-completions/stream-handler.ts`
- Modify: `src/routes/messages/handler.ts`

- [ ] **Step 1: Remove all `logger.log()` calls from handlers**

Since `requestLogger.log()` is already called alongside `logger.log()`, now remove the `logger.log()` calls. This means request data is only written to SQLite, not to JSON log files.

In `handler.ts`, find every `logger.log(...)` and remove it. The `Logger` instance is still passed to the handler for backward compatibility — we can remove it from the signature in a future cleanup.

**Also update `stream-handler.ts`** to remove `logger.log()` calls.

**Also update `messages/handler.ts`** similarly.

- [ ] **Step 2: Remove `logger` parameter from handler signatures (optional, cleanup)**

If desired, remove the `logger: Logger` parameter from handler factories since it's no longer used. This requires updating `server.ts` too.

**Actually — check if logger is used for anything else** (like console output). If `Logger.log()` only writes to files and we're removing that, then the logger parameter can be fully removed from handlers.

Read both handler files carefully. If `logger` is only used for `log()` calls, remove it entirely.

- [ ] **Step 3: Update server.ts to not pass logger to handlers**

```ts
  // 聊天完成路由
  app.route('', createChatCompletionsRoute(
    () => currentConfig,
    detailLogger,
    timeoutMs,
    logDir,
    requestLogger
  ));

  // 消息路由
  app.route('', createMessagesRoute(
    () => currentConfig,
    detailLogger,
    timeoutMs,
    logDir,
    requestLogger
  ));
```

- [ ] **Step 4: Verify build**

Run:
```bash
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/chat-completions/handler.ts src/routes/chat-completions/stream-handler.ts src/routes/messages/handler.ts src/server.ts
git commit -m "refactor: remove logger.log() calls from request handlers"
```

---

### Task 12: Rewrite UsageTracker to initialize from SQLite

**Files:**
- Modify: `src/lib/usage-tracker.ts`

- [ ] **Step 1: Read usage-tracker.ts**

The UsageTracker currently loads counters from log files on demand (`ensureLoaded` → `loadFromLogs` → parse JSON files).

Change `loadFromLogs` to read from SQLite instead.

**Keep:**
- Singleton pattern (`getInstance`, `resetInstance`)
- Counter data structures (`ModelUsageCounter`, `today`, `thisWeek`, `thisMonth`, `slidingWindows`)
- `recordUsage()` — in-memory update after successful requests
- `getCurrentUsage()` — read for rate limiting
- `cleanupSlidingWindows()` — expire old entries

**Change:**
- `loadFromLogs` → `loadFromDB(db)` — SQL query instead of file parsing

- [ ] **Step 2: Update UsageTracker**

Add `DatabaseManager` as a dependency:

```ts
// In UsageTracker class, add dbManager field
import type { DatabaseManager } from './db.js';

export class UsageTracker {
  private static instance: UsageTracker | null = null;
  private logDir: string;
  private dbManager: DatabaseManager | null = null;
  private counters: Map<string, ModelUsageCounter> = new Map();

  private constructor(logDir: string) {
    this.logDir = logDir;
  }

  static getInstance(logDir: string, dbManager?: DatabaseManager): UsageTracker {
    if (!UsageTracker.instance) {
      UsageTracker.instance = new UsageTracker(logDir);
    }
    if (dbManager) {
      UsageTracker.instance.dbManager = dbManager;
    }
    return UsageTracker.instance;
  }

  // ...
```

**Replace `loadFromLogs` method:**

```ts
private async loadFromDB(period: 'day' | 'week' | 'month', counter: ModelUsageCounter): Promise<void> {
  if (!this.dbManager) {
    // Fallback: mark as not loaded (rate limiter will use 0)
    return;
  }

  const db = this.dbManager.getDb();
  const { start, end } = getPeriodRange(
    period === 'day' ? getTodayDate() : period === 'week' ? getWeekStart() : getMonthStart(),
    period
  );

  const rows = db.prepare(`
    SELECT 
      custom_model,
      COUNT(*) as requests,
      COALESCE(SUM(prompt_tokens), 0) as inputTokens
    FROM requests
    WHERE timestamp >= ? AND timestamp <= ? AND custom_model = ?
      AND status_code >= 200 AND status_code < 300
    GROUP BY custom_model
  `).all(start, end, counter.model) as any[];

  if (rows.length > 0) {
    const row = rows[0];
    if (period === 'day') {
      counter.today.requests = row.requests;
      counter.today.inputTokens = row.inputTokens;
      counter.today.loaded = true;
    } else if (period === 'week') {
      counter.thisWeek.requests = row.requests;
      counter.thisWeek.inputTokens = row.inputTokens;
      counter.thisWeek.loaded = true;
    } else {
      counter.thisMonth.requests = row.requests;
      counter.thisMonth.inputTokens = row.inputTokens;
      counter.thisMonth.loaded = true;
    }
  }
}
```

**Update `ensureLoaded` to call `loadFromDB` instead of file-based loading.**

- [ ] **Step 3: Update server.ts to pass dbManager to UsageTracker**

In `src/server.ts`:
```ts
// OLD:
const usageTracker = UsageTracker.getInstance(logDir);

// NEW:
const usageTracker = UsageTracker.getInstance(logDir, dbManager);
```

- [ ] **Step 4: Update tests**

Read `tests/lib/usage-tracker.test.ts` and `tests/lib/usage-tracker-singleton.test.ts`.

Update tests to pass a `DatabaseManager` instance, and set up test DB with sample data.

For existing tests that test in-memory counter behavior, they should still pass — the counter update logic hasn't changed.

For tests that test loading from logs, update them to insert data into SQLite instead.

- [ ] **Step 5: Run tests**

Run:
```bash
pnpm vitest run tests/lib/usage-tracker.test.ts tests/lib/usage-tracker-singleton.test.ts tests/lib/rate-limiter.test.ts
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/usage-tracker.ts src/server.ts tests/lib/usage-tracker.test.ts tests/lib/usage-tracker-singleton.test.ts
git commit -m "refactor: update UsageTracker to initialize counters from SQLite"
```

---

### Task 13: Update remaining log-file references and clean up

**Files:**
- Modify: `src/lib/stats-provider.ts` (getLogFilesForRange, parseLogFile methods)
- Modify: `src/lib/usage-tracker.ts` (getLogFilesForRange, parseLogFile methods)
- Read: `src/lib/paths.ts`

- [ ] **Step 1: Remove log-file parsing methods from StatsProvider**

StatsProvider still has private methods: `parseLogFile`, `getTodayLogFiles`, `getLogFilesForRange`, `getDateLogFiles`, `getWeekRange`, `getMonthRange`. These are now dead code. Remove them.

- [ ] **Step 2: Remove log-file parsing methods from UsageTracker**

UsageTracker similarly has `getLogFilesForRange` and `parseLogFile`. Remove them.

- [ ] **Step 3: Run full test suite**

Run:
```bash
pnpm test
```

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/stats-provider.ts src/lib/usage-tracker.ts
git commit -m "refactor: remove dead log-file parsing code from StatsProvider and UsageTracker"
```

---

### Task 14: Update tests and verify end-to-end

**Files:**
- Modify: `tests/setup.ts`
- Create: `tests/integration/sqlite-logging.test.ts` (optional e2e test)

- [ ] **Step 1: Update tests/setup.ts**

Read `tests/setup.ts`. Currently it resets `UsageTracker` singleton. Add resets for `DatabaseManager` and `RequestLogger`:

```ts
// Add imports
import { DatabaseManager } from '../src/lib/db.js';
import { RequestLogger } from '../src/lib/request-logger.js';

// In beforeEach/afterEach:
DatabaseManager.resetInstance();
RequestLogger.resetInstance();
```

- [ ] **Step 2: Create integration test**

```ts
// tests/integration/sqlite-logging.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import { DatabaseManager } from '../../src/lib/db.js';
import { RequestLogger } from '../../src/lib/request-logger.js';

const testDir = '/tmp/llm-gateway-test-integration';

describe('SQLite request logging integration', () => {
  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });
    DatabaseManager.resetInstance();
    RequestLogger.resetInstance();
  });

  afterEach(() => {
    DatabaseManager.resetInstance();
    RequestLogger.resetInstance();
    rmSync(testDir, { recursive: true });
  });

  it('should record successful requests in SQLite', async () => {
    // This would require a more complex setup with mock providers
    // For now, test that DB and RequestLogger work together
    const dbManager = DatabaseManager.getInstance(testDir);
    dbManager.initialize();

    const requestLogger = RequestLogger.getInstance(dbManager);
    requestLogger.start();

    // Log a test entry
    requestLogger.log({
      timestamp: new Date().toISOString(),
      requestId: 'integration-test-1',
      customModel: 'gpt-4',
      endpoint: '/v1/chat/completions',
      method: 'POST',
      statusCode: 200,
      durationMs: 1000,
      isStreaming: false,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });

    // Wait for flush
    await new Promise(r => setTimeout(r, 200));

    const db = dbManager.getDb();
    const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get('integration-test-1') as any;
    expect(row).toBeDefined();
    expect(row.custom_model).toBe('gpt-4');

    requestLogger.stop();
  });
});
```

- [ ] **Step 3: Run full test suite**

Run:
```bash
pnpm test
```

Expected: All tests PASS

- [ ] **Step 4: Run build**

Run:
```bash
pnpm build
```

Expected: Compiles without errors

- [ ] **Step 5: Commit**

```bash
git add tests/setup.ts tests/integration/sqlite-logging.test.ts
git commit -m "test: add SQLite logging integration test and update test setup"
```

---

### Task 15: Final verification and cleanup

**Files:**
- All

- [ ] **Step 1: Run full test suite**

Run:
```bash
pnpm test
```

- [ ] **Step 2: Run build**

Run:
```bash
pnpm build
```

- [ ] **Step 3: Verify no references to old log file functions remain**

Run:
```bash
grep -r "parseLogFile\|getLogFilesForRange\|getTodayLogFiles\|getDateLogFiles" src/ --include="*.ts"
```

Expected: No results (or only in comments)

- [ ] **Step 4: Verify no JSON log files are written for requests**

The only remaining file writer should be `DetailLogger` (for `--debug` mode). The `Logger` class should no longer write request entries.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup for SQLite migration"
```
