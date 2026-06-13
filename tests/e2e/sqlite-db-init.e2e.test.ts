import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import { DatabaseManager } from '../../src/lib/db.js';
import { createConfigContext } from '../../src/lib/config-context.js';
import type { ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'fs';

const PORT = 4299;
const BASE_URL = `http://localhost:${PORT}`;

describe('SQLite DB init E2E', () => {
  let app: Hono;
  let testDir: string;

  beforeAll(() => {
    // 使用临时目录模拟 ~/.llm-gateway 的生产路径
    testDir = join(tmpdir(), 'llm-gateway-e2e-db-' + Date.now());

    // 创建 config.json（auth 中间件运行时需要加载配置文件）
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({ models: [], userApiKeys: [] }));

    const testConfig: ProxyConfig = {
      models: [
        {
          customModel: 'test-model',
          realModel: 'gpt-4',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com/v1',
          provider: 'openai',
        },
      ],
    };

    const logger = new Logger(testDir);
    const detailLogger = new DetailLogger(testDir);
    app = createServer(testConfig, logger, detailLogger, 30000, testDir);
  });

  afterAll(() => {
    // 清理：关闭 DB 连接，删除整个测试目录
    try {
      DatabaseManager.getInstance(testDir).close();
    } catch { /* ignore */ }
    DatabaseManager.resetInstance();
    const server = (app as any).server;
    if (server) server.close();
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should create gateway.db after server starts', async () => {
    const ctx = createConfigContext(testDir);
    const dbPath = join(ctx.logDir, 'gateway.db');
    expect(existsSync(dbPath)).toBe(true);
  });

  it('should have requests table with correct columns', async () => {
    const dm = DatabaseManager.getInstance(testDir);
    const db = dm.getDb();
    const cols = db.prepare('PRAGMA table_info(requests)').all() as any[];
    const colNames = cols.map(c => c.name);

    expect(colNames).toContain('request_id');
    expect(colNames).toContain('timestamp');
    expect(colNames).toContain('user_name');
    expect(colNames).toContain('custom_model');
    expect(colNames).toContain('real_model');
    expect(colNames).toContain('provider');
    expect(colNames).toContain('model_group');
    expect(colNames).toContain('actual_model');
    expect(colNames).toContain('status_code');
    expect(colNames).toContain('duration_ms');
    expect(colNames).toContain('is_streaming');
    expect(colNames).toContain('prompt_tokens');
    expect(colNames).toContain('completion_tokens');
    expect(colNames).toContain('total_tokens');
    expect(colNames).toContain('cached_tokens');
    expect(colNames).toContain('error_message');
    expect(colNames).toContain('error_type');
    expect(colNames).toContain('response_metadata');
  });

  it('should have correct PRAGMA settings (WAL mode)', async () => {
    const dm = DatabaseManager.getInstance(createConfigContext(testDir).logDir);
    const db = dm.getDb();
    const journalMode = db.prepare('PRAGMA journal_mode').get() as any;
    expect(journalMode.journal_mode.toLowerCase()).toBe('wal');
  });
});
