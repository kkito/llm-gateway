import Database from 'better-sqlite3';
import type { StatsEntry, ModelStats, Stats, StatsOptions } from './types/stats.js';
import { getTodayDate, getWeekStart, getMonthStart, getPeriodRange } from './period-utils.js';

// Re-export types for backward compatibility
export type { StatsEntry, ModelStats, Stats, StatsOptions };

/**
 * Convert a YYYY-MM-DD date to a timestamp range end that includes the full day
 */
function endOfDay(dateStr: string): string {
  return `${dateStr}T23:59:59Z`;
}

/**
 * Load stats from SQLite database
 */
export function loadStats(db: Database.Database, options: StatsOptions = {}): Stats {
  const periodType = options.week ? 'week' : options.month ? 'month' : 'day';
  const { start, end } = getPeriodRange(periodType);

  // If a specific date is requested, narrow to that single day
  let startDate = start;
  let endDate = options.date ? options.date : end;

  const tsStart = startDate;
  const tsEnd = endOfDay(endDate);

  const userNameFilter = options.userName ? 'AND user_name = ?' : '';
  const params = options.userName ? [tsStart, tsEnd, options.userName] : [tsStart, tsEnd];

  const rows = db.prepare(`
    SELECT
      custom_model,
      provider,
      COUNT(*) as requests,
      SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as failed,
      COALESCE(SUM(prompt_tokens), 0) as inputTokens,
      COALESCE(SUM(completion_tokens), 0) as outputTokens,
      COALESCE(SUM(total_tokens), 0) as totalTokens,
      COALESCE(SUM(cached_tokens), 0) as cachedTokens
    FROM requests
    WHERE timestamp >= ? AND timestamp <= ? ${userNameFilter}
    GROUP BY custom_model, provider
  `).all(...params) as Array<{
    custom_model: string;
    provider: string | null;
    requests: number;
    successful: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedTokens: number;
  }>;

  const stats: Stats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    byModel: {},
    byProvider: {},
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalCachedTokens: 0
  };

  for (const row of rows) {
    const modelStats: ModelStats = {
      requests: row.requests,
      successful: row.successful,
      failed: row.failed,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      cachedTokens: row.cachedTokens
    };

    stats.byModel[row.custom_model] = modelStats;
    stats.totalRequests += modelStats.requests;
    stats.successfulRequests += modelStats.successful;
    stats.failedRequests += modelStats.failed;
    stats.totalInputTokens += modelStats.inputTokens;
    stats.totalOutputTokens += modelStats.outputTokens;
    stats.totalTokens += modelStats.totalTokens;
    stats.totalCachedTokens += modelStats.cachedTokens;

    // By provider
    if (row.provider) {
      if (!stats.byProvider[row.provider]) {
        stats.byProvider[row.provider] = {
          requests: 0, successful: 0, failed: 0,
          inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0
        };
      }
      stats.byProvider[row.provider].requests += modelStats.requests;
      stats.byProvider[row.provider].successful += modelStats.successful;
      stats.byProvider[row.provider].failed += modelStats.failed;
      stats.byProvider[row.provider].inputTokens += modelStats.inputTokens;
      stats.byProvider[row.provider].outputTokens += modelStats.outputTokens;
      stats.byProvider[row.provider].totalTokens += modelStats.totalTokens;
      stats.byProvider[row.provider].cachedTokens += modelStats.cachedTokens;
    }
  }

  return stats;
}

/**
 * Get hourly breakdown for a date range
 */
export function getHourlyBreakdown(db: Database.Database, options: StatsOptions = {}): Array<{ hour: string; stats: ModelStats }> {
  const dateStr = options.date || getTodayDate();
  const tsStart = dateStr;
  const tsEnd = endOfDay(dateStr);

  const userNameFilter = options.userName ? 'AND user_name = ?' : '';
  const params = options.userName ? [tsStart, tsEnd, options.userName] : [tsStart, tsEnd];

  const rows = db.prepare(`
    SELECT
      substr(timestamp, 1, 13) as hour,
      COUNT(*) as requests,
      SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as failed,
      COALESCE(SUM(prompt_tokens), 0) as inputTokens,
      COALESCE(SUM(completion_tokens), 0) as outputTokens,
      COALESCE(SUM(total_tokens), 0) as totalTokens,
      COALESCE(SUM(cached_tokens), 0) as cachedTokens
    FROM requests
    WHERE timestamp >= ? AND timestamp <= ? ${userNameFilter}
    GROUP BY hour
    ORDER BY hour
  `).all(...params) as Array<{
    hour: string;
    requests: number;
    successful: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedTokens: number;
  }>;

  return rows.map(row => ({
    hour: row.hour + ':00',
    stats: {
      requests: row.requests,
      successful: row.successful,
      failed: row.failed,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      cachedTokens: row.cachedTokens
    }
  }));
}

/**
 * Get daily breakdown for a week or month
 */
export function getDailyBreakdown(db: Database.Database, options: StatsOptions = {}): Array<{ date: string; stats: ModelStats }> {
  const periodType = options.week ? 'week' : options.month ? 'month' : 'day';
  const { start, end } = getPeriodRange(periodType);

  const tsStart = start;
  const tsEnd = endOfDay(end);

  const userNameFilter = options.userName ? 'AND user_name = ?' : '';
  const params = options.userName ? [tsStart, tsEnd, options.userName] : [tsStart, tsEnd];

  const rows = db.prepare(`
    SELECT
      substr(timestamp, 1, 10) as date,
      COUNT(*) as requests,
      SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as failed,
      COALESCE(SUM(prompt_tokens), 0) as inputTokens,
      COALESCE(SUM(completion_tokens), 0) as outputTokens,
      COALESCE(SUM(total_tokens), 0) as totalTokens,
      COALESCE(SUM(cached_tokens), 0) as cachedTokens
    FROM requests
    WHERE timestamp >= ? AND timestamp <= ? ${userNameFilter}
    GROUP BY date
    ORDER BY date
  `).all(...params) as Array<{
    date: string;
    requests: number;
    successful: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedTokens: number;
  }>;

  return rows.map(row => ({
    date: row.date,
    stats: {
      requests: row.requests,
      successful: row.successful,
      failed: row.failed,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      cachedTokens: row.cachedTokens
    }
  }));
}

// Keep these utilities for backward compatibility
export function createEmptyModelStats(): ModelStats {
  return {
    requests: 0, successful: 0, failed: 0,
    inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0
  };
}

export function addEntryToStats(modelStats: ModelStats, entry: StatsEntry): void {
  modelStats.requests += 1;
  if (entry.statusCode >= 200 && entry.statusCode < 300) modelStats.successful += 1;
  if (entry.statusCode >= 400) modelStats.failed += 1;
  if (entry.promptTokens) modelStats.inputTokens += entry.promptTokens;
  if (entry.completionTokens) modelStats.outputTokens += entry.completionTokens;
  if (entry.totalTokens) modelStats.totalTokens += entry.totalTokens;
  if (entry.cachedTokens) modelStats.cachedTokens += entry.cachedTokens;
}
