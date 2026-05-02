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
