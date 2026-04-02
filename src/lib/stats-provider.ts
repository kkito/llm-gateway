import type { ModelUsageCounter } from './usage-tracker.js';
import { UsageTracker } from './usage-tracker.js';
import type { Pricing } from './cost-calculator.js';
import { getTodayDate, getWeekStart, getMonthStart, getPeriodRange } from './period-utils.js';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { LogEntry } from '../logger.js';

/**
 * 统计条目
 */
export interface StatsEntry {
  timestamp: string;
  customModel: string;
  provider?: string;
  statusCode: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  userName?: string;
}

/**
 * 模型统计数据
 */
export interface ModelStats {
  requests: number;
  successful: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cost?: number;  // 估算成本（美元）
}

/**
 * 统计数据
 */
export interface Stats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  byModel: Record<string, ModelStats>;
  byProvider: Record<string, ModelStats>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCachedTokens: number;
  byHour?: Record<string, ModelStats>;
  byDate?: Record<string, ModelStats>;
}

export interface StatsOptions {
  date?: string;      // YYYY-MM-DD
  week?: string;      // YYYY-Www
  month?: string;     // YYYY-MM
  byHour?: boolean;
  userName?: string;  // 筛选特定用户
  forceReload?: boolean;  // 强制从日志重新加载
}

/**
 * 日志条目解析结果
 */
interface ParsedLogEntry {
  timestamp: string;
  customModel: string;
  provider?: string;
  statusCode: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  userName?: string;
  cost?: number;  // 估算成本
}

/**
 * 统计提供者 - 混合模式
 * 优先使用内存计数器，必要时从日志加载
 */
export class StatsProvider {
  private tracker: UsageTracker;
  private logDir: string;

  constructor(tracker: UsageTracker, logDir: string) {
    this.tracker = tracker;
    this.logDir = logDir;
  }

  /**
   * 获取日志目录路径（用于路由中动态获取正确的日志目录）
   */
  getLogDir(): string {
    return this.logDir;
  }

  /**
   * 获取统计数据
   */
  async getStats(options: StatsOptions = {}): Promise<Stats> {
    const { forceReload = false } = options;

    // 如果是按小时或按日期统计，需要从日志加载
    if (options.byHour || options.week || options.month) {
      return this.loadFromLogs(options);
    }

    // 默认（今日统计）优先使用内存计数器
    if (!forceReload) {
      const fromMemory = this.getFromMemory(options);
      if (fromMemory) {
        return fromMemory;
      }
    }

    // 回退到从日志加载
    return this.loadFromLogs(options);
  }

  /**
   * 从内存计数器获取统计数据
   */
  private getFromMemory(options: StatsOptions): Stats | null {
    const counters = this.getAllCounters();
    if (counters.length === 0) {
      return null;
    }

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

    // 确定使用哪个时间段
    const useToday = !options.date && !options.week && !options.month;
    const targetDate = options.date || getTodayDate();
    const targetWeek = options.week || getWeekStart();
    const targetMonth = options.month || getMonthStart();

    for (const counter of counters) {
      let counterStats: ModelStats | null = null;

      // 检查计数器是否已加载对应时间段的数据
      if (useToday) {
        if (counter.today.date === targetDate && counter.today.loaded) {
          counterStats = this.counterToStats(counter.today);
        }
      } else if (options.week) {
        if (counter.thisWeek.weekStart === targetWeek && counter.thisWeek.loaded) {
          counterStats = this.counterToStats(counter.thisWeek);
        }
      } else if (options.month) {
        if (counter.thisMonth.month === targetMonth && counter.thisMonth.loaded) {
          counterStats = this.counterToStats(counter.thisMonth);
        }
      }

      if (counterStats) {
        stats.byModel[counter.model] = counterStats;
        stats.totalRequests += counterStats.requests;
        stats.successfulRequests += counterStats.successful;
        stats.failedRequests += counterStats.failed;
        stats.totalInputTokens += counterStats.inputTokens;
        stats.totalOutputTokens += counterStats.outputTokens;
        stats.totalTokens += counterStats.totalTokens;
        stats.totalCachedTokens += counterStats.cachedTokens;
      }
    }

    // 如果没有有效的内存数据，返回 null 以触发日志加载
    if (stats.totalRequests === 0) {
      return null;
    }

    return stats;
  }

  /**
   * 将计数器数据转换为统计格式
   */
  private counterToStats(counterData: {
    requests: number;
    inputTokens: number;
    cost: number;
  }): ModelStats {
    // 内存计数器只记录 requests 和 inputTokens
    // cost 需要单独计算，这里暂时返回 0
    return {
      requests: counterData.requests,
      successful: counterData.requests,  // 内存中的都是成功的请求
      failed: 0,
      inputTokens: counterData.inputTokens,
      outputTokens: 0,  // 内存计数器未记录 outputTokens
      totalTokens: counterData.inputTokens,  // 近似值
      cachedTokens: 0   // 内存计数器未记录 cachedTokens
    };
  }

  /**
   * 获取所有计数器
   */
  private getAllCounters(): ModelUsageCounter[] {
    // UsageTracker 没有公开获取所有计数器的方法，需要通过日志获取模型列表
    const models = this.getModelsFromLogs();
    return models.map(model => this.tracker.getCounter(model));
  }

  /**
   * 从日志文件获取模型列表
   */
  private getModelsFromLogs(): string[] {
    const logFiles = this.getTodayLogFiles();
    const models = new Set<string>();

    for (const file of logFiles) {
      const entries = this.parseLogFile(file);
      for (const entry of entries) {
        models.add(entry.customModel);
      }
    }

    return Array.from(models);
  }

  /**
   * 从日志加载统计数据
   */
  private async loadFromLogs(options: StatsOptions): Promise<Stats> {
    const logFiles = this.getLogFilesForRange(options);

    let entries: ParsedLogEntry[] = [];
    for (const file of logFiles) {
      entries = entries.concat(this.parseLogFile(file));
    }

    // 如果指定了 userName，过滤日志
    if (options.userName !== undefined) {
      entries = entries.filter(e => e.userName === options.userName);
    }

    return this.calculateStats(entries, options);
  }

  /**
   * 计算统计数据
   */
  private calculateStats(entries: ParsedLogEntry[], options: StatsOptions): Stats {
    const stats: Stats = {
      totalRequests: entries.length,
      successfulRequests: entries.filter(e => e.statusCode >= 200 && e.statusCode < 300).length,
      failedRequests: entries.filter(e => e.statusCode >= 400).length,
      byModel: {},
      byProvider: {},
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCachedTokens: 0
    };

    // 按小时统计
    if (options.byHour) {
      stats.byHour = {};
    }

    // 按日期统计（用于周/月视图）
    if (options.week || options.month) {
      stats.byDate = {};
    }

    for (const entry of entries) {
      // 按模型统计
      if (!stats.byModel[entry.customModel]) {
        stats.byModel[entry.customModel] = this.createEmptyModelStats();
      }
      this.addEntryToStats(stats.byModel[entry.customModel], entry);

      // 按 provider 统计
      if (entry.provider) {
        if (!stats.byProvider[entry.provider]) {
          stats.byProvider[entry.provider] = this.createEmptyModelStats();
        }
        this.addEntryToStats(stats.byProvider[entry.provider], entry);
      }

      // 总计
      if (entry.promptTokens) stats.totalInputTokens += entry.promptTokens;
      if (entry.completionTokens) stats.totalOutputTokens += entry.completionTokens;
      if (entry.totalTokens) stats.totalTokens += entry.totalTokens;
      if (entry.cachedTokens) stats.totalCachedTokens += entry.cachedTokens;

      // 按小时统计
      if (options.byHour) {
        const date = new Date(entry.timestamp);
        const dateStr = date.toISOString().split('T')[0];
        const hour = date.getHours().toString().padStart(2, '0') + ':00';
        const key = `${dateStr} ${hour}`;

        if (!stats.byHour![key]) {
          stats.byHour![key] = this.createEmptyModelStats();
        }
        this.addEntryToStats(stats.byHour![key], entry);
      }

      // 按日期统计
      if (options.week || options.month) {
        const dateStr = entry.timestamp.split('T')[0];
        if (!stats.byDate![dateStr]) {
          stats.byDate![dateStr] = this.createEmptyModelStats();
        }
        this.addEntryToStats(stats.byDate![dateStr], entry);
      }
    }

    return stats;
  }

  private createEmptyModelStats(): ModelStats {
    return {
      requests: 0,
      successful: 0,
      failed: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedTokens: 0
    };
  }

  private addEntryToStats(modelStats: ModelStats, entry: ParsedLogEntry): void {
    modelStats.requests += 1;
    if (entry.statusCode >= 200 && entry.statusCode < 300) {
      modelStats.successful += 1;
    }
    if (entry.statusCode >= 400) {
      modelStats.failed += 1;
    }
    if (entry.promptTokens) modelStats.inputTokens += entry.promptTokens;
    if (entry.completionTokens) modelStats.outputTokens += entry.completionTokens;
    if (entry.totalTokens) modelStats.totalTokens += entry.totalTokens;
    if (entry.cachedTokens) modelStats.cachedTokens += entry.cachedTokens;
  }

  private getTodayLogFiles(): string[] {
    if (!existsSync(this.logDir)) return [];
    const today = new Date().toISOString().split('T')[0];
    return readdirSync(this.logDir)
      .filter(f => f.includes(today) && f.endsWith('.log'))
      .map(f => join(this.logDir, f));
  }

  private getLogFilesForRange(options: StatsOptions): string[] {
    if (!existsSync(this.logDir)) return [];

    const allFiles = readdirSync(this.logDir)
      .filter(f => f.startsWith('proxy-') && f.endsWith('.log'))
      .map(f => join(this.logDir, f))
      .sort();

    if (options.date) {
      return this.getDateLogFiles(options.date);
    }

    if (options.week) {
      const { start, end } = this.getWeekRange(options.week);
      return allFiles.filter(f => {
        const date = f.match(/proxy-(\d{4}-\d{2}-\d{2})\.log/)?.[1];
        return date && date >= start && date <= end;
      });
    }

    if (options.month) {
      const { start, end } = this.getMonthRange(options.month);
      return allFiles.filter(f => {
        const date = f.match(/proxy-(\d{4}-\d{2}-\d{2})\.log/)?.[1];
        return date && date >= start && date <= end;
      });
    }

    // 默认返回今日
    return this.getTodayLogFiles();
  }

  private getDateLogFiles(date: string): string[] {
    const filePath = join(this.logDir, `proxy-${date}.log`);
    if (!existsSync(filePath)) return [];
    return [filePath];
  }

  private getWeekRange(weekStr: string): { start: string; end: string } {
    const [year, week] = weekStr.split('-W');
    const y = parseInt(year);
    const w = parseInt(week);

    const jan1 = new Date(y, 0, 4);
    const dayOfWeek = jan1.getDay() || 7;
    const firstMonday = new Date(jan1);
    firstMonday.setDate(jan1.getDate() - dayOfWeek + 1 + (w - 1) * 7);

    const startDate = firstMonday;
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);

    return {
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0]
    };
  }

  private getMonthRange(monthStr: string): { start: string; end: string } {
    const [year, month] = monthStr.split('-');
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);

    const startDate = `${year}-${month}-01`;

    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear = m === 12 ? y + 1 : y;

    const endDate = new Date(Date.UTC(nextYear, nextMonth - 1, 0));
    const endDay = endDate.getUTCDate();
    const endMonth = endDate.getUTCMonth() + 1;
    const endMonthStr = endMonth.toString().padStart(2, '0');
    const endYear = endDate.getUTCFullYear();

    return {
      start: startDate,
      end: `${endYear}-${endMonthStr}-${endDay.toString().padStart(2, '0')}`
    };
  }

  private parseLogFile(filePath: string): ParsedLogEntry[] {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, 'utf-8');
    return content.trim().split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  }

  /**
   * 确保计数器已加载（用于预加载）
   */
  async ensureCountersLoaded(models: string[], pricing?: Pricing): Promise<void> {
    for (const model of models) {
      const counter = this.tracker.getCounter(model);
      // 确保今日数据已加载
      await this.tracker.ensureLoaded(counter, 'day', undefined, pricing);
    }
  }

  /**
   * 清理过期数据
   */
  cleanup(): void {
    this.tracker.cleanupSlidingWindows();
  }
}
