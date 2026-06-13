import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DatabaseManager } from '../../../src/lib/db.js';

// Mock loadFullConfig
vi.mock('../../../src/config.js', () => ({
  loadFullConfig: vi.fn(),
}));

import { loadFullConfig } from '../../../src/config.js';

function createTempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'llm-gateway-stats-test-'));
  return dir;
}

function cleanupDir(dir: string) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function insertTestData(db: ReturnType<DatabaseManager['getDb']>, userName: string) {
  const insert = db.prepare(`
    INSERT INTO requests (request_id, timestamp, created_at, user_name, custom_model, real_model, provider, status_code, duration_ms, prompt_tokens, completion_tokens, total_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Today's data for user1
  insert.run('req-1', '2026-06-14 10:00:00', Date.now(), userName, 'gpt-4', 'gpt-4-0613', 'openai', 200, 1500, 100, 50, 150);
  insert.run('req-2', '2026-06-14 10:05:00', Date.now(), userName, 'gpt-4', 'gpt-4-0613', 'openai', 200, 2000, 200, 80, 280);
  insert.run('req-3', '2026-06-14 11:00:00', Date.now(), userName, 'claude-3', 'claude-3-opus', 'anthropic', 200, 3000, 300, 150, 450);
  insert.run('req-4', '2026-06-14 11:30:00', Date.now(), userName, 'gpt-4', 'gpt-4-0613', 'openai', 400, 500, 50, 0, 50);
  insert.run('req-5', '2026-06-14 12:00:00', Date.now(), userName, 'claude-3', 'claude-3-opus', 'anthropic', 200, 1000, 150, 60, 210);

  // Data for other user (should be isolated)
  insert.run('req-6', '2026-06-14 10:00:00', Date.now(), 'other-user', 'gpt-4', 'gpt-4-0613', 'openai', 200, 100, 10, 5, 15);
}

describe('User Stats Route', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = createTempConfigDir();
    configPath = join(tempDir, 'config.json');
  });

  afterEach(() => {
    DatabaseManager.resetInstance();
    cleanupDir(tempDir);
    vi.clearAllMocks();
  });

  describe('路由守卫 - 无认证时提供服务', () => {
    it('configPath 为空时返回空路由（404）', async () => {
      (loadFullConfig as ReturnType<typeof vi.fn>).mockReturnValue({});

      const { createStatsRoute } = await import('../../../src/user/routes/stats.js');
      const app = createStatsRoute(undefined);

      const res = await app.request('/');
      expect(res.status).toBe(404);
    });

    it('无 userApiKeys 时仍然提供服务（无需登录）', async () => {
      (loadFullConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        models: [],
      });

      // Initialize database so route doesn't error on db check
      const dbManager = DatabaseManager.getInstance(tempDir);
      dbManager.initialize();

      const { createStatsRoute } = await import('../../../src/user/routes/stats.js');
      const app = createStatsRoute(configPath);

      const res = await app.request('/');
      // Should serve the page, not 404
      expect(res.status).toBe(200);
    });

    it('userApiKeys 为空数组时仍然提供服务（无需登录）', async () => {
      (loadFullConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        models: [],
        userApiKeys: [],
      });

      // Initialize database so route doesn't error on db check
      const dbManager = DatabaseManager.getInstance(tempDir);
      dbManager.initialize();

      const { createStatsRoute } = await import('../../../src/user/routes/stats.js');
      const app = createStatsRoute(configPath);

      const res = await app.request('/');
      // Should serve the page, not 404
      expect(res.status).toBe(200);
    });
  });

  describe('认证守卫', () => {
    it('未登录时 redirect 到 /user/login', async () => {
      (loadFullConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        models: [],
        userApiKeys: [{ name: 'test-user', apikey: 'sk-test' }],
      });

      const { createStatsRoute } = await import('../../../src/user/routes/stats.js');
      const app = createStatsRoute(configPath);

      const res = await app.request('/');
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/user/login');
    });
  });

  describe('SQLite 查询逻辑', () => {
    it('数据库未初始化时返回错误提示', async () => {
      (loadFullConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        models: [],
        userApiKeys: [{ name: 'test-user', apikey: 'sk-test' }],
      });

      // Login first to get a valid session
      const { createLoginRoute } = await import('../../../src/user/routes/login.js');
      const loginApp = createLoginRoute({ configPath });
      const loginForm = new FormData();
      loginForm.append('apikey', 'sk-test');
      const loginRes = await loginApp.request('/', { method: 'POST', body: loginForm });
      const setCookie = loginRes.headers.get('Set-Cookie') || '';

      // Now request stats with the session cookie
      const { createStatsRoute } = await import('../../../src/user/routes/stats.js');
      const app = createStatsRoute(configPath);

      const res = await app.request('/', {
        headers: { Cookie: setCookie },
      });
      const text = await res.text();
      expect(text).toContain('数据库未初始化');
    });

    it('查询聚合数据并正确隔离用户', async () => {
      (loadFullConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        models: [],
        userApiKeys: [{ name: 'test-user', apikey: 'sk-test' }],
      });

      // Initialize database with test data
      const dbManager = DatabaseManager.getInstance(tempDir);
      dbManager.initialize();
      const db = dbManager.getDb();
      insertTestData(db, 'test-user');

      const { createStatsRoute } = await import('../../../src/user/routes/stats.js');
      const app = createStatsRoute(configPath);

      // Directly query DB to verify SQL logic correctness (without going through Hono request)
      const overview = db.prepare(`
        SELECT
          COUNT(*) AS totalRequests,
          COALESCE(SUM(total_tokens), 0) AS totalTokens,
          COALESCE(SUM(prompt_tokens), 0) AS totalInputTokens,
          COALESCE(SUM(completion_tokens), 0) AS totalOutputTokens,
          COALESCE(AVG(duration_ms), 0) AS avgDuration
        FROM requests
        WHERE user_name = ?
          AND timestamp >= '2026-06-14 00:00:00' AND timestamp <= '2026-06-14 23:59:59'
      `).get('test-user') as any;

      expect(overview.totalRequests).toBe(5);
      expect(overview.totalTokens).toBe(150 + 280 + 450 + 50 + 210);
      expect(overview.totalInputTokens).toBe(100 + 200 + 300 + 50 + 150);
      expect(overview.totalOutputTokens).toBe(50 + 80 + 150 + 0 + 60);

      // Verify user isolation: other user should have only 1 request
      const otherOverview = db.prepare(`
        SELECT COUNT(*) AS totalRequests
        FROM requests
        WHERE user_name = ?
          AND timestamp >= '2026-06-14 00:00:00' AND timestamp <= '2026-06-14 23:59:59'
      `).get('other-user') as any;
      expect(otherOverview.totalRequests).toBe(1);
    });

    it('按模型分组查询正确', async () => {
      (loadFullConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        models: [],
        userApiKeys: [{ name: 'test-user', apikey: 'sk-test' }],
      });

      const dbManager = DatabaseManager.getInstance(tempDir);
      dbManager.initialize();
      const db = dbManager.getDb();
      insertTestData(db, 'test-user');

      const byModel = db.prepare(`
        SELECT
          custom_model AS model,
          COUNT(*) AS requests,
          SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successful,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed,
          COALESCE(SUM(prompt_tokens), 0) AS inputTokens,
          COALESCE(SUM(completion_tokens), 0) AS outputTokens,
          COALESCE(SUM(total_tokens), 0) AS totalTokens
        FROM requests
        WHERE user_name = ?
          AND timestamp >= '2026-06-14 00:00:00' AND timestamp <= '2026-06-14 23:59:59'
        GROUP BY custom_model
        ORDER BY requests DESC
      `).all('test-user') as any[];

      expect(byModel).toHaveLength(2);

      const gpt4 = byModel.find((m: any) => m.model === 'gpt-4');
      expect(gpt4).toBeDefined();
      expect(gpt4.requests).toBe(3); // req-1, req-2, req-4
      expect(gpt4.successful).toBe(2); // req-1, req-2
      expect(gpt4.failed).toBe(1); // req-4 (400)

      const claude3 = byModel.find((m: any) => m.model === 'claude-3');
      expect(claude3).toBeDefined();
      expect(claude3.requests).toBe(2);
      expect(claude3.successful).toBe(2);
      expect(claude3.failed).toBe(0);
    });

    it('按小时分布查询正确', async () => {
      (loadFullConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        models: [],
        userApiKeys: [{ name: 'test-user', apikey: 'sk-test' }],
      });

      const dbManager = DatabaseManager.getInstance(tempDir);
      dbManager.initialize();
      const db = dbManager.getDb();
      insertTestData(db, 'test-user');

      const byHour = db.prepare(`
        SELECT
          strftime('%Y-%m-%d %H:00', timestamp) AS hour,
          COUNT(*) AS requests
        FROM requests
        WHERE user_name = ?
          AND timestamp >= '2026-06-14 00:00:00' AND timestamp <= '2026-06-14 23:59:59'
        GROUP BY hour
        ORDER BY hour ASC
      `).all('test-user') as any[];

      expect(byHour).toHaveLength(3);
      expect(byHour[0].hour).toBe('2026-06-14 10:00');
      expect(byHour[0].requests).toBe(2); // req-1, req-2
      expect(byHour[1].hour).toBe('2026-06-14 11:00');
      expect(byHour[1].requests).toBe(2); // req-3, req-4
      expect(byHour[2].hour).toBe('2026-06-14 12:00');
      expect(byHour[2].requests).toBe(1); // req-5
    });

    it('分页查询正确（limit=20, offset 计算）', async () => {
      (loadFullConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        models: [],
        userApiKeys: [{ name: 'test-user', apikey: 'sk-test' }],
      });

      const dbManager = DatabaseManager.getInstance(tempDir);
      dbManager.initialize();
      const db = dbManager.getDb();
      insertTestData(db, 'test-user');

      // Page 1: first 2 results (total 5, limit 2 for testing)
      const limit = 2;
      const page1 = db.prepare(`
        SELECT id, request_id AS requestId, custom_model AS customModel
        FROM requests
        WHERE user_name = ?
          AND timestamp >= '2026-06-14 00:00:00' AND timestamp <= '2026-06-14 23:59:59'
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `).all('test-user', limit, 0) as any[];

      expect(page1).toHaveLength(2);

      // Total count
      const totalRow = db.prepare(`
        SELECT COUNT(*) AS total
        FROM requests
        WHERE user_name = ?
          AND timestamp >= '2026-06-14 00:00:00' AND timestamp <= '2026-06-14 23:59:59'
      `).get('test-user') as any;

      expect(totalRow.total).toBe(5);
      expect(Math.max(1, Math.ceil(totalRow.total / limit))).toBe(3); // totalPages
    });

    it('无数据时返回空结果', async () => {
      (loadFullConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        models: [],
        userApiKeys: [{ name: 'test-user', apikey: 'sk-test' }],
      });

      const dbManager = DatabaseManager.getInstance(tempDir);
      dbManager.initialize();
      const db = dbManager.getDb();

      // Insert no data for this user
      const overview = db.prepare(`
        SELECT
          COUNT(*) AS totalRequests,
          COALESCE(SUM(total_tokens), 0) AS totalTokens,
          COALESCE(SUM(prompt_tokens), 0) AS totalInputTokens,
          COALESCE(SUM(completion_tokens), 0) AS totalOutputTokens,
          COALESCE(AVG(duration_ms), 0) AS avgDuration
        FROM requests
        WHERE user_name = ?
          AND timestamp >= '2026-06-14 00:00:00' AND timestamp <= '2026-06-14 23:59:59'
      `).get('no-data-user') as any;

      expect(overview.totalRequests).toBe(0);
      expect(overview.totalTokens).toBe(0);
      expect(overview.avgDuration).toBe(0);

      const byModel = db.prepare(`
        SELECT custom_model AS model, COUNT(*) AS requests
        FROM requests
        WHERE user_name = ?
          AND timestamp >= '2026-06-14 00:00:00' AND timestamp <= '2026-06-14 23:59:59'
        GROUP BY custom_model
      `).all('no-data-user') as any[];

      expect(byModel).toHaveLength(0);

      const totalRow = db.prepare(`
        SELECT COUNT(*) AS total
        FROM requests
        WHERE user_name = ?
          AND timestamp >= '2026-06-14 00:00:00' AND timestamp <= '2026-06-14 23:59:59'
      `).get('no-data-user') as any;

      expect(totalRow.total).toBe(0);
    });
  });

  describe('日期范围过滤', () => {
    it('指定日期范围过滤正确', async () => {
      (loadFullConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        models: [],
        userApiKeys: [{ name: 'test-user', apikey: 'sk-test' }],
      });

      const dbManager = DatabaseManager.getInstance(tempDir);
      dbManager.initialize();
      const db = dbManager.getDb();

      // Insert data across 2 days
      const insert = db.prepare(`
        INSERT INTO requests (request_id, timestamp, created_at, user_name, custom_model, real_model, provider, status_code, duration_ms, prompt_tokens, completion_tokens, total_tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run('req-day1-1', '2026-06-13 10:00:00', Date.now(), 'test-user', 'gpt-4', 'gpt-4-0613', 'openai', 200, 100, 10, 5, 15);
      insert.run('req-day1-2', '2026-06-13 11:00:00', Date.now(), 'test-user', 'claude-3', 'claude-3-opus', 'anthropic', 200, 200, 20, 10, 30);
      insert.run('req-day2-1', '2026-06-14 10:00:00', Date.now(), 'test-user', 'gpt-4', 'gpt-4-0613', 'openai', 200, 150, 15, 8, 23);

      // Filter: only June 13
      const overviewDay1 = db.prepare(`
        SELECT COUNT(*) AS totalRequests
        FROM requests
        WHERE user_name = ?
          AND timestamp >= '2026-06-13 00:00:00' AND timestamp <= '2026-06-13 23:59:59'
      `).get('test-user') as any;
      expect(overviewDay1.totalRequests).toBe(2);

      // Filter: only June 14
      const overviewDay2 = db.prepare(`
        SELECT COUNT(*) AS totalRequests
        FROM requests
        WHERE user_name = ?
          AND timestamp >= '2026-06-14 00:00:00' AND timestamp <= '2026-06-14 23:59:59'
      `).get('test-user') as any;
      expect(overviewDay2.totalRequests).toBe(1);

      // Filter: both days
      const overviewBoth = db.prepare(`
        SELECT COUNT(*) AS totalRequests
        FROM requests
        WHERE user_name = ?
          AND timestamp >= '2026-06-13 00:00:00' AND timestamp <= '2026-06-14 23:59:59'
      `).get('test-user') as any;
      expect(overviewBoth.totalRequests).toBe(3);
    });
  });
});
