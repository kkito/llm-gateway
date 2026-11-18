# Client IP Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the client source IP of every proxied request in the SQLite `requests` table and in each proxy JSON log line.

**Architecture:** Add a pure `getClientIp(c)` helper that resolves `x-forwarded-for` → `x-real-ip` → connection socket address. Each proxy handler computes it once, stores it on the shared `logEntry` object, and passes it to interceptors and `RequestLogger`. A new drizzle migration plus an `ensureColumns()` fallback adds `client_ip` with an index before any logging starts. No admin UI changes.

**Tech Stack:** TypeScript, Hono, better-sqlite3, drizzle-orm, vitest.

---

### Task 1: Add `getClientIp` helper

**Files:**
- Create: `src/lib/client-ip.ts`
- Test: `tests/lib/client-ip.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/client-ip.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getClientIp } from '../../src/lib/client-ip.js';

describe('getClientIp', () => {
  it('uses the first x-forwarded-for entry', () => {
    const c = { req: { header: (name: string) => name === 'x-forwarded-for' ? '203.0.113.7, 10.0.0.1' : null } };
    expect(getClientIp(c as any)).toBe('203.0.113.7');
  });

  it('trims whitespace in x-forwarded-for', () => {
    const c = { req: { header: (name: string) => name === 'x-forwarded-for' ? '  198.51.100.2  , 10.0.0.1' : null } };
    expect(getClientIp(c as any)).toBe('198.51.100.2');
  });

  it('falls back to x-real-ip when x-forwarded-for is empty', () => {
    const c = { req: { header: (name: string) => name === 'x-real-ip' ? '192.0.2.44' : null } };
    expect(getClientIp(c as any)).toBe('192.0.2.44');
  });

  it('falls back to the connection socket address', () => {
    const c = {
      req: { header: () => null },
      env: { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
    };
    expect(getClientIp(c as any)).toBe('127.0.0.1');
  });

  it('strips the IPv4-mapped prefix from the socket address', () => {
    const c = {
      req: { header: () => null },
      env: { incoming: { socket: { remoteAddress: '::ffff:192.168.1.20' } } },
    };
    expect(getClientIp(c as any)).toBe('192.168.1.20');
  });

  it('returns null when no source is available', () => {
    const c = { req: { header: () => null } };
    expect(getClientIp(c as any)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/client-ip.test.ts`
Expected: FAIL — module `../../src/lib/client-ip.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/client-ip.ts`:

```ts
/**
 * Resolve the client IP for an incoming Hono request.
 * Priority: X-Forwarded-For (first entry) -> X-Real-IP -> connection socket address.
 */
export function getClientIp(c: any): string | null {
  const header = (name: string): string | null => {
    try {
      const value = c?.req?.header?.(name);
      return typeof value === 'string' && value.trim() ? value : null;
    } catch {
      return null;
    }
  };

  const forwarded = header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = header('x-real-ip');
  if (realIp) return realIp.trim();

  try {
    const raw: unknown = c?.env?.incoming?.socket?.remoteAddress;
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim().replace(/^::ffff:/, '');
    }
  } catch {
    // ignore
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/client-ip.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/client-ip.ts tests/lib/client-ip.test.ts
git commit -m "feat: add client IP resolution helper"
```

---

### Task 2: Add `client_ip` column via migration and DB fallback

**Files:**
- Create: `migrations/0002_add_client_ip.sql`
- Modify: `src/lib/schema.ts`
- Modify: `src/lib/db.ts:ensureColumns`
- Test: `tests/integration/sqlite-logging.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/sqlite-logging.test.ts`:

```ts
  it('should create client_ip column and index via migration', () => {
    const dbManager = DatabaseManager.getInstance(testDir);
    dbManager.initialize();

    const db = dbManager.getDb();
    const cols = db.prepare('PRAGMA table_info(requests)').all() as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain('client_ip');

    const indexes = db.prepare('PRAGMA index_list(requests)').all() as Array<{ name: string }>;
    expect(indexes.map(i => i.name)).toContain('idx_client_ip');

    dbManager.close();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/sqlite-logging.test.ts -t "client_ip column"`
Expected: FAIL — `client_ip` not present in `PRAGMA table_info`.

- [ ] **Step 3: Create migration file**

Create `migrations/0002_add_client_ip.sql`:

```sql
ALTER TABLE `requests` ADD `client_ip` text;--> statement-breakpoint
CREATE INDEX `idx_client_ip` ON `requests` (`client_ip`);
```

- [ ] **Step 4: Update drizzle schema**

In `src/lib/schema.ts`, add `clientIp: text('client_ip'),` immediately after `userName: text('user_name'),`, and add `index('idx_client_ip').on(t.clientIp),` inside the returned index array (after `idx_user_name`).

- [ ] **Step 5: Add DB fallback for old databases**

In `src/lib/db.ts`, replace the body of `ensureColumns()` with:

```ts
  private ensureColumns(): void {
    if (!this.db) return;
    try {
      const cols = this.db.prepare('PRAGMA table_info(requests)').all() as Array<{ name: string }>;
      const names = new Set(cols.map(c => c.name));
      if (!names.has('ttft_ms')) this.db.exec('ALTER TABLE requests ADD COLUMN ttft_ms INTEGER');
      if (!names.has('tps')) this.db.exec('ALTER TABLE requests ADD COLUMN tps REAL');
      if (!names.has('client_ip')) this.db.exec('ALTER TABLE requests ADD COLUMN client_ip TEXT');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_client_ip ON requests(client_ip)');
    } catch {
      // ignore
    }
  }
```

Also add `client_ip TEXT` and `CREATE INDEX IF NOT EXISTS idx_client_ip ON requests(client_ip);` to the no-migrations-folder `CREATE TABLE` fallback block in `initialize()`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/sqlite-logging.test.ts`
Expected: PASS (all tests including new one).

- [ ] **Step 7: Commit**

```bash
git add migrations/0002_add_client_ip.sql src/lib/schema.ts src/lib/db.ts tests/integration/sqlite-logging.test.ts
git commit -m "feat(db): add client_ip column and index"
```

---

### Task 3: Persist `clientIp` through RequestLogger

**Files:**
- Modify: `src/lib/request-logger.ts`
- Test: `tests/lib/request-logger.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/request-logger.test.ts` inside the `describe` block:

```ts
  it('should persist clientIp to the database', async () => {
    requestLogger.start();
    const entry = createEntry({ clientIp: '203.0.113.9' });
    requestLogger.log(entry);

    await new Promise(r => setTimeout(r, 200));

    const row = dbManager.getDb()
      .prepare('SELECT client_ip FROM requests WHERE request_id = ?')
      .get(entry.requestId) as { client_ip: string | null };
    expect(row.client_ip).toBe('203.0.113.9');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/request-logger.test.ts -t "clientIp"`
Expected: FAIL — `client_ip` column value is null/not written.

- [ ] **Step 3: Add `clientIp` to the type and both write paths**

In `src/lib/request-logger.ts`:

1. Add to `RequestLogEntry`:
```ts
  clientIp?: string | null;
```

2. In the drizzle insert `values()` map, add:
```ts
          clientIp: e.clientIp ?? null,
```

3. In `writeBatchIndividually()`, add `client_ip` to the INSERT column list after `user_name`:
```sql
        user_name, client_ip, custom_model, real_model, provider,
```

and the matching placeholder after `@userName`:
```sql
        @userName, @clientIp, @customModel, @realModel, @provider,
```

and in the row object after `userName`:
```ts
          clientIp: e.clientIp ?? null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/request-logger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/request-logger.ts tests/lib/request-logger.test.ts
git commit -m "feat(logging): persist clientIp in request log entries"
```

---

### Task 4: Include `clientIp` in proxy file logs

**Files:**
- Modify: `src/logger.ts`
- Test: new `tests/lib/logger-client-ip.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/logger-client-ip.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { Logger } from '../../src/logger.js';

const dir = '/tmp/llm-gateway-logger-ip-test';

describe('Logger client IP field', () => {
  beforeEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true });
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true }));

  it('writes clientIp into the proxy log line', () => {
    const logger = new Logger(dir, 'proxy.log');
    logger.log({
      timestamp: '2026-01-01T00:00:00.000Z',
      requestId: 'req-ip-1',
      customModel: 'm',
      endpoint: '/v1/chat/completions',
      method: 'POST',
      statusCode: 200,
      durationMs: 1,
      isStreaming: false,
      clientIp: '203.0.113.5',
    } as any);

    const line = JSON.parse(readFileSync(`${dir}/proxy.log`, 'utf-8').trim());
    expect(line.clientIp).toBe('203.0.113.5');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/logger-client-ip.test.ts`
Expected: FAIL — TypeScript error: `clientIp` does not exist on `LogEntry`.

- [ ] **Step 3: Add field to LogEntry type**

In `src/logger.ts`, add to `LogEntry` after `userName?: string;`:

```ts
  clientIp?: string | null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/logger-client-ip.test.ts`
Expected: PASS. `JSON.stringify(entry)` already serializes the field.

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts tests/lib/logger-client-ip.test.ts
git commit -m "feat(logging): include clientIp in proxy log entries"
```

---

### Task 5: Wire `clientIp` through all proxy handlers

**Files:**
- Modify: `src/routes/chat-completions/handler.ts`
- Modify: `src/routes/responses/handler.ts`
- Modify: `src/routes/messages/handler.ts`
- Modify: `src/routes/chat-completions/stream-handler.ts`
- Modify: `src/routes/responses/stream-handler.ts`
- Modify: `src/routes/messages/stream-handler.ts`
- Modify: `src/routes/chat-completions/model-fallback.ts`
- Modify: `src/routes/responses/fallback.ts`
- Modify: `src/routes/messages/msg-fallback.ts`
- Test: `tests/routes/handler.test.ts` (existing), new assertions

- [ ] **Step 1: Write the failing test**

Append a new `it(...)` to the `describe` block in `tests/routes/handler.test.ts` (inside the existing setup that mocks `RequestLogger` and provides a mock `c`):

```ts
    it('should include clientIp in requestLogger.log entries from x-forwarded-for', async () => {
      const { handler, mockRequestLogger, provider, logger, detailLogger } = await setupNonStreamingTest();
      const c: any = makeContext({
        body: { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
        headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
      });

      await handler(c, '/v1/chat/completions');

      expect(mockRequestLogger.log).toHaveBeenCalled();
      const entry = mockRequestLogger.log.mock.calls[0][0];
      expect(entry.clientIp).toBe('203.0.113.10');
    });
```

Note: if the existing test file's `makeContext` helper does not accept a `headers` option, add one to the helper so `c.req.header(name)` returns `headers?.[name] ?? null`. The helper already stubs `c.req.header` in the existing tests — extend it rather than replacing it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/routes/handler.test.ts -t "clientIp"`
Expected: FAIL — `entry.clientIp` is undefined.

- [ ] **Step 3: Add import and computed value to each top-level handler**

In each of `src/routes/chat-completions/handler.ts`, `src/routes/responses/handler.ts`, `src/routes/messages/handler.ts`:

Add import at top:
```ts
import { getClientIp } from '../../lib/client-ip.js';
```

Immediately after `const requestId = uuidv4();` add:
```ts
    const clientIp = getClientIp(c);
```

- [ ] **Step 4: Store clientIp on every logger.log entry in the three handlers**

In each top-level handler, every `logger.log({ ... })` object and every `logEntry` object must gain the field `clientIp,`. Use editor find/replace on `userName: currentUser?.name` occurrences to add the line `clientIp,` directly after each one. For `logEntry` objects that use `userName: currentUser?.name` without trailing comma, add `,\n        clientIp,` instead.

This covers: 404 model-not-found, auth 401, non-stream result, no-response-body fallback, catch/error paths, and the shared `logEntry` passed to stream handlers.

- [ ] **Step 5: Pass clientIp to interceptors and RequestLogger in the three handlers**

Replace the interceptor context line:
```ts
        clientIp: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null,
```
with:
```ts
        clientIp,
```

For every `requestLogger.log({ ... })` call in the three handlers, add `clientIp,` immediately after the `requestId: ...` line in that object. There are multiple calls per file (404, 401, non-stream success, no-body fallback, error catch, non-stream fallback). The value is always the handler-level `clientIp` variable.

- [ ] **Step 6: Pass clientIp through stream handlers and fallback helpers**

In `src/routes/chat-completions/stream-handler.ts`, `src/routes/responses/stream-handler.ts`, `src/routes/messages/stream-handler.ts`:

- Add `clientIp,` to the `requestLogger.log({...})` object(s) in each file (next to `requestId: logEntry.requestId`). The `logEntry` passed into the handler already contains `clientIp` from Step 4, so alternatively use `clientIp: logEntry.clientIp,`; prefer that form in stream handlers to avoid adding new option fields.

In `src/routes/chat-completions/model-fallback.ts`, `src/routes/responses/fallback.ts`, `src/routes/messages/msg-fallback.ts`:

- Add `clientIp: getClientIp(c),` to the final `logger.log({ ... })` object in each file, and add `import { getClientIp } from '../../lib/client-ip.js';` at the top of each file. These helpers receive `c` in their context/options object.

- [ ] **Step 7: Run all route tests**

Run: `npx vitest run tests/routes`
Expected: PASS.

- [ ] **Step 8: Run full test suite**

Run: `npm test`
Expected: PASS (all tests).

- [ ] **Step 9: Commit**

```bash
git add src/routes tests/routes/handler.test.ts
git commit -m "feat(routes): propagate client IP to logs and interceptors"
```

---

### Task 6: Full verification and build

**Files:** none (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: PASS; `dist/lib/client-ip.js` exists and `dist/migrations/0002_add_client_ip.sql` is copied (check with ls).

- [ ] **Step 3: Verify migration applies to an existing database**

Run in a scratch directory with a copy of a pre-change DB (or a DB created from old schema):

```bash
mkdir -p /tmp/ip-migration-check
# copy an existing gateway.db into /tmp/ip-migration-check/gateway.db if available
node -e "import('./dist/lib/db.js').then(m => { const dm = m.DatabaseManager.getInstance('/tmp/ip-migration-check'); dm.initialize(); const db = dm.getDb(); console.log(db.prepare('PRAGMA table_info(requests)').all().map(c=>c.name).includes('client_ip')); dm.close(); })"
```

Expected output: `true`.

- [ ] **Step 4: Commit any generated dist changes if the repo tracks them**

Run: `git status --short`
If `dist/` files are tracked and changed, commit them; otherwise no commit needed for this task.

---

## Self-review

- **Spec coverage:** requirement 1 (DB column + migration + fallback) → Tasks 2, 3, 5; requirement 2 (proxy JSON log field) → Tasks 4, 5; non-goals respected (no admin UI, no detail logger, no history backfill, no proxy whitelist).
- **Placeholder scan:** none; every code step contains complete code or precise edit instructions.
- **Type consistency:** `getClientIp(c): string | null` used in all handlers; `RequestLogEntry.clientIp?: string | null`; `LogEntry.clientIp?: string | null`; DB column `client_ip`; index `idx_client_ip`.
