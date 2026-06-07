# SQLite Request Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record authenticated user LLM request metadata (tokens, timing, status, API response usage) to SQLite via Drizzle ORM, with async batch-write queue and automatic migration.

**Architecture:** Drizzle ORM (with `better-sqlite3` driver) for schema and migration. `DatabaseManager` singleton initializes DB + runs migrations. `RequestLogger` singleton provides async batch-write queue (100ms flush). Handler adds `requestLogger.log()` calls alongside existing `logger.log()` (dual-write transition). 90-day cleanup via existing hourly timer. Anonymous requests skipped entirely.

**Tech Stack:** drizzle-orm, better-sqlite3, drizzle-kit (dev), existing Hono/TypeScript stack, vitest for testing.

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install better-sqlite3, drizzle-orm and their types**

```bash
pnpm add better-sqlite3 drizzle-orm && pnpm add -D @types/better-sqlite3 drizzle-kit
```

- [ ] **Step 2: Verify install**

```bash
node -e "import('better-sqlite3').then(() => console.log('OK')).catch(e => console.error(e))"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add better-sqlite3 and drizzle-orm dependencies"
```

---

### Task 2: Create Drizzle schema and config

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/lib/schema.ts`
- Create: `tests/lib/schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `tests/lib/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { requests } from '../../src/lib/schema.js';

describe('requests table schema', () => {
  it('should match the defined columns', () => {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    const drizzl = drizzle(db);

    drizzl.run(drizzl.schema?.createTable?.toString() ?? /* fallback */ `
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT UNIQUE NOT NULL,
        timestamp TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        user_name TEXT,
        custom_model TEXT,
        real_model TEXT,
        provider TEXT,
        model_group TEXT,
        actual_model TEXT,
        endpoint TEXT,
        status_code INTEGER,
        duration_ms INTEGER,
        is_streaming INTEGER,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        cached_tokens INTEGER,
        error_message TEXT,
        error_type TEXT,
        response_metadata TEXT
      )
    `);

    const tableInfo = db.prepare('PRAGMA table_info(requests)').all() as any[];
    const columnNames = tableInfo.map(c => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('request_id');
    expect(columnNames).toContain('timestamp');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('user_name');
    expect(columnNames).toContain('custom_model');
    expect(columnNames).toContain('real_model');
    expect(columnNames).toContain('provider');
    expect(columnNames).toContain('model_group');
    expect(columnNames).toContain('actual_model');
    expect(columnNames).toContain('endpoint');
    expect(columnNames).toContain('status_code');
    expect(columnNames).toContain('duration_ms');
    expect(columnNames).toContain('is_streaming');
    expect(columnNames).toContain('prompt_tokens');
    expect(columnNames).toContain('completion_tokens');
    expect(columnNames).toContain('total_tokens');
    expect(columnNames).toContain('cached_tokens');
    expect(columnNames).toContain('error_message');
    expect(columnNames).toContain('error_type');
    expect(columnNames).toContain('response_metadata');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/lib/schema.test.ts
```

Expected: FAIL — `schema.js` module not found

- [ ] **Step 3: Create drizzle.config.ts**

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './.gateway-dev.db',
  },
});
```

- [ ] **Step 4: Create src/lib/schema.ts**

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const requests = sqliteTable('requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  requestId: text('request_id').notNull().unique(),
  timestamp: text('timestamp').notNull(),
  createdAt: integer('created_at').notNull(),

  userName: text('user_name'),

  customModel: text('custom_model'),
  realModel: text('real_model'),
  provider: text('provider'),
  modelGroup: text('model_group'),
  actualModel: text('actual_model'),

  endpoint: text('endpoint'),
  statusCode: integer('status_code'),
  durationMs: integer('duration_ms'),
  isStreaming: integer('is_streaming', { mode: 'boolean' }),

  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),
  cachedTokens: integer('cached_tokens'),

  errorMessage: text('error_message'),
  errorType: text('error_type'),

  responseMetadata: text('response_metadata'),
});
```

- [ ] **Step 5: Update test to import the actual schema**

Replace the manual CREATE TABLE in the test with a Drizzle push-based approach. Update the test to use `drizzle-kit push` or use the `migrate` function. For unit test simplicity, just verify the column definitions export:

```typescript
import { describe, it, expect } from 'vitest';
import { requests } from '../../src/lib/schema.js';

describe('requests table schema', () => {
  it('should define all expected columns', () => {
    const columns = requests.column;
    expect(columns.requestId).toBeDefined();
    expect(columns.timestamp).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.userName).toBeDefined();
    expect(columns.customModel).toBeDefined();
    expect(columns.realModel).toBeDefined();
    expect(columns.provider).toBeDefined();
    expect(columns.modelGroup).toBeDefined();
    expect(columns.actualModel).toBeDefined();
    expect(columns.endpoint).toBeDefined();
    expect(columns.statusCode).toBeDefined();
    expect(columns.durationMs).toBeDefined();
    expect(columns.isStreaming).toBeDefined();
    expect(columns.promptTokens).toBeDefined();
    expect(columns.completionTokens).toBeDefined();
    expect(columns.totalTokens).toBeDefined();
    expect(columns.cachedTokens).toBeDefined();
    expect(columns.errorMessage).toBeDefined();
    expect(columns.errorType).toBeDefined();
    expect(columns.responseMetadata).toBeDefined();
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm vitest run tests/lib/schema.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add drizzle.config.ts src/lib/schema.ts tests/lib/schema.test.ts
git commit -m "feat: add Drizzle schema and config for SQLite request logging"
```

---

### Task 3: Create DatabaseManager

**Files:**
- Create: `src/lib/db.ts`
- Create: `tests/lib/db.test.ts`

- [ ] **Step 1: Write failing tests for DatabaseManager**

```typescript
// tests/lib/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { DatabaseManager } from '../../src/lib/db.js';

const testDir = '/tmp/llm-gateway-test-db';

function setupDir() {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });
}

describe('DatabaseManager', () => {
  beforeEach(() => {
    setupDir();
    DatabaseManager.resetInstance();
  });

  afterEach(() => {
    try { DatabaseManager.getInstance(testDir).close(); } catch {}
    DatabaseManager.resetInstance();
    rmSync(testDir, { recursive: true });
  });

  it('should create singleton instance', () => {
    const db1 = DatabaseManager.getInstance(testDir);
    const db2 = DatabaseManager.getInstance(testDir);
    expect(db1).toBe(db2);
  });

  it('should initialize WAL mode and create tables', () => {
    const dm = DatabaseManager.getInstance(testDir);
    dm.initialize();

    const db = dm.getDb();
    const tableNames = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all() as any[];
    expect(tableNames.some((t: any) => t.name === 'requests')).toBe(true);

    const journalMode = db.prepare('PRAGMA journal_mode').get() as any;
    expect(journalMode.journal_mode.toLowerCase()).toBe('wal');
  });

  it('should clean up old records only from requests table', () => {
    const dm = DatabaseManager.getInstance(testDir);
    dm.initialize();

    const db = dm.getDb();
    // Insert old record
    db.prepare(`
      INSERT INTO requests (request_id, timestamp, created_at)
      VALUES ('old', '2020-01-01', 100)
    `).run();
    // Insert new record
    db.prepare(`
      INSERT INTO requests (request_id, timestamp, created_at)
      VALUES ('new', '2026-06-07', Date.now())
    `).run();

    dm.cleanupOldRequests(1); // 1 day retention
    const remaining = db.prepare('SELECT COUNT(*) as c FROM requests').get() as any;
    expect(remaining.c).toBe(1);

    const row = db.prepare('SELECT request_id FROM requests').all() as any[];
    expect(row[0].request_id).toBe('new');
  });

  it('should handle double initialize gracefully', () => {
    const dm = DatabaseManager.getInstance(testDir);
    dm.initialize();
    dm.initialize(); // should not throw
    expect(dm.getDb()).toBeDefined();
  });

  it('should close database', () => {
    const dm = DatabaseManager.getInstance(testDir);
    dm.initialize();
    dm.close();
    expect(() => dm.getDb()).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/lib/db.test.ts
```

Expected: FAIL — `db.js` module not found

- [ ] **Step 3: Implement DatabaseManager**

```typescript
// src/lib/db.ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as schema from './schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private db: Database.Database | null = null;
  private _drizzle: ReturnType<typeof drizzle> | null = null;
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
    if (this.db) return;

    const dbPath = join(this.configDir, 'gateway.db');

    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this._drizzle = drizzle(this.db, { schema });

    const migrationsFolder = join(__dirname, '..', '..', 'migrations');
    if (existsSync(migrationsFolder)) {
      migrate(this._drizzle, { migrationsFolder });
    }
  }

  getDb(): Database.Database {
    if (!this.db) throw new Error('Database not initialized. Call initialize() first.');
    return this.db;
  }

  getDrizzle(): ReturnType<typeof drizzle> {
    if (!this._drizzle) throw new Error('Database not initialized. Call initialize() first.');
    return this._drizzle;
  }

  cleanupOldRequests(retentionDays: number = 90): void {
    if (!this.db) return;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const result = this.db.prepare('DELETE FROM requests WHERE created_at < ?').run(cutoff);
    if (result.changes > 0) {
      console.log(`[DB] Cleaned ${result.changes} request records older than ${retentionDays} days`);
    }
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this._drizzle = null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/lib/db.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts tests/lib/db.test.ts
git commit -m "feat: add DatabaseManager for SQLite initialization and cleanup"
```

---

### Task 4: Create RequestLogger async queue

**Files:**
- Create: `src/lib/request-logger.ts`
- Create: `tests/lib/request-logger.test.ts`

- [ ] **Step 1: Write failing tests for RequestLogger**

```typescript
// tests/lib/request-logger.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { DatabaseManager } from '../../src/lib/db.js';
import { RequestLogger } from '../../src/lib/request-logger.js';

const testDir = '/tmp/llm-gateway-test-logger';

function createEntry(overrides: Record<string, any> = {}) {
  return {
    requestId: `req-${Date.now()}-${Math.random()}`,
    timestamp: new Date().toISOString(),
    userName: 'test-user',
    customModel: 'gpt-4',
    endpoint: '/v1/chat/completions',
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
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });
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
    rmSync(testDir, { recursive: true });
  });

  it('should create singleton instance', () => {
    const l1 = RequestLogger.getInstance(dbManager);
    const l2 = RequestLogger.getInstance(dbManager);
    expect(l1).toBe(l2);
  });

  it('should write log entry to SQLite after flush', async () => {
    requestLogger.start();
    const entry = createEntry({ customModel: 'claude-3' });
    requestLogger.log(entry);

    await new Promise(r => setTimeout(r, 200)); // wait for flush

    const db = dbManager.getDb();
    const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get(entry.requestId) as any;
    expect(row).toBeDefined();
    expect(row.custom_model).toBe('claude-3');
    expect(row.user_name).toBe('test-user');
  });

  it('should handle duplicate request_id gracefully', async () => {
    requestLogger.start();
    requestLogger.log(createEntry({ requestId: 'dup-1' }));
    requestLogger.log(createEntry({ requestId: 'dup-1' }));

    await new Promise(r => setTimeout(r, 200));

    const db = dbManager.getDb();
    const count = db.prepare('SELECT COUNT(*) as c FROM requests WHERE request_id = ?').get('dup-1') as any;
    expect(count.c).toBe(1);
  });

  it('should flush remaining entries on stop', () => {
    const entry = createEntry();
    requestLogger.log(entry);
    requestLogger.stop();

    const db = dbManager.getDb();
    const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get(entry.requestId) as any;
    expect(row).toBeDefined();
  });

  it('should handle many entries', async () => {
    requestLogger.start();

    for (let i = 0; i < 50; i++) {
      requestLogger.log(createEntry({ requestId: `batch-${i}` }));
    }

    await new Promise(r => setTimeout(r, 500));

    const db = dbManager.getDb();
    const count = db.prepare('SELECT COUNT(*) as c FROM requests').get() as any;
    expect(count.c).toBe(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/lib/request-logger.test.ts
```

Expected: FAIL — `request-logger.js` module not found

- [ ] **Step 3: Implement RequestLogger**

```typescript
// src/lib/request-logger.ts
import type { DatabaseManager } from './db.js';
import { requests } from './schema.js';

const FLUSH_INTERVAL_MS = 100;
const MAX_QUEUE_SIZE = 500;

export interface RequestLogEntry {
  requestId: string;
  timestamp: string;
  userName?: string;
  customModel?: string;
  realModel?: string;
  provider?: string;
  endpoint: string;
  statusCode: number;
  durationMs: number;
  isStreaming: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  modelGroup?: string;
  actualModel?: string;
  errorMessage?: string;
  errorType?: string;
  responseMetadata?: string;
}

export class RequestLogger {
  private static instance: RequestLogger | null = null;
  private dbManager: DatabaseManager;
  private queue: RequestLogEntry[] = [];
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
    this.intervalId = setInterval(() => this.flushQueue(), FLUSH_INTERVAL_MS);
  }

  log(entry: RequestLogEntry): void {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.queue.shift();
      console.warn(`[RequestLogger] Queue full (${MAX_QUEUE_SIZE}), dropping oldest entry`);
    }
    this.queue.push(entry);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.flushQueue();
  }

  private flushQueue(): void {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    this.writeBatch(batch);
  }

  private writeBatch(entries: RequestLogEntry[]): void {
    try {
      const drizzle = this.dbManager.getDrizzle();
      drizzle.insert(requests).values(
        entries.map(e => ({
          requestId: e.requestId,
          timestamp: e.timestamp,
          createdAt: Date.now(),
          userName: e.userName ?? null,
          customModel: e.customModel ?? null,
          realModel: e.realModel ?? null,
          provider: e.provider ?? null,
          modelGroup: e.modelGroup ?? null,
          actualModel: e.actualModel ?? null,
          endpoint: e.endpoint,
          statusCode: e.statusCode,
          durationMs: e.durationMs,
          isStreaming: e.isStreaming,
          promptTokens: e.promptTokens ?? null,
          completionTokens: e.completionTokens ?? null,
          totalTokens: e.totalTokens ?? null,
          cachedTokens: e.cachedTokens ?? null,
          errorMessage: e.errorMessage ?? null,
          errorType: e.errorType ?? null,
          responseMetadata: e.responseMetadata ?? null,
        }))
      ).run();
    } catch (err: any) {
      console.error(`[RequestLogger] Batch write failed: ${err.message}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

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

### Task 5: Integrate into server.ts

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Add imports at top of server.ts**

After the existing imports, add:

```typescript
import { DatabaseManager } from './lib/db.js';
import { RequestLogger } from './lib/request-logger.js';
```

- [ ] **Step 2: Initialize DB and RequestLogger after config resolution**

Find the section where `logDir` is computed (~line 114) and add after it:

```typescript
  // Initialize SQLite database for request logging
  const dbManager = DatabaseManager.getInstance(ctx.logDir);
  dbManager.initialize();

  // Start async request logger
  const requestLogger = RequestLogger.getInstance(dbManager);
  requestLogger.start();
```

- [ ] **Step 3: Add 90-day cleanup to the existing cleanup interval**

Replace the existing `statsProvider.cleanup()` call with:

```typescript
  if (!cleanupInterval) {
    cleanupInterval = setInterval(() => {
      statsProvider.cleanup();
      dbManager.cleanupOldRequests(90);
      console.log('🧹 已清理过期数据');
    }, 60 * 60 * 1000);
  }
```

- [ ] **Step 4: Add DB+Logger shutdown to signal handlers**

Update the SIGINT and SIGTERM handlers:

```typescript
    sigintHandler = () => {
      if (cleanupInterval) clearInterval(cleanupInterval);
      requestLogger.stop();
      dbManager.close();
      process.exit(0);
    };

    sigtermHandler = () => {
      if (cleanupInterval) clearInterval(cleanupInterval);
      requestLogger.stop();
      dbManager.close();
      process.exit(0);
    };
```

- [ ] **Step 5: Verify build compiles**

```bash
pnpm build
```

Expected: Compiles without errors (imports resolve, types are correct)

- [ ] **Step 6: Commit**

```bash
git add src/server.ts
git commit -m "feat: integrate SQLite DB and RequestLogger into server startup/shutdown"
```

---

### Task 6: Update chat-completions handler

**Files:**
- Modify: `src/routes/chat-completions/handler.ts`
- Modify: `src/routes/chat-completions/stream-handler.ts`
- Modify: `src/routes/chat-completions/non-stream-handler.ts`

- [ ] **Step 1: Read current handler.ts and understand all logger.log() locations**

There are 5 locations where `logger.log()` is called:
1. Model not found (line ~130)
2. Auth check failure (line ~198)
3. Non-stream success result (line ~222)
4. Stream handler (delegated to stream-handler.ts, line ~241)
5. Catch error (line ~256)

- [ ] **Step 2: Add requestLogger.log() after logger.log() for authenticated users**

In each location, add the pattern:

```typescript
logger.log(logEntry);

if (currentUser) {
  requestLogger.log({
    requestId: logEntry.requestId,
    timestamp: logEntry.timestamp,
    userName: currentUser.name,
    customModel: logEntry.customModel,
    realModel: logEntry.realModel,
    provider: logEntry.provider,
    endpoint: logEntry.endpoint,
    statusCode: logEntry.statusCode,
    durationMs: logEntry.durationMs,
    isStreaming: logEntry.isStreaming,
    promptTokens: logEntry.promptTokens,
    completionTokens: logEntry.completionTokens,
    totalTokens: logEntry.totalTokens,
    cachedTokens: logEntry.cachedTokens,
    modelGroup: logEntry.modelGroup,
    actualModel: logEntry.actualModel,
    errorMessage: logEntry.error?.message,
    errorType: logEntry.error?.type,
    responseMetadata: logEntry.responseMetadata,
  });
}
```

**Important:** Since `requestLogger` is not passed into the handler factory yet, the handler currently only receives `(config, logger, detailLogger, timeoutMs, logDir)`. We need to either:
- **Option A:** Pass `requestLogger` as a new param (requires updating the factory signature and callers)
- **Option B:** Use the global singleton directly: `RequestLogger.getInstance(...)`

**Option B is simpler** — since `RequestLogger` is a singleton, in the handler just call:

```typescript
import { RequestLogger } from '../../lib/request-logger.js';
// ...
const requestLogger = RequestLogger.getInstance(/* any dbManager - it's a singleton */);
```

But actually `getInstance` requires a `dbManager` argument. Since the singleton is already initialized in `server.ts`, we could add a no-arg accessor. Let's keep it simple:

In `src/lib/db.ts`, add a static method:
```typescript
  static getExistingInstance(): DatabaseManager | null {
    return DatabaseManager.instance;
  }
```

In the handler, use:
```typescript
import { DatabaseManager } from '../../lib/db.js';
import { RequestLogger } from '../../lib/request-logger.js';

// Inside the handler function:
const dm = DatabaseManager.getExistingInstance();
const requestLogger = dm ? RequestLogger.getInstance(dm) : null;
// ...
if (requestLogger && currentUser) {
  requestLogger.log({ ... });
}
```

- [ ] **Step 3: Update DatabaseManager to expose existing instance**

Add to `src/lib/db.ts`:
```typescript
  static getExistingInstance(): DatabaseManager | null {
    return DatabaseManager.instance;
  }
```

- [ ] **Step 4: Update stream-handler.ts similarly**

The stream handler receives `logEntry` and `logger` as options. Add `requestLogger` and `currentUser` to the `StreamHandlerOptions` interface:

```typescript
export interface StreamHandlerOptions {
  // ... existing fields
  requestLogger?: RequestLogger;
  currentUser?: { name: string } | null;
}
```

In the stream end handler (where `logger.log(logEntry)` is called at the end of the stream), add:
```typescript
if (options.requestLogger && options.currentUser) {
  options.requestLogger.log({
    requestId: logEntry.requestId,
    timestamp: logEntry.timestamp,
    userName: options.currentUser.name,
    customModel: logEntry.customModel,
    realModel: logEntry.realModel,
    provider: logEntry.provider,
    endpoint: logEntry.endpoint,
    statusCode: logEntry.statusCode,
    durationMs: logEntry.durationMs,
    isStreaming: logEntry.isStreaming,
    promptTokens: logEntry.promptTokens,
    completionTokens: logEntry.completionTokens,
    totalTokens: logEntry.totalTokens,
    cachedTokens: logEntry.cachedTokens,
    modelGroup: logEntry.modelGroup,
    actualModel: logEntry.actualModel,
    errorMessage: logEntry.error?.message,
    errorType: logEntry.error?.type,
    responseMetadata: logEntry.responseMetadata,
  });
}
```

- [ ] **Step 5: Add responseMetadata to non-stream-handler.ts**

In `non-stream-handler.ts`, where usage is extracted, also capture the full usage object:

```typescript
// After extracting usage fields:
logEntry.responseMetadata = JSON.stringify(responseData.usage ?? {});
```

- [ ] **Step 6: Verify build**

```bash
pnpm build
```

Expected: Compiles without errors

- [ ] **Step 7: Commit**

```bash
git add src/routes/chat-completions/ src/lib/db.ts
git commit -m "feat: add requestLogger.log() to chat-completions handler for authenticated users"
```

---

### Task 7: Update messages handler

**Files:**
- Modify: `src/routes/messages/handler.ts`

- [ ] **Step 1: Add import and requestLogger access at top of handler**

Add to imports:
```typescript
import { DatabaseManager } from '../../lib/db.js';
import { RequestLogger } from '../../lib/request-logger.js';
```

Inside the handler function, after `const currentUser = ...`:
```typescript
    const dm = DatabaseManager.getExistingInstance();
    const requestLogger = dm ? RequestLogger.getInstance(dm) : null;
```

- [ ] **Step 2: Add requestLogger.log() after each logger.log() for authenticated users**

There are 6 locations in `src/routes/messages/handler.ts`:

**Location 1 — Model not found (~line 125):**
```typescript
          logger.log({ ... });
+         if (requestLogger && currentUser) {
+           requestLogger.log({
+             requestId, timestamp: new Date().toISOString(),
+             userName: currentUser.name,
+             customModel: model, endpoint, statusCode: 404,
+             durationMs: Date.now() - startTime, isStreaming: !!stream,
+             errorMessage: 'Model not found',
+           });
+         }
```

**Location 2 — Auth check failure (~line 193):**
```typescript
        logger.log({ ... });
+       if (requestLogger && currentUser) {
+         requestLogger.log({
+           requestId, timestamp: new Date().toISOString(),
+           userName: currentUser.name,
+           customModel: model_group ? actualModel! : model, endpoint,
+           statusCode: 401, durationMs: Date.now() - startTime,
+           isStreaming: !!stream, errorMessage: 'Authentication required',
+         });
+       }
```

**Location 3 — Non-stream success (~line 217):**
```typescript
          logger.log(result.logEntry);
+         if (requestLogger && currentUser) {
+           requestLogger.log({
+             requestId: result.logEntry.requestId,
+             timestamp: result.logEntry.timestamp,
+             userName: currentUser.name,
+             customModel: result.logEntry.customModel,
+             realModel: result.logEntry.realModel,
+             provider: result.logEntry.provider,
+             endpoint: result.logEntry.endpoint,
+             statusCode: result.logEntry.statusCode,
+             durationMs: result.logEntry.durationMs,
+             isStreaming: result.logEntry.isStreaming,
+             promptTokens: result.logEntry.promptTokens,
+             completionTokens: result.logEntry.completionTokens,
+             totalTokens: result.logEntry.totalTokens,
+             cachedTokens: result.logEntry.cachedTokens,
+             modelGroup: result.logEntry.modelGroup,
+             actualModel: result.logEntry.actualModel,
+             errorMessage: result.logEntry.error?.message,
+             errorType: result.logEntry.error?.type,
+             responseMetadata: result.logEntry.responseMetadata,
+           });
+         }
```

**Location 4 — General fallback after non-stream (~line 226):**
```typescript
      logger.log(logEntry);
+     if (requestLogger && currentUser) {
+       requestLogger.log(/* same field mapping as Location 3 */);
+     }
```

**Location 5 — Stream handler (~line 236):** The stream handler delegates to `handleMessagesStream`. The `handleStream` for messages is in `src/routes/messages/stream-handler.ts`. Update it similarly to the chat-completions stream handler (Task 6 Step 4): add `requestLogger` and `currentUser` to the stream handler options, and call `requestLogger.log()` at the end of the stream.

**Location 6 — Catch error (~line 251):**
```typescript
      logger.log({ ... });
+     if (requestLogger && currentUser) {
+       requestLogger.log({
+         requestId, timestamp: new Date().toISOString(),
+         userName: currentUser.name,
+         customModel: modelGroup ? actualModel! : (body.model as string),
+         endpoint, statusCode: 500,
+         durationMs: Date.now() - startTime, isStreaming: false,
+         errorMessage: error.message || 'Internal error',
+         errorType: error.name,
+       });
+     }
```

- [ ] **Step 3: Also update messages non-stream-handler.ts**

Read `src/routes/messages/non-stream-handler.ts`. If it extracts usage from the response, add `logEntry.responseMetadata = JSON.stringify(responseData.usage ?? {})` at the same point.

- [ ] **Step 4: Verify build**

```bash
pnpm build
```

Expected: Compiles without errors

- [ ] **Step 5: Commit**

```bash
git add src/routes/messages/
git commit -m "feat: add requestLogger.log() to messages handler for authenticated users"
```

---

### Task 8: Generate initial migration and verify

**Files:**
- Generate: `migrations/0000_initial.sql`

- [ ] **Step 1: Generate initial migration with drizzle-kit**

```bash
pnpm drizzle-kit generate
```

Expected: creates `migrations/0000_<name>.sql` with CREATE TABLE DDL and indexes

- [ ] **Step 2: Verify the generated SQL**

Read `migrations/0000_*.sql` and confirm it contains:
- CREATE TABLE requests with all columns
- CREATE INDEX for each index

- [ ] **Step 3: Commit**

```bash
git add migrations/
git commit -m "feat: add initial SQLite migration for requests table"
```

---

### Task 9: Create integration test

**Files:**
- Create: `tests/integration/sqlite-logging.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// tests/integration/sqlite-logging.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { DatabaseManager } from '../../src/lib/db.js';
import { RequestLogger } from '../../src/lib/request-logger.js';

const testDir = '/tmp/llm-gateway-test-int';

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

  it('should log a successful request and query it back', async () => {
    const dbManager = DatabaseManager.getInstance(testDir);
    dbManager.initialize();

    const requestLogger = RequestLogger.getInstance(dbManager);
    requestLogger.start();

    requestLogger.log({
      requestId: 'int-test-1',
      timestamp: new Date().toISOString(),
      userName: 'alice',
      customModel: 'gpt-4',
      realModel: 'gpt-4-turbo',
      provider: 'openai',
      endpoint: '/v1/chat/completions',
      statusCode: 200,
      durationMs: 1234,
      isStreaming: false,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedTokens: 20,
    });

    await new Promise(r => setTimeout(r, 200));

    const db = dbManager.getDb();
    const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get('int-test-1') as any;
    expect(row).toBeDefined();
    expect(row.user_name).toBe('alice');
    expect(row.custom_model).toBe('gpt-4');
    expect(row.prompt_tokens).toBe(100);
    expect(row.completion_tokens).toBe(50);
    expect(row.total_tokens).toBe(150);
    expect(row.cached_tokens).toBe(20);
    expect(row.status_code).toBe(200);
    expect(row.duration_ms).toBe(1234);

    requestLogger.stop();
  });

  it('should log a failed request with error info', async () => {
    const dbManager = DatabaseManager.getInstance(testDir);
    dbManager.initialize();

    const requestLogger = RequestLogger.getInstance(dbManager);
    requestLogger.start();

    requestLogger.log({
      requestId: 'int-test-2',
      timestamp: new Date().toISOString(),
      userName: 'bob',
      customModel: 'claude-3',
      provider: 'anthropic',
      endpoint: '/v1/messages',
      statusCode: 500,
      durationMs: 5000,
      isStreaming: false,
      errorMessage: 'Upstream timeout',
      errorType: 'TimeoutError',
    });

    await new Promise(r => setTimeout(r, 200));

    const db = dbManager.getDb();
    const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get('int-test-2') as any;
    expect(row).toBeDefined();
    expect(row.error_message).toBe('Upstream timeout');
    expect(row.status_code).toBe(500);

    requestLogger.stop();
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
pnpm vitest run tests/integration/sqlite-logging.test.ts
```

Expected: All tests PASS

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

Expected: All tests pass (including pre-existing tests)

- [ ] **Step 4: Commit**

```bash
git add tests/integration/sqlite-logging.test.ts
git commit -m "test: add SQLite request logging integration tests"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

- [ ] **Step 2: Run build**

```bash
pnpm build
```

- [ ] **Step 3: Verify no regressions**

```bash
git log --oneline -10
```

Expected: All recent commits are from this plan. Build and tests pass.
