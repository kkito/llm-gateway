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

    await new Promise(r => setTimeout(r, 200));

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

  it('should persist ttft_ms and tps when provided', async () => {
    requestLogger.start();
    const entry = createEntry({ isStreaming: true, ttftMs: 123, tps: 42.5 });
    requestLogger.log(entry);
    await new Promise(r => setTimeout(r, 200));
    const row = dbManager.getDb().prepare('SELECT ttft_ms, tps FROM requests WHERE request_id=?').get(entry.requestId) as any;
    expect(row.ttft_ms).toBe(123);
    expect(row.tps).toBe(42.5);
  });

  it('should store NULL when ttft/tps missing (non-streaming)', async () => {
    requestLogger.start();
    const entry = createEntry({ isStreaming: false });
    requestLogger.log(entry);
    await new Promise(r => setTimeout(r, 200));
    const row = dbManager.getDb().prepare('SELECT ttft_ms, tps FROM requests WHERE request_id=?').get(entry.requestId) as any;
    expect(row.ttft_ms).toBeNull();
    expect(row.tps).toBeNull();
  });
});
