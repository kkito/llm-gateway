import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { DatabaseManager } from '../../src/lib/db.js';
import { RequestLogger } from '../../src/lib/request-logger.js';
import { loadStats, getHourlyBreakdown, getDailyBreakdown } from '../../src/lib/stats-core.js';
import type { LogEntry } from '../../src/logger.js';

const testDir = '/tmp/llm-gateway-test-integration';

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
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    cachedTokens: 0,
    ...overrides,
  };
}

describe('SQLite Request Log Integration Tests', () => {
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
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('RequestLogger -> SQLite -> Stats', () => {
    it('should log requests and retrieve correct stats', async () => {
      requestLogger.start();

      // Log multiple requests
      const entries: LogEntry[] = [
        createTestEntry({ customModel: 'gpt-4', provider: 'openai', statusCode: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150, userName: 'alice' }),
        createTestEntry({ customModel: 'gpt-4', provider: 'openai', statusCode: 200, promptTokens: 200, completionTokens: 100, totalTokens: 300, userName: 'alice' }),
        createTestEntry({ customModel: 'claude-3', provider: 'anthropic', statusCode: 200, promptTokens: 300, completionTokens: 150, totalTokens: 450, userName: 'bob' }),
        createTestEntry({ customModel: 'gpt-4', provider: 'openai', statusCode: 500, promptTokens: 0, completionTokens: 0, totalTokens: 0, userName: 'alice' }),
      ];

      for (const entry of entries) {
        requestLogger.log(entry);
      }

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify stats via stats-core
      const db = dbManager.getDb();
      const stats = loadStats(db);

      expect(stats.totalRequests).toBe(4);
      expect(stats.successfulRequests).toBe(3);
      expect(stats.failedRequests).toBe(1);

      // Per-model breakdown
      expect(stats.byModel['gpt-4'].requests).toBe(3);
      expect(stats.byModel['gpt-4'].successful).toBe(2);
      expect(stats.byModel['gpt-4'].failed).toBe(1);
      expect(stats.byModel['gpt-4'].inputTokens).toBe(300);
      expect(stats.byModel['gpt-4'].outputTokens).toBe(150);

      expect(stats.byModel['claude-3'].requests).toBe(1);
      expect(stats.byModel['claude-3'].inputTokens).toBe(300);

      // Per-provider breakdown
      expect(stats.byProvider['openai'].requests).toBe(3);
      expect(stats.byProvider['anthropic'].requests).toBe(1);

      // Totals
      expect(stats.totalInputTokens).toBe(600);
      expect(stats.totalOutputTokens).toBe(300);
    });

    it('should filter stats by userName', async () => {
      requestLogger.start();

      requestLogger.log(createTestEntry({ customModel: 'gpt-4', statusCode: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150, userName: 'alice' }));
      requestLogger.log(createTestEntry({ customModel: 'gpt-4', statusCode: 200, promptTokens: 200, completionTokens: 100, totalTokens: 300, userName: 'bob' }));
      requestLogger.log(createTestEntry({ customModel: 'claude-3', statusCode: 200, promptTokens: 300, completionTokens: 150, totalTokens: 450, userName: 'alice' }));

      await new Promise(resolve => setTimeout(resolve, 300));

      const db = dbManager.getDb();
      const aliceStats = loadStats(db, { userName: 'alice' });

      expect(aliceStats.totalRequests).toBe(2);
      expect(aliceStats.totalInputTokens).toBe(400);
      expect(Object.keys(aliceStats.byModel)).toContain('gpt-4');
      expect(Object.keys(aliceStats.byModel)).toContain('claude-3');
    });

    it('should get hourly breakdown', async () => {
      requestLogger.start();

      const today = new Date().toISOString().split('T')[0];

      requestLogger.log(createTestEntry({ timestamp: `${today}T10:15:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150 }));
      requestLogger.log(createTestEntry({ timestamp: `${today}T10:45:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 200, completionTokens: 100, totalTokens: 300 }));
      requestLogger.log(createTestEntry({ timestamp: `${today}T11:30:00Z`, customModel: 'claude-3', statusCode: 200, promptTokens: 300, completionTokens: 150, totalTokens: 450 }));

      await new Promise(resolve => setTimeout(resolve, 300));

      const db = dbManager.getDb();
      const hourly = getHourlyBreakdown(db);

      expect(hourly.length).toBe(2);
      expect(hourly[0].hour).toContain('10:00');
      expect(hourly[0].stats.requests).toBe(2);
      expect(hourly[1].hour).toContain('11:00');
      expect(hourly[1].stats.requests).toBe(1);
    });

    it('should handle duplicate request_id gracefully', async () => {
      requestLogger.start();

      const entry = createTestEntry({ requestId: 'dup-test-123' });
      requestLogger.log(entry);
      requestLogger.log(entry);
      requestLogger.log(entry);

      await new Promise(resolve => setTimeout(resolve, 300));

      const db = dbManager.getDb();
      const count = db.prepare('SELECT COUNT(*) as c FROM requests WHERE request_id = ?').get('dup-test-123') as { c: number };
      expect(count.c).toBe(1); // INSERT OR IGNORE should prevent duplicates
    });

    it('should handle cached tokens correctly', async () => {
      requestLogger.start();

      requestLogger.log(createTestEntry({ customModel: 'gpt-4', statusCode: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150, cachedTokens: 30 }));
      requestLogger.log(createTestEntry({ customModel: 'gpt-4', statusCode: 200, promptTokens: 200, completionTokens: 100, totalTokens: 300, cachedTokens: 50 }));

      await new Promise(resolve => setTimeout(resolve, 300));

      const db = dbManager.getDb();
      const stats = loadStats(db);

      expect(stats.totalCachedTokens).toBe(80);
      expect(stats.byModel['gpt-4'].cachedTokens).toBe(80);
    });
  });

  describe('RequestLogger queue behavior', () => {
    it('should flush on stop', async () => {
      // Don't start the interval - log without starting
      const entry = createTestEntry();
      requestLogger.log(entry);

      // Stop should flush remaining entries synchronously
      requestLogger.stop();

      const db = dbManager.getDb();
      const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get(entry.requestId) as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
    });

    it('should handle large batches', async () => {
      requestLogger.start();

      for (let i = 0; i < 100; i++) {
        requestLogger.log(createTestEntry({ customModel: `model-${i % 10}`, statusCode: 200, promptTokens: i, completionTokens: i * 2, totalTokens: i * 3 }));
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      const db = dbManager.getDb();
      const count = db.prepare('SELECT COUNT(*) as c FROM requests').get() as { c: number };
      expect(count.c).toBe(100);

      const stats = loadStats(db);
      expect(stats.totalRequests).toBe(100);
      expect(stats.successfulRequests).toBe(100);
    });
  });

  describe('Error handling', () => {
    it('should handle entries with missing optional fields', async () => {
      requestLogger.start();

      const minimalEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: `minimal-${Date.now()}`,
        customModel: 'test-model',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        statusCode: 200,
        durationMs: 100,
        isStreaming: false,
      };

      requestLogger.log(minimalEntry);
      await new Promise(resolve => setTimeout(resolve, 300));

      const db = dbManager.getDb();
      const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get(minimalEntry.requestId) as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
      expect(row!.custom_model).toBe('test-model');
      expect(row!.status_code).toBe(200);
      expect(row!.prompt_tokens).toBeNull();
    });

    it('should handle entries with error objects', async () => {
      requestLogger.start();

      const errorEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: `error-${Date.now()}`,
        customModel: 'test-model',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        statusCode: 500,
        durationMs: 100,
        isStreaming: false,
        error: { message: 'Internal server error', type: 'internal_error' },
      };

      requestLogger.log(errorEntry);
      await new Promise(resolve => setTimeout(resolve, 300));

      const db = dbManager.getDb();
      const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get(errorEntry.requestId) as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
      expect(row!.status_code).toBe(500);
      expect(row!.error_message).toBe('Internal server error');
      expect(row!.error_type).toBe('internal_error');
    });
  });
});
