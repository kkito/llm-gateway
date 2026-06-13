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
