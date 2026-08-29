import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DatabaseManager } from '../../../src/lib/db.js';
import { createStatsRoute } from '../../../src/admin/routes/stats.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'llm-gateway-admin-stats-'));
}

function cleanupDir(dir: string) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function insertStreaming(db: ReturnType<DatabaseManager['getDb']>, requestId: string, ts: string, ttftMs: number | null, tps: number | null, isStreaming = 1) {
  db.prepare(`
    INSERT INTO requests
      (request_id, timestamp, created_at, user_name, custom_model, real_model, provider,
       status_code, duration_ms, is_streaming, ttft_ms, tps,
       prompt_tokens, completion_tokens, total_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    requestId, ts, Date.now(), 'alice', 'gpt-4', 'gpt-4-0613', 'openai',
    200, 5000, isStreaming, ttftMs, tps,
    100, 50, 150,
  );
}

describe('Admin Stats Route — AVG TTFT / TPS', () => {
  let tempDir: string;
  let app: ReturnType<typeof createStatsRoute>;

  beforeEach(() => {
    tempDir = createTempDir();
    DatabaseManager.resetInstance();
    const dbManager = DatabaseManager.getInstance(tempDir);
    dbManager.initialize();
    app = createStatsRoute();
  });

  afterEach(() => {
    DatabaseManager.resetInstance();
    cleanupDir(tempDir);
  });

  it('should aggregate avg ttft_ms and avg tps only for streaming requests', async () => {
    const db = DatabaseManager.getExistingInstance()!.getDb();
    // 3 条流式
    insertStreaming(db, 'r1', '2026-08-29T02:00:00.000Z', 200, 25.0);
    insertStreaming(db, 'r2', '2026-08-29T02:05:00.000Z', 400, 35.0);
    insertStreaming(db, 'r3', '2026-08-29T02:10:00.000Z', 600, 45.0);
    // 1 条流式但 ttft_ms/tps 为 null — 不应纳入分母
    insertStreaming(db, 'r4', '2026-08-29T02:15:00.000Z', null, null);
    // 1 条非流式 — 不应纳入
    insertStreaming(db, 'r5', '2026-08-29T02:20:00.000Z', 999, 99, 0);

    const res = await app.request('/admin/stats?startDate=2026-08-29&endDate=2026-08-29&timezone=UTC');
    const html = await res.text();
    // 平均 TTFT = (200+400+600)/3 = 400 → "400ms"
    expect(html).toContain('400ms');
    // 平均 TPS = (25+35+45)/3 = 35.0 → "35.0 tok/s"
    expect(html).toContain('35.0 tok/s');
  });

  it('should show empty pill when no streaming requests with ttft in range', async () => {
    const db = DatabaseManager.getExistingInstance()!.getDb();
    // 1 条非流式请求
    insertStreaming(db, 'r1', '2026-08-29T02:00:00.000Z', null, null, 0);

    const res = await app.request('/admin/stats?startDate=2026-08-29&endDate=2026-08-29&timezone=UTC');
    const html = await res.text();
    // 非流式则展示 "仅流式请求可计算"
    expect(html).toContain('仅流式请求可计算');
    // 不应有平均值 pill
    expect(html).not.toContain('平均 TTFT');
    expect(html).not.toContain('平均 TPS');
  });

  it('should respect user filter when averaging', async () => {
    const db = DatabaseManager.getExistingInstance()!.getDb();
    insertStreaming(db, 'a1', '2026-08-29T02:00:00.000Z', 100, 10, 1);
    insertStreaming(db, 'a2', '2026-08-29T02:01:00.000Z', 300, 30, 1);
    // 别的用户
    db.prepare(`
      INSERT INTO requests
        (request_id, timestamp, created_at, user_name, custom_model, real_model, provider,
         status_code, duration_ms, is_streaming, ttft_ms, tps)
      VALUES ('b1', '2026-08-29T02:00:00.000Z', ?, 'bob', 'gpt-4', 'gpt-4', 'openai', 200, 5000, 1, 9999, 99)
    `).run(Date.now());

    const res = await app.request('/admin/stats?startDate=2026-08-29&endDate=2026-08-29&timezone=UTC&userName=alice');
    const html = await res.text();
    // alice 自己的均值 TTFT = 200ms, TPS = 20.0
    expect(html).toContain('200ms');
    expect(html).toContain('20.0 tok/s');
    // bob 的 9999 / 99 不应该出现
    expect(html).not.toContain('9999ms');
    expect(html).not.toContain('99.0 tok/s');
  });
});
