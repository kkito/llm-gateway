import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DatabaseManager } from '../../../src/lib/db.js';
import { createStatsRoute } from '../../../src/admin/routes/stats.js';
import { createStatsApiRoute } from '../../../src/admin/routes/stats-api.js';
import { utcToLocalDate, addLocalDays } from '../../../src/lib/time-utils.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'llm-gateway-heatmap-'));
}

function cleanupDir(dir: string) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function insert(db: ReturnType<DatabaseManager['getDb']>, requestId: string, ts: string, tokens: number) {
  db.prepare(`
    INSERT INTO requests
      (request_id, timestamp, created_at, user_name, custom_model, real_model, provider,
       status_code, duration_ms, prompt_tokens, completion_tokens, total_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(requestId, ts, Date.now(), 'alice', 'gpt-4', 'gpt-4', 'openai', 200, 1000, tokens, 0, tokens);
}

describe('每日 Token 热力图', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    DatabaseManager.resetInstance();
    DatabaseManager.getInstance(tempDir).initialize();
  });

  afterEach(() => {
    DatabaseManager.resetInstance();
    cleanupDir(tempDir);
  });

  it('utcToLocalDate 按本地时区归属日期（跨天边界）', () => {
    // 2026-08-29T02:00Z 在 Asia/Shanghai 是 08-29 10:00，在 America/New_York 是 08-28 22:00
    expect(utcToLocalDate('2026-08-29T02:00:00.000Z', 'Asia/Shanghai')).toBe('2026-08-29');
    expect(utcToLocalDate('2026-08-29T02:00:00.000Z', 'America/New_York')).toBe('2026-08-28');
    expect(utcToLocalDate('2026-08-29T02:00:00.000Z', 'UTC')).toBe('2026-08-29');
    expect(utcToLocalDate('2026-08-29T02:00:00.000Z', 'Invalid/Zone')).toBe('2026-08-29');
  });

  it('addLocalDays 纯日历加减天（含跨月）', () => {
    expect(addLocalDays('2026-08-29', 1)).toBe('2026-08-30');
    expect(addLocalDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addLocalDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('admin 页面渲染热力图区块并聚合当日 token', async () => {
    const db = DatabaseManager.getExistingInstance()!.getDb();
    insert(db, 'h1', '2026-08-29T02:00:00.000Z', 100);
    insert(db, 'h2', '2026-08-29T03:00:00.000Z', 200);

    const app = createStatsRoute();
    const res = await app.request('/admin/stats?startDate=2026-08-29&endDate=2026-08-29&timezone=UTC');
    const html = await res.text();
    expect(html).toContain('每日 Token 消耗');
    expect(html).toContain('heatmap-grid');
    // 2026-08-29 当日共 300 tokens
    expect(html).toContain('active days');
    expect(html).toContain('300');
  });

  it('admin stats API 返回 byDate 按天聚合', async () => {
    const db = DatabaseManager.getExistingInstance()!.getDb();
    insert(db, 'a1', '2026-08-29T02:00:00.000Z', 100);
    insert(db, 'a2', '2026-08-30T02:00:00.000Z', 50);

    const app = createStatsApiRoute();
    const res = await app.request('/admin/api/stats?startDate=2026-08-29&endDate=2026-08-30&timezone=UTC');
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.byDate['2026-08-29'].requests).toBe(1);
    expect(json.data.byDate['2026-08-29'].totalTokens).toBe(100);
    expect(json.data.byDate['2026-08-30'].totalTokens).toBe(50);
  });
});
