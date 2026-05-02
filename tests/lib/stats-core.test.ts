import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import Database from 'better-sqlite3';
import { loadStats, getHourlyBreakdown, getDailyBreakdown, createEmptyModelStats, addEntryToStats } from '../../src/lib/stats-core.js';
import type { StatsEntry } from '../../src/lib/types/stats.js';

const testDir = '/tmp/llm-gateway-test-stats-core';

function setupDb(): Database.Database {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });

  const db = new Database(`${testDir}/test.db`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT UNIQUE NOT NULL,
      timestamp TEXT NOT NULL,
      custom_model TEXT,
      real_model TEXT,
      provider TEXT,
      endpoint TEXT,
      status_code INTEGER,
      duration_ms INTEGER,
      is_streaming INTEGER,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      cached_tokens INTEGER,
      user_name TEXT,
      model_group TEXT,
      actual_model TEXT,
      error_message TEXT,
      error_type TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_timestamp ON requests(timestamp)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_custom_model ON requests(custom_model)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_name ON requests(user_name)`);
  return db;
}

function insertEntry(db: Database.Database, entry: {
  requestId?: string;
  timestamp: string;
  customModel: string;
  provider?: string;
  statusCode: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  userName?: string;
}) {
  db.prepare(`
    INSERT INTO requests (request_id, timestamp, custom_model, provider, status_code, prompt_tokens, completion_tokens, total_tokens, cached_tokens, user_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.requestId || `req-${Date.now()}-${Math.random()}`,
    entry.timestamp,
    entry.customModel,
    entry.provider || null,
    entry.statusCode,
    entry.promptTokens || 0,
    entry.completionTokens || 0,
    entry.totalTokens || 0,
    entry.cachedTokens || 0,
    entry.userName || null,
    Date.now()
  );
}

describe('stats-core with SQLite', () => {
  let db: Database.Database;

  beforeEach(() => { db = setupDb(); });
  afterEach(() => { db.close(); if (existsSync(testDir)) rmSync(testDir, { recursive: true }); });

  it('should return empty stats when no data', () => {
    const stats = loadStats(db);
    expect(stats.totalRequests).toBe(0);
    expect(stats.successfulRequests).toBe(0);
    expect(stats.failedRequests).toBe(0);
    expect(Object.keys(stats.byModel)).toEqual([]);
    expect(Object.keys(stats.byProvider)).toEqual([]);
  });

  it('should aggregate stats by model', () => {
    const today = new Date().toISOString().split('T')[0];
    insertEntry(db, { timestamp: `${today}T10:00:00Z`, customModel: 'gpt-4', provider: 'openai', statusCode: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    insertEntry(db, { timestamp: `${today}T11:00:00Z`, customModel: 'gpt-4', provider: 'openai', statusCode: 200, promptTokens: 200, completionTokens: 100, totalTokens: 300 });
    insertEntry(db, { timestamp: `${today}T12:00:00Z`, customModel: 'claude-3', provider: 'anthropic', statusCode: 200, promptTokens: 300, completionTokens: 150, totalTokens: 450 });

    const stats = loadStats(db);
    expect(stats.totalRequests).toBe(3);
    expect(stats.successfulRequests).toBe(3);
    expect(stats.byModel['gpt-4'].requests).toBe(2);
    expect(stats.byModel['gpt-4'].inputTokens).toBe(300);
    expect(stats.byModel['gpt-4'].outputTokens).toBe(150);
    expect(stats.byModel['claude-3'].requests).toBe(1);
    expect(stats.byModel['claude-3'].inputTokens).toBe(300);
  });

  it('should aggregate stats by provider', () => {
    const today = new Date().toISOString().split('T')[0];
    insertEntry(db, { timestamp: `${today}T10:00:00Z`, customModel: 'gpt-4', provider: 'openai', statusCode: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    insertEntry(db, { timestamp: `${today}T11:00:00Z`, customModel: 'gpt-3.5', provider: 'openai', statusCode: 200, promptTokens: 200, completionTokens: 100, totalTokens: 300 });
    insertEntry(db, { timestamp: `${today}T12:00:00Z`, customModel: 'claude-3', provider: 'anthropic', statusCode: 200, promptTokens: 300, completionTokens: 150, totalTokens: 450 });

    const stats = loadStats(db);
    expect(stats.byProvider['openai'].requests).toBe(2);
    expect(stats.byProvider['openai'].inputTokens).toBe(300);
    expect(stats.byProvider['anthropic'].requests).toBe(1);
    expect(stats.byProvider['anthropic'].inputTokens).toBe(300);
  });

  it('should count failed requests (status >= 400)', () => {
    const today = new Date().toISOString().split('T')[0];
    insertEntry(db, { timestamp: `${today}T10:00:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    insertEntry(db, { timestamp: `${today}T11:00:00Z`, customModel: 'gpt-4', statusCode: 500, promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    insertEntry(db, { timestamp: `${today}T12:00:00Z`, customModel: 'gpt-4', statusCode: 429, promptTokens: 0, completionTokens: 0, totalTokens: 0 });

    const stats = loadStats(db);
    expect(stats.totalRequests).toBe(3);
    expect(stats.successfulRequests).toBe(1);
    expect(stats.failedRequests).toBe(2);
  });

  it('should filter by userName', () => {
    const today = new Date().toISOString().split('T')[0];
    insertEntry(db, { timestamp: `${today}T10:00:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150, userName: 'alice' });
    insertEntry(db, { timestamp: `${today}T11:00:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 200, completionTokens: 100, totalTokens: 300, userName: 'bob' });

    const stats = loadStats(db, { userName: 'alice' });
    expect(stats.totalRequests).toBe(1);
    expect(stats.totalInputTokens).toBe(100);
  });

  it('should return empty stats when userName has no entries', () => {
    const today = new Date().toISOString().split('T')[0];
    insertEntry(db, { timestamp: `${today}T10:00:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150, userName: 'alice' });

    const stats = loadStats(db, { userName: 'nonexistent' });
    expect(stats.totalRequests).toBe(0);
  });

  it('should aggregate cached tokens', () => {
    const today = new Date().toISOString().split('T')[0];
    insertEntry(db, { timestamp: `${today}T10:00:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150, cachedTokens: 80 });
    insertEntry(db, { timestamp: `${today}T11:00:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 200, completionTokens: 100, totalTokens: 300, cachedTokens: 150 });

    const stats = loadStats(db);
    expect(stats.totalCachedTokens).toBe(230);
    expect(stats.byModel['gpt-4'].cachedTokens).toBe(230);
  });

  it('should get hourly breakdown', () => {
    const today = new Date().toISOString().split('T')[0];
    insertEntry(db, { timestamp: `${today}T10:15:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    insertEntry(db, { timestamp: `${today}T10:45:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 200, completionTokens: 100, totalTokens: 300 });
    insertEntry(db, { timestamp: `${today}T11:30:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 300, completionTokens: 150, totalTokens: 450 });

    const hourly = getHourlyBreakdown(db);
    expect(hourly.length).toBe(2);
    expect(hourly[0].stats.requests).toBe(2);
    expect(hourly[1].stats.requests).toBe(1);
  });

  it('should get daily breakdown for current period', () => {
    const today = new Date().toISOString().split('T')[0];
    insertEntry(db, { timestamp: `${today}T10:00:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    insertEntry(db, { timestamp: `${today}T14:00:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 200, completionTokens: 100, totalTokens: 300 });

    const daily = getDailyBreakdown(db);
    expect(daily.length).toBe(1);
    expect(daily[0].date).toBe(today);
    expect(daily[0].stats.requests).toBe(2);
    expect(daily[0].stats.totalTokens).toBe(450);
  });

  it('should get daily breakdown for week', () => {
    const today = new Date().toISOString().split('T')[0];
    // Insert entries for today (which should be within the current week)
    insertEntry(db, { timestamp: `${today}T10:00:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150 });

    const daily = getDailyBreakdown(db, { week: '2025-W01' });
    // The week option will use current week's range from period-utils
    // Data from today should be within the current week range
    expect(daily.length).toBeGreaterThanOrEqual(1);
    expect(daily.some(d => d.stats.requests > 0)).toBe(true);
  });

  it('createEmptyModelStats returns zeroed stats', () => {
    const empty = createEmptyModelStats();
    expect(empty.requests).toBe(0);
    expect(empty.successful).toBe(0);
    expect(empty.failed).toBe(0);
    expect(empty.inputTokens).toBe(0);
    expect(empty.outputTokens).toBe(0);
    expect(empty.totalTokens).toBe(0);
    expect(empty.cachedTokens).toBe(0);
  });

  it('addEntryToStats correctly updates model stats', () => {
    const modelStats = createEmptyModelStats();
    const entry: StatsEntry = {
      timestamp: new Date().toISOString(),
      customModel: 'gpt-4',
      statusCode: 200,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedTokens: 80
    };

    addEntryToStats(modelStats, entry);
    expect(modelStats.requests).toBe(1);
    expect(modelStats.successful).toBe(1);
    expect(modelStats.failed).toBe(0);
    expect(modelStats.inputTokens).toBe(100);
    expect(modelStats.outputTokens).toBe(50);
    expect(modelStats.totalTokens).toBe(150);
    expect(modelStats.cachedTokens).toBe(80);
  });

  it('addEntryToStats counts failed requests correctly', () => {
    const modelStats = createEmptyModelStats();

    addEntryToStats(modelStats, { timestamp: new Date().toISOString(), customModel: 'gpt-4', statusCode: 500 });
    addEntryToStats(modelStats, { timestamp: new Date().toISOString(), customModel: 'gpt-4', statusCode: 429 });

    expect(modelStats.requests).toBe(2);
    expect(modelStats.successful).toBe(0);
    expect(modelStats.failed).toBe(2);
  });

  it('addEntryToStats handles missing token fields', () => {
    const modelStats = createEmptyModelStats();

    addEntryToStats(modelStats, { timestamp: new Date().toISOString(), customModel: 'gpt-4', statusCode: 200 });

    expect(modelStats.requests).toBe(1);
    expect(modelStats.successful).toBe(1);
    expect(modelStats.inputTokens).toBe(0);
    expect(modelStats.outputTokens).toBe(0);
  });

  it('should filter by userName with hourly breakdown', () => {
    const today = new Date().toISOString().split('T')[0];
    insertEntry(db, { timestamp: `${today}T10:15:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150, userName: 'alice' });
    insertEntry(db, { timestamp: `${today}T10:45:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 200, completionTokens: 100, totalTokens: 300, userName: 'bob' });

    const hourly = getHourlyBreakdown(db, { userName: 'alice' });
    expect(hourly.length).toBe(1);
    expect(hourly[0].stats.requests).toBe(1);
  });

  it('should filter by userName with daily breakdown', () => {
    const today = new Date().toISOString().split('T')[0];
    insertEntry(db, { timestamp: `${today}T10:00:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150, userName: 'alice' });
    insertEntry(db, { timestamp: `${today}T14:00:00Z`, customModel: 'gpt-4', statusCode: 200, promptTokens: 200, completionTokens: 100, totalTokens: 300, userName: 'bob' });

    const daily = getDailyBreakdown(db, { userName: 'alice' });
    expect(daily.length).toBe(1);
    expect(daily[0].stats.requests).toBe(1);
    expect(daily[0].stats.totalTokens).toBe(150);
  });
});
