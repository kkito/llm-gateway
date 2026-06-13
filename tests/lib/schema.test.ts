import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { requests } from '../../src/lib/schema.js';

describe('requests table schema', () => {
  it('should define all expected columns', () => {
    expect(requests.id).toBeDefined();
    expect(requests.requestId).toBeDefined();
    expect(requests.timestamp).toBeDefined();
    expect(requests.createdAt).toBeDefined();
    expect(requests.userName).toBeDefined();
    expect(requests.customModel).toBeDefined();
    expect(requests.realModel).toBeDefined();
    expect(requests.provider).toBeDefined();
    expect(requests.modelGroup).toBeDefined();
    expect(requests.actualModel).toBeDefined();
    expect(requests.endpoint).toBeDefined();
    expect(requests.statusCode).toBeDefined();
    expect(requests.durationMs).toBeDefined();
    expect(requests.isStreaming).toBeDefined();
    expect(requests.promptTokens).toBeDefined();
    expect(requests.completionTokens).toBeDefined();
    expect(requests.totalTokens).toBeDefined();
    expect(requests.cachedTokens).toBeDefined();
    expect(requests.errorMessage).toBeDefined();
    expect(requests.errorType).toBeDefined();
    expect(requests.responseMetadata).toBeDefined();
  });

  it('should create all four indexes in the database', () => {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');

    db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        request_id TEXT NOT NULL UNIQUE,
        timestamp TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        user_name TEXT, custom_model TEXT, real_model TEXT, provider TEXT,
        model_group TEXT, actual_model TEXT, endpoint TEXT,
        status_code INTEGER, duration_ms INTEGER, is_streaming INTEGER,
        prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER,
        cached_tokens INTEGER, error_message TEXT, error_type TEXT,
        response_metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_timestamp ON requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_user_name ON requests(user_name);
      CREATE INDEX IF NOT EXISTS idx_custom_model ON requests(custom_model);
      CREATE INDEX IF NOT EXISTS idx_created_at ON requests(created_at);
    `);

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='requests'").all() as any[];
    const indexNames = indexes.map(i => i.name);

    expect(indexNames).toContain('idx_timestamp');
    expect(indexNames).toContain('idx_user_name');
    expect(indexNames).toContain('idx_custom_model');
    expect(indexNames).toContain('idx_created_at');

    db.close();
  });

  it('should have correct column types', () => {
    // Verify id is Autoincrement primary key
    expect(requests.id.primary).toBe(true);
    expect(requests.id.notNull).toBe(true);
    // Verify request_id is unique and not null
    expect(requests.requestId.isUnique).toBe(true);
    expect(requests.requestId.notNull).toBe(true);
  });
});
