import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { LogEntry } from '../logger.js';
import type { ModelLimit } from '../config.js';
import { getTodayDate, getWeekStart, getMonthStart, getPeriodRange } from './period-utils.js';
import { calculateCost, type Pricing } from './cost-calculator.js';

/**
 * 滑动窗口条目
 */
interface SlidingWindowEntry {
  timestamp: number;  // 秒级时间戳
  requests: number;
  inputTokens: number;
  cost: number;
}

/**
 * 滑动窗口计数器
 */
interface SlidingWindowCounter {
  windowHours: number;
  entries: SlidingWindowEntry[];
  loaded: boolean;
}

/**
 * 模型用量计数器
 */
export interface ModelUsageCounter {
  model: string;
  lastChecked: number;
  
  today: {
    date: string;
    requests: number;
    inputTokens: number;
    cost: number;
    loaded: boolean;
  };
  
  thisWeek: {
    weekStart: string;
    requests: number;
    inputTokens: number;
    cost: number;
    loaded: boolean;
  };
  
  thisMonth: {
    month: string;
    requests: number;
    inputTokens: number;
    cost: number;
    loaded: boolean;
  };
  
  slidingWindows: Map<number, SlidingWindowCounter>;
}

/**
 * 日志条目解析结果
 */
interface ParsedLogEntry {
  timestamp: string;
  customModel: string;
  statusCode: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
}

/**
 * 用量追踪器类
 */
export class UsageTracker {
  private static instance: UsageTracker | null = null;
  private counters: Map<string, ModelUsageCounter> = new Map();
  private logDir: string;

  private constructor(logDir: string) {
    this.logDir = logDir;
  }

  /**
   * 获取单例实例
   */
  static getInstance(logDir: string): UsageTracker {
    if (!UsageTracker.instance) {
      UsageTracker.instance = new UsageTracker(logDir);
    }
    // 验证 logDir 一致性
    if (UsageTracker.instance.logDir !== logDir) {
      throw new Error(`logDir mismatch: ${logDir} vs ${UsageTracker.instance.logDir}`);
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
   * 获取日志文件列表
   */
  private getLogFilesForRange(start: string, end: string): string[] {
    if (!existsSync(this.logDir)) return [];
    
    return readdirSync(this.logDir)
      .filter(f => f.startsWith('proxy-') && f.endsWith('.log'))
      .map(f => {
        const match = f.match(/proxy-(\d{4}-\d{2}-\d{2})\.log/);
        return match ? { file: join(this.logDir, f), date: match[1] } : null;
      })
      .filter((item): item is { file: string; date: string } => item !== null)
      .filter(item => item.date >= start && item.date <= end)
      .map(item => item.file);
  }

  /**
   * 解析日志文件
   */
  private parseLogFile(filePath: string): ParsedLogEntry[] {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, 'utf-8');
    return content.trim().split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  }

  /**
   * 从日志文件加载用量
   */
  private loadFromLogs(
    counter: ModelUsageCounter,
    period: 'day' | 'hours' | 'week' | 'month',
    periodValue: number | undefined,
    pricing: Pricing | undefined
  ): void {
    const dateRange = getPeriodRange(period, periodValue);
    const logFiles = this.getLogFilesForRange(dateRange.start, dateRange.end);
    
    let requests = 0;
    let inputTokens = 0;
    let cost = 0;
    const slidingEntries: SlidingWindowEntry[] = [];
    
    for (const file of logFiles) {
      const entries = this.parseLogFile(file);
      for (const entry of entries) {
        if (entry.customModel !== counter.model) continue;
        if (entry.statusCode < 200 || entry.statusCode >= 300) continue;
        
        requests++;
        inputTokens += entry.promptTokens || 0;
        
        if (pricing) {
          const entryCost = calculateCost(
            {
              inputTokens: entry.promptTokens || 0,
              outputTokens: entry.completionTokens || 0,
              cachedTokens: entry.cachedTokens || 0
            },
            pricing
          );
          cost += entryCost;
        }
        
        if (period === 'hours') {
          slidingEntries.push({
            timestamp: new Date(entry.timestamp).getTime() / 1000,
            requests: 1,
            inputTokens: entry.promptTokens || 0,
            cost: pricing ? calculateCost(
              {
                inputTokens: entry.promptTokens || 0,
                outputTokens: entry.completionTokens || 0,
                cachedTokens: entry.cachedTokens || 0
              },
              pricing
            ) : 0
          });
        }
      }
    }
    
    // 更新计数器
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
      const filtered = slidingEntries.filter(e => e.timestamp > cutoff);
      
      counter.slidingWindows.set(windowHours, {
        windowHours,
        entries: filtered,
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
      this.loadFromLogs(counter, period, periodValue, pricing);
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
