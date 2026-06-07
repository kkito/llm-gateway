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
    db.prepare(`
      INSERT INTO requests (request_id, timestamp, created_at)
      VALUES ('old', '2020-01-01', 100)
    `).run();
    db.prepare(`
      INSERT INTO requests (request_id, timestamp, created_at)
      VALUES ('new', '2026-06-07', ?)
    `).run(Date.now());

    dm.cleanupOldRequests(1);
    const remaining = db.prepare('SELECT COUNT(*) as c FROM requests').get() as any;
    expect(remaining.c).toBe(1);

    const row = db.prepare('SELECT request_id FROM requests').all() as any[];
    expect(row[0].request_id).toBe('new');
  });

  it('should handle double initialize gracefully', () => {
    const dm = DatabaseManager.getInstance(testDir);
    dm.initialize();
    dm.initialize();
    expect(dm.getDb()).toBeDefined();
  });

  it('should close database', () => {
    const dm = DatabaseManager.getInstance(testDir);
    dm.initialize();
    dm.close();
    expect(() => dm.getDb()).toThrow();
  });
});
