import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

export interface StatsEntry {
  timestamp: string;
  customModel: string;
  provider?: string;
  statusCode: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
}

export interface ModelStats {
  requests: number;
  successful: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
}

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
}

export function parseLogFile(filePath: string): StatsEntry[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8');
  return content.trim().split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
}

export function createEmptyModelStats(): ModelStats {
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

export function addEntryToStats(stats: ModelStats, entry: StatsEntry): void {
  stats.requests += 1;
  if (entry.statusCode >= 200 && entry.statusCode < 300) {
    stats.successful += 1;
  }
  if (entry.statusCode >= 400) {
    stats.failed += 1;
  }
  if (entry.promptTokens) stats.inputTokens += entry.promptTokens;
  if (entry.completionTokens) stats.outputTokens += entry.completionTokens;
  if (entry.totalTokens) stats.totalTokens += entry.totalTokens;
  if (entry.cachedTokens) stats.cachedTokens += entry.cachedTokens;
}

export function calculateStats(entries: StatsEntry[], options: StatsOptions): Stats {
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
      stats.byModel[entry.customModel] = createEmptyModelStats();
    }
    addEntryToStats(stats.byModel[entry.customModel], entry);

    // 按 provider 统计
    if (entry.provider) {
      if (!stats.byProvider[entry.provider]) {
        stats.byProvider[entry.provider] = createEmptyModelStats();
      }
      addEntryToStats(stats.byProvider[entry.provider], entry);
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
        stats.byHour![key] = createEmptyModelStats();
      }
      addEntryToStats(stats.byHour![key], entry);
    }

    // 按日期统计
    if (options.week || options.month) {
      const dateStr = entry.timestamp.split('T')[0];
      if (!stats.byDate![dateStr]) {
        stats.byDate![dateStr] = createEmptyModelStats();
      }
      addEntryToStats(stats.byDate![dateStr], entry);
    }
  }

  return stats;
}

export function getTodayLogFiles(logDir: string): string[] {
  if (!existsSync(logDir)) return [];
  const today = new Date().toISOString().split('T')[0];
  return readdirSync(logDir)
    .filter(f => f.includes(today) && f.endsWith('.log'))
    .map(f => join(logDir, f));
}

export function getDateLogFiles(logDir: string, date: string): string[] {
  const filePath = join(logDir, `proxy-${date}.log`);
  if (!existsSync(filePath)) return [];
  return [filePath];
}

export function getWeekRange(weekStr: string): { start: string; end: string } {
  // 解析 YYYY-Www 格式
  const [year, week] = weekStr.split('-W');
  const y = parseInt(year);
  const w = parseInt(week);
  
  // ISO 周的第一周是包含 1 月 4 日的那一周
  const jan1 = new Date(y, 0, 4);
  const dayOfWeek = jan1.getDay() || 7; // 周日转为 7
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

export function getMonthRange(monthStr: string): { start: string; end: string } {
  const [year, month] = monthStr.split('-');
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);

  // 直接使用字符串拼接避免时区问题
  const startDate = `${year}-${month}-01`;
  
  // 计算下个月
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  
  // 使用 UTC 时间避免时区问题：下个月第 0 天 = 本月最后一天
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

export function getLogFilesForRange(logDir: string, options: StatsOptions): string[] {
  if (!existsSync(logDir)) return [];
  
  const allFiles = readdirSync(logDir)
    .filter(f => f.startsWith('proxy-') && f.endsWith('.log'))
    .map(f => join(logDir, f))
    .sort();

  if (options.date) {
    return getDateLogFiles(logDir, options.date);
  }
  
  if (options.week) {
    const { start, end } = getWeekRange(options.week);
    return allFiles.filter(f => {
      const date = f.match(/proxy-(\d{4}-\d{2}-\d{2})\.log/)?.[1];
      return date && date >= start && date <= end;
    });
  }
  
  if (options.month) {
    const { start, end } = getMonthRange(options.month);
    return allFiles.filter(f => {
      const date = f.match(/proxy-(\d{4}-\d{2}-\d{2})\.log/)?.[1];
      return date && date >= start && date <= end;
    });
  }
  
  // 默认返回今日
  return getTodayLogFiles(logDir);
}

export function formatDateRange(options: StatsOptions): string {
  if (options.date) {
    return options.date;
  }
  if (options.week) {
    const { start, end } = getWeekRange(options.week);
    return `${options.week} (${start} ~ ${end})`;
  }
  if (options.month) {
    const { start, end } = getMonthRange(options.month);
    return `${options.month} (${start} ~ ${end})`;
  }
  return '今日';
}

export function loadStats(logDir: string, options: StatsOptions = {}): Stats {
  const logFiles = getLogFilesForRange(logDir, options);
  
  let entries: StatsEntry[] = [];
  for (const file of logFiles) {
    entries = entries.concat(parseLogFile(file));
  }
  
  return calculateStats(entries, options);
}
