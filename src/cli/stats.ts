#!/usr/bin/env node

import { Command } from 'commander';
import { createConfigContext } from '../lib/config-context.js';
import { DatabaseManager } from '../lib/db.js';
import { localDateToUtcRange } from '../lib/time-utils.js';

interface CliStatsOptions {
  configDir?: string;
  date?: string;
  week?: string;
  month?: string;
  byHour?: boolean;
  json?: boolean;
}

interface ModelStats {
  requests: number;
  successful: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
}

interface Stats {
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

function resolveConfigDir(options: CliStatsOptions): string {
  return createConfigContext(options.configDir).configDir;
}

function formatModelStats(model: string, stats: ModelStats, indent = 2): string[] {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);
  lines.push(`${prefix}${model}: ${stats.requests} 次`);
  
  if (stats.inputTokens > 0 || stats.outputTokens > 0) {
    lines.push(`${prefix}  - 输入：${stats.inputTokens.toLocaleString()} tokens`);
    lines.push(`${prefix}  - 输出：${stats.outputTokens.toLocaleString()} tokens`);
    lines.push(`${prefix}  - 总计：${stats.totalTokens.toLocaleString()} tokens`);
    if (stats.cachedTokens > 0) {
      lines.push(`${prefix}  - 缓存：${stats.cachedTokens.toLocaleString()} tokens`);
    }
  }
  
  if (stats.failed > 0) {
    lines.push(`${prefix}  - 失败：${stats.failed} 次`);
  }
  
  return lines;
}

function formatStats(stats: Stats, options: CliStatsOptions): string {
  const lines: string[] = [];
  const dateRange = formatDateRange(options);
  
  lines.push(`=== LLM Proxy Stats (${dateRange}) ===`);
  lines.push('');
  lines.push(`总请求数：${stats.totalRequests.toLocaleString()}`);
  lines.push(`成功请求：${stats.successfulRequests.toLocaleString()}`);
  lines.push(`失败请求：${stats.failedRequests.toLocaleString()}`);
  lines.push(`成功率：${stats.totalRequests > 0 ? ((stats.successfulRequests / stats.totalRequests) * 100).toFixed(1) : 0}%`);
  
  // 按模型统计
  lines.push('');
  lines.push('按模型统计:');
  
  const sortedModels = Object.entries(stats.byModel).sort((a, b) => b[1].requests - a[1].requests);
  for (const [model, modelStats] of sortedModels) {
    lines.push(...formatModelStats(model, modelStats));
  }
  
  if (sortedModels.length === 0) {
    lines.push('  暂无数据');
  }
  
  // 按 provider 统计
  lines.push('');
  lines.push('按 provider 统计:');
  
  const sortedProviders = Object.entries(stats.byProvider).sort((a, b) => b[1].requests - a[1].requests);
  for (const [provider, providerStats] of sortedProviders) {
    lines.push(...formatModelStats(provider, providerStats));
  }
  
  if (sortedProviders.length === 0) {
    lines.push('  暂无数据');
  }
  
  // 按日期统计（周/月视图）
  if (options.week || options.month) {
    lines.push('');
    lines.push('按日期分布:');
    
    const sortedDates = Object.entries(stats.byDate!).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [date, dateStats] of sortedDates) {
      lines.push(`  ${date}: ${dateStats.requests} 次 | 输入：${dateStats.inputTokens.toLocaleString()} | 输出：${dateStats.outputTokens.toLocaleString()}`);
    }
  }
  
  // 按小时统计
  if (options.byHour) {
    lines.push('');
    lines.push('按小时分布:');
    
    const sortedHours = Object.entries(stats.byHour!).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [hour, hourStats] of sortedHours) {
      lines.push(`  ${hour}: ${hourStats.requests} 次 | 输入：${hourStats.inputTokens.toLocaleString()} | 输出：${hourStats.outputTokens.toLocaleString()}`);
    }
  }
  
  // 总计
  lines.push('');
  lines.push('Token 总计:');
  lines.push(`  总输入：${stats.totalInputTokens.toLocaleString()} tokens`);
  lines.push(`  总输出：${stats.totalOutputTokens.toLocaleString()} tokens`);
  lines.push(`  总计：${stats.totalTokens.toLocaleString()} tokens`);
  if (stats.totalCachedTokens > 0) {
    lines.push(`  缓存命中：${stats.totalCachedTokens.toLocaleString()} tokens`);
  }
  
  return lines.join('\n');
}

function getSystemTimezoneOffset(): number {
  return new Date().getTimezoneOffset();
}

function parseDateRange(options: CliStatsOptions): { start: string; end: string } {
  const tzOffset = getSystemTimezoneOffset();
  const today = new Date();
  const localToday = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');

  if (options.date) {
    const [utcStart, utcEnd] = localDateToUtcRange(options.date, tzOffset);
    return { start: utcStart, end: utcEnd };
  }
  
  if (options.week) {
    // 解析 YYYY-Www 格式
    const [year, week] = options.week.split('-W');
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
    
    const startLocal = startDate.getFullYear() + '-' +
      String(startDate.getMonth() + 1).padStart(2, '0') + '-' +
      String(startDate.getDate()).padStart(2, '0');
    const endLocal = endDate.getFullYear() + '-' +
      String(endDate.getMonth() + 1).padStart(2, '0') + '-' +
      String(endDate.getDate()).padStart(2, '0');
    
    const [utcStart] = localDateToUtcRange(startLocal, tzOffset);
    const [, utcEnd] = localDateToUtcRange(endLocal, tzOffset);
    return { start: utcStart, end: utcEnd };
  }
  
  if (options.month) {
    const [year, month] = options.month.split('-');
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    
    const startLocal = `${year}-${month}-01`;
    
    // 计算下个月
    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear = m === 12 ? y + 1 : y;
    
    // 使用 UTC 时间避免时区问题：下个月第 0 天 = 本月最后一天
    const endDate = new Date(Date.UTC(nextYear, nextMonth - 1, 0));
    const endDay = endDate.getUTCDate();
    const endMonth = endDate.getUTCMonth() + 1;
    const endMonthStr = endMonth.toString().padStart(2, '0');
    const endYear = endDate.getUTCFullYear();
    const endLocal = `${endYear}-${endMonthStr}-${endDay.toString().padStart(2, '0')}`;
    
    const [utcStart] = localDateToUtcRange(startLocal, tzOffset);
    const [, utcEnd] = localDateToUtcRange(endLocal, tzOffset);
    return { start: utcStart, end: utcEnd };
  }
  
  // 默认今日
  const [utcStart, utcEnd] = localDateToUtcRange(localToday, tzOffset);
  return { start: utcStart, end: utcEnd };
}

function formatDateRange(options: CliStatsOptions): string {
  if (options.date) {
    return options.date;
  }
  if (options.week) {
    const { start, end } = parseDateRange(options);
    const startLocal = start.split('T')[0];
    const endLocal = end.split('T')[0];
    return `${options.week} (${startLocal} ~ ${endLocal})`;
  }
  if (options.month) {
    const { start, end } = parseDateRange(options);
    const startLocal = start.split('T')[0];
    const endLocal = end.split('T')[0];
    return `${options.month} (${startLocal} ~ ${endLocal})`;
  }
  return '今日';
}

function getStatsFromDatabase(configDir: string, options: CliStatsOptions): Stats {
  const dbManager = DatabaseManager.getExistingInstance();
  if (!dbManager) {
    // 尝试初始化
    const manager = DatabaseManager.getInstance(configDir);
    manager.initialize();
    return queryStats(manager.getDb(), options);
  }
  return queryStats(dbManager.getDb(), options);
}

function queryStats(db: any, options: CliStatsOptions): Stats {
  const { start, end } = parseDateRange(options);
  
  const conditions: string[] = ['timestamp >= ?', 'timestamp <= ?'];
  const params: any[] = [start, end];
  
  const whereClause = conditions.join(' AND ');
  
  // 概览聚合
  const overview = db.prepare(`
    SELECT
      COUNT(*) AS totalRequests,
      COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END), 0) AS successfulRequests,
      COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) AS failedRequests,
      COALESCE(SUM(prompt_tokens), 0) AS totalInputTokens,
      COALESCE(SUM(completion_tokens), 0) AS totalOutputTokens,
      COALESCE(SUM(total_tokens), 0) AS totalTokens,
      COALESCE(SUM(cached_tokens), 0) AS totalCachedTokens
    FROM requests
    WHERE ${whereClause}
  `).get(...params) as {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCachedTokens: number;
  };
  
  // 按模型分组
  const byModelRows = db.prepare(`
    SELECT
      custom_model AS model,
      COUNT(*) AS requests,
      COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END), 0) AS successful,
      COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) AS failed,
      COALESCE(SUM(prompt_tokens), 0) AS inputTokens,
      COALESCE(SUM(completion_tokens), 0) AS outputTokens,
      COALESCE(SUM(total_tokens), 0) AS totalTokens,
      COALESCE(SUM(cached_tokens), 0) AS cachedTokens
    FROM requests
    WHERE ${whereClause}
    GROUP BY custom_model
    ORDER BY requests DESC
  `).all(...params) as Array<{
    model: string;
    requests: number;
    successful: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedTokens: number;
  }>;
  
  const byModel: Record<string, ModelStats> = {};
  for (const row of byModelRows) {
    byModel[row.model] = {
      requests: row.requests,
      successful: row.successful,
      failed: row.failed,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      cachedTokens: row.cachedTokens,
    };
  }
  
  // 按 Provider 分组
  const byProviderRows = db.prepare(`
    SELECT
      COALESCE(provider, 'unknown') AS provider,
      COUNT(*) AS requests,
      COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END), 0) AS successful,
      COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) AS failed,
      COALESCE(SUM(prompt_tokens), 0) AS inputTokens,
      COALESCE(SUM(completion_tokens), 0) AS outputTokens,
      COALESCE(SUM(total_tokens), 0) AS totalTokens,
      COALESCE(SUM(cached_tokens), 0) AS cachedTokens
    FROM requests
    WHERE ${whereClause}
    GROUP BY provider
    ORDER BY requests DESC
  `).all(...params) as Array<{
    provider: string;
    requests: number;
    successful: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedTokens: number;
  }>;
  
  const byProvider: Record<string, ModelStats> = {};
  for (const row of byProviderRows) {
    byProvider[row.provider] = {
      requests: row.requests,
      successful: row.successful,
      failed: row.failed,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      cachedTokens: row.cachedTokens,
    };
  }
  
  // 按小时分布
  let byHour: Record<string, ModelStats> | undefined;
  if (options.byHour) {
    const byHourRows = db.prepare(`
      SELECT
        strftime('%Y-%m-%d %H:00', timestamp) AS hour,
        COUNT(*) AS requests,
        COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END), 0) AS successful,
        COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) AS failed,
        COALESCE(SUM(prompt_tokens), 0) AS inputTokens,
        COALESCE(SUM(completion_tokens), 0) AS outputTokens,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(cached_tokens), 0) AS cachedTokens
      FROM requests
      WHERE ${whereClause}
      GROUP BY hour
      ORDER BY hour ASC
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
    
    byHour = {};
    for (const row of byHourRows) {
      byHour[row.hour] = {
        requests: row.requests,
        successful: row.successful,
        failed: row.failed,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        cachedTokens: row.cachedTokens,
      };
    }
  }
  
  // 按日期分布（用于周/月视图）
  let byDate: Record<string, ModelStats> | undefined;
  if (options.week || options.month) {
    const byDateRows = db.prepare(`
      SELECT
        strftime('%Y-%m-%d', timestamp) AS date,
        COUNT(*) AS requests,
        COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END), 0) AS successful,
        COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) AS failed,
        COALESCE(SUM(prompt_tokens), 0) AS inputTokens,
        COALESCE(SUM(completion_tokens), 0) AS outputTokens,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(cached_tokens), 0) AS cachedTokens
      FROM requests
      WHERE ${whereClause}
      GROUP BY date
      ORDER BY date ASC
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
    
    byDate = {};
    for (const row of byDateRows) {
      byDate[row.date] = {
        requests: row.requests,
        successful: row.successful,
        failed: row.failed,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        cachedTokens: row.cachedTokens,
      };
    }
  }
  
  return {
    totalRequests: overview.totalRequests,
    successfulRequests: overview.successfulRequests,
    failedRequests: overview.failedRequests,
    byModel,
    byProvider,
    totalInputTokens: overview.totalInputTokens,
    totalOutputTokens: overview.totalOutputTokens,
    totalTokens: overview.totalTokens,
    totalCachedTokens: overview.totalCachedTokens,
    byHour,
    byDate,
  };
}

function main() {
  const program = new Command();

  program
    .name('llm-gateway-stats')
    .description('查看代理服务器统计')
    .option('-C, --config-dir <path>', '工作目录 (默认 ~/.llm-gateway/)')
    .option('--date <date>', '指定日期 (YYYY-MM-DD)')
    .option('--week <week>', '指定周 (YYYY-Www，如 2026-W13)')
    .option('--month <month>', '指定月份 (YYYY-MM，如 2026-03)')
    .option('--by-hour', '按小时分布统计')
    .option('--json', '输出 JSON 格式')
    .action((options: CliStatsOptions) => {
      try {
        const configDir = resolveConfigDir(options);
        
        // 从数据库获取统计数据
        const stats = getStatsFromDatabase(configDir, options);

        if (stats.totalRequests === 0) {
          const dateRange = formatDateRange(options);
          console.log(`❌ ${dateRange} 暂无请求记录`);
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log(formatStats(stats, options));
        }

      } catch (error: any) {
        console.error('❌ 统计失败:', error.message);
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });

  program.parse();
}

main();
