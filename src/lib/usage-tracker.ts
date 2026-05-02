import type { Database } from 'better-sqlite3';
import type { DatabaseManager } from './db.js';
import type { LogEntry } from '../logger.js';
import type { ModelLimit } from '../config.js';
import { getTodayDate, getWeekStart, getMonthStart, getPeriodRange } from './period-utils.js';
import { calculateCost, type Pricing } from './cost-calculator.js';
import type { SlidingWindowEntry, SlidingWindowCounter, ModelUsageCounter, ParsedLogEntry } from './types/usage.js';

// Re-export for backward compatibility
export type { SlidingWindowEntry, SlidingWindowCounter, ModelUsageCounter, ParsedLogEntry };

/**
 * 用量追踪器类
 */
export class UsageTracker {
  private static instance: UsageTracker | null = null;
  private counters: Map<string, ModelUsageCounter> = new Map();
  private dbManager: DatabaseManager;

  private constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  /**
   * 获取单例实例
   */
  static getInstance(dbManager: DatabaseManager): UsageTracker {
    if (!UsageTracker.instance) {
      UsageTracker.instance = new UsageTracker(dbManager);
    }
    if (UsageTracker.instance.dbManager !== dbManager) {
      throw new Error('DatabaseManager mismatch');
    }
    return UsageTracker.instance;
  }

  /**
   * 重置单例实例（用于测试）
   */
  static resetInstance(): void {
    UsageTracker.instance = null;
  }

  /**
   * 创建空计数器
   */
  private createEmptyCounter(model: string): ModelUsageCounter {
    return {
      model,
      lastChecked: Date.now(),
      today: {
        date: getTodayDate(),
        requests: 0,
        inputTokens: 0,
        cost: 0,
        loaded: false
      },
      thisWeek: {
        weekStart: getWeekStart(),
        requests: 0,
        inputTokens: 0,
        cost: 0,
        loaded: false
      },
      thisMonth: {
        month: getMonthStart(),
        requests: 0,
        inputTokens: 0,
        cost: 0,
        loaded: false
      },
      slidingWindows: new Map()
    };
  }

  /**
   * 获取或创建计数器
   */
  getCounter(model: string): ModelUsageCounter {
    let counter = this.counters.get(model);
    if (!counter) {
      counter = this.createEmptyCounter(model);
      this.counters.set(model, counter);
    }
    return counter;
  }

  /**
   * 从 SQLite 数据库加载用量
   */
  private loadFromDb(
    counter: ModelUsageCounter,
    period: 'day' | 'hours' | 'week' | 'month',
    periodValue: number | undefined,
    pricing: Pricing | undefined
  ): void {
    let db: Database.Database;
    try {
      db = this.dbManager.getDb();
    } catch {
      // Database not initialized; leave counters at zero
      return;
    }

    const dateRange = getPeriodRange(period, periodValue);
    // Convert YYYY-MM-DD dates to ISO timestamps for proper comparison with timestamp column
    const startTs = dateRange.start + 'T00:00:00.000Z';
    const endTs = dateRange.end + 'T23:59:59.999Z';

    const rows = db.prepare(`
      SELECT
        COUNT(*) as requests,
        COALESCE(SUM(prompt_tokens), 0) as inputTokens
      FROM requests
      WHERE timestamp >= ? AND timestamp <= ?
        AND custom_model = ?
        AND status_code >= 200 AND status_code < 300
    `).get(startTs, endTs, counter.model) as { requests: number; inputTokens: number };

    const requests = rows.requests;
    const inputTokens = rows.inputTokens;
    let cost = 0;

    // Calculate cost if pricing is available
    if (pricing) {
      const totalTokensRow = db.prepare(`
        SELECT
          COALESCE(SUM(prompt_tokens), 0) as totalInput,
          COALESCE(SUM(completion_tokens), 0) as totalOutput,
          COALESCE(SUM(cached_tokens), 0) as totalCached
        FROM requests
        WHERE timestamp >= ? AND timestamp <= ?
          AND custom_model = ?
          AND status_code >= 200 AND status_code < 300
      `).get(startTs, endTs, counter.model) as { totalInput: number; totalOutput: number; totalCached: number };

      cost = calculateCost(
        {
          inputTokens: totalTokensRow.totalInput,
          outputTokens: totalTokensRow.totalOutput,
          cachedTokens: totalTokensRow.totalCached
        },
        pricing
      );
    }

    // Update counter
    const today = getTodayDate();
    const weekStart = getWeekStart();
    const monthStart = getMonthStart();

    if (period === 'day') {
      counter.today = {
        date: today,
        requests,
        inputTokens,
        cost,
        loaded: true
      };
    }

    if (period === 'week') {
      counter.thisWeek = {
        weekStart,
        requests,
        inputTokens,
        cost,
        loaded: true
      };
    }

    if (period === 'month') {
      counter.thisMonth = {
        month: monthStart,
        requests,
        inputTokens,
        cost,
        loaded: true
      };
    }

    if (period === 'hours') {
      const windowHours = periodValue || 24;
      const cutoff = Date.now() / 1000 - (windowHours * 3600);

      const slidingRows = db.prepare(`
        SELECT
          prompt_tokens,
          completion_tokens,
          cached_tokens,
          timestamp
        FROM requests
        WHERE timestamp >= ? AND timestamp <= ?
          AND custom_model = ?
          AND status_code >= 200 AND status_code < 300
      `).all(
        new Date(cutoff * 1000).toISOString(),
        new Date().toISOString(),
        counter.model
      ) as { prompt_tokens: number; completion_tokens: number; cached_tokens: number; timestamp: string }[];

      const slidingEntries: SlidingWindowEntry[] = slidingRows.map(row => ({
        timestamp: new Date(row.timestamp).getTime() / 1000,
        requests: 1,
        inputTokens: row.prompt_tokens || 0,
        cost: pricing ? calculateCost(
          {
            inputTokens: row.prompt_tokens || 0,
            outputTokens: row.completion_tokens || 0,
            cachedTokens: row.cached_tokens || 0
          },
          pricing
        ) : 0
      }));

      counter.slidingWindows.set(windowHours, {
        windowHours,
        entries: slidingEntries,
        loaded: true
      });
    }
  }

  /**
   * 确保计数器已加载
   */
  async ensureLoaded(
    counter: ModelUsageCounter,
    period: 'day' | 'hours' | 'week' | 'month',
    periodValue: number | undefined,
    pricing: Pricing | undefined
  ): Promise<void> {
    const today = getTodayDate();
    const weekStart = getWeekStart();
    const monthStart = getMonthStart();
    
    let needReload = false;
    
    if (period === 'day' && (counter.today.date !== today || !counter.today.loaded)) {
      needReload = true;
    }
    
    if (period === 'week' && (counter.thisWeek.weekStart !== weekStart || !counter.thisWeek.loaded)) {
      needReload = true;
    }
    
    if (period === 'month' && (counter.thisMonth.month !== monthStart || !counter.thisMonth.loaded)) {
      needReload = true;
    }
    
    if (period === 'hours') {
      const windowHours = periodValue || 24;
      const window = counter.slidingWindows.get(windowHours);
      if (!window || !window.loaded) {
        needReload = true;
      }
    }

    // 只要有加载需求就执行加载，pricing 为 undefined 时 cost 会计为 0
    // 对于 requests/input_tokens 类型的限制，不需要 pricing 也能统计
    if (needReload) {
      this.loadFromDb(counter, period, periodValue, pricing);
    }
  }

  /**
   * 记录用量
   */
  recordUsage(model: string, entry: LogEntry, pricing: Pricing | undefined): void {
    const counter = this.counters.get(model);
    if (!counter) return;
    
    const cost = pricing ? calculateCost(
      {
        inputTokens: entry.promptTokens || 0,
        outputTokens: entry.completionTokens || 0,
        cachedTokens: entry.cachedTokens || 0
      },
      pricing
    ) : 0;
    
    // 更新今日计数
    counter.today.requests++;
    counter.today.inputTokens += entry.promptTokens || 0;
    counter.today.cost += cost;
    
    // 更新本周计数
    counter.thisWeek.requests++;
    counter.thisWeek.inputTokens += entry.promptTokens || 0;
    counter.thisWeek.cost += cost;
    
    // 更新本月计数
    counter.thisMonth.requests++;
    counter.thisMonth.inputTokens += entry.promptTokens || 0;
    counter.thisMonth.cost += cost;
    
    // 更新滑动窗口
    const now = Date.now() / 1000;
    for (const [hours, window] of counter.slidingWindows.entries()) {
      window.entries.push({
        timestamp: now,
        requests: 1,
        inputTokens: entry.promptTokens || 0,
        cost
      });
    }
  }

  /**
   * 获取当前用量
   */
  getCurrentUsage(
    counter: ModelUsageCounter,
    limit: ModelLimit
  ): number {
    switch (limit.period) {
      case 'day':
        return limit.type === 'requests' ? counter.today.requests :
               limit.type === 'input_tokens' ? counter.today.inputTokens :
               counter.today.cost;
      
      case 'week':
        return limit.type === 'requests' ? counter.thisWeek.requests :
               limit.type === 'input_tokens' ? counter.thisWeek.inputTokens :
               counter.thisWeek.cost;
      
      case 'month':
        return limit.type === 'requests' ? counter.thisMonth.requests :
               limit.type === 'input_tokens' ? counter.thisMonth.inputTokens :
               counter.thisMonth.cost;
      
      case 'hours': {
        const windowHours = limit.periodValue || 24;
        const window = counter.slidingWindows.get(windowHours);
        if (!window) return 0;
        
        if (limit.type === 'requests') {
          return window.entries.reduce((sum, e) => sum + e.requests, 0);
        }
        if (limit.type === 'input_tokens') {
          return window.entries.reduce((sum, e) => sum + e.inputTokens, 0);
        }
        return window.entries.reduce((sum, e) => sum + e.cost, 0);
      }
    }
  }

  /**
   * 清理过期滑动窗口数据
   */
  cleanupSlidingWindows(): void {
    const now = Date.now() / 1000;
    
    for (const counter of this.counters.values()) {
      for (const [hours, window] of counter.slidingWindows.entries()) {
        const cutoff = now - (hours * 3600);
        window.entries = window.entries.filter(e => e.timestamp > cutoff);
      }
    }
  }
}
