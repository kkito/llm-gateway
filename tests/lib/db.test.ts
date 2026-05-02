import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { DatabaseManager } from '../../src/lib/db.js';

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

    expect(journalMode.journal_mode).toBe('wal');
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
