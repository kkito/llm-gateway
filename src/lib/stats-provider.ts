import { UsageTracker } from './usage-tracker.js';
import { loadStats, getHourlyBreakdown, getDailyBreakdown, createEmptyModelStats } from './stats-core.js';
import type { Stats, StatsOptions, ModelStats } from './types/stats.js';
import type { DatabaseManager } from './db.js';

// Re-export for backward compatibility
export type { Stats, StatsOptions, ModelStats };

/**
 * StatsProvider - SQLite-backed stats provider
 * Delegates all stats loading to stats-core functions.
 * Keeps UsageTracker reference for sliding window cleanup.
 */
export class StatsProvider {
  private dbManager: DatabaseManager;
  private tracker: UsageTracker;

  constructor(dbManager: DatabaseManager, tracker: UsageTracker) {
    this.dbManager = dbManager;
    this.tracker = tracker;
  }

  /**
   * Get stats from SQLite
   */
  async getStats(options: StatsOptions = {}): Promise<Stats> {
    const db = this.dbManager.getDb();
    return loadStats(db, options);
  }

  /**
   * Get hourly breakdown
   */
  async getHourlyStats(options: StatsOptions = {}): Promise<Array<{ hour: string; stats: ModelStats }>> {
    const db = this.dbManager.getDb();
    return getHourlyBreakdown(db, { ...options, byHour: true });
  }

  /**
   * Get daily breakdown for week/month views
   */
  async getDailyStats(options: StatsOptions = {}): Promise<Array<{ date: string; stats: ModelStats }>> {
    const db = this.dbManager.getDb();
    return getDailyBreakdown(db, options);
  }

  /**
   * Preload counters (for rate limiter warm-up)
   * Now a no-op since stats come directly from DB
   */
  async ensureCountersLoaded(_models: string[]): Promise<void> {
    // No-op — stats are read directly from SQLite
  }

  /**
   * Cleanup — delegates to UsageTracker for sliding window cleanup
   */
  cleanup(): void {
    this.tracker.cleanupSlidingWindows();
  }

  /**
   * Get logDir for backward compatibility (returns empty string now)
   */
  getLogDir(): string {
    return '';
  }
}
