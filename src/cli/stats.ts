#!/usr/bin/env node

import { Command } from 'commander';
import { getLogDir } from '../config.js';
import { DatabaseManager } from '../lib/db.js';
import { loadStats, getHourlyBreakdown, getDailyBreakdown } from '../lib/stats-core.js';
import type { Stats, ModelStats } from '../lib/types/stats.js';
import { getPeriodRange } from '../lib/period-utils.js';

interface CliStatsOptions {
  dir?: string;
  logDir?: string;
  date?: string;
  week?: string;
  month?: string;
  byHour?: boolean;
  byModel?: boolean;
  json?: boolean;
}

function resolveConfigDir(options: CliStatsOptions): string {
  if (options.dir) {
    return options.dir;
  }
  if (options.logDir) {
    // If logDir is provided, derive configDir as its parent
    return options.logDir.replace(/\/[^/]+\/?$/, '');
  }
  return getLogDir().replace(/\/[^/]+\/?$/, '');
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
  const periodType = options.week ? 'week' : options.month ? 'month' : 'day';
  const { start, end } = getPeriodRange(periodType);
  const dateRange = options.date || (options.week || (options.month ? `${options.month}` : `${start} to ${end}`));

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

    const dbManager = DatabaseManager.getInstance(resolveConfigDir(options));
    dbManager.initialize();
    const daily = getDailyBreakdown(dbManager.getDb(), options);
    for (const { date, stats: dateStats } of daily) {
      lines.push(`  ${date}: ${dateStats.requests} 次 | 输入：${dateStats.inputTokens.toLocaleString()} | 输出：${dateStats.outputTokens.toLocaleString()}`);
    }
  }

  // 按小时统计
  if (options.byHour) {
    lines.push('');
    lines.push('按小时分布:');

    const dbManager = DatabaseManager.getInstance(resolveConfigDir(options));
    dbManager.initialize();
    const hourly = getHourlyBreakdown(dbManager.getDb(), options);
    for (const { hour, stats: hourStats } of hourly) {
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

function main() {
  const program = new Command();

  program
    .name('llm-gateway-stats')
    .description('查看代理服务器统计')
    .option('-d, --dir <path>', '工作目录 (默认 ~/.llm-gateway/)')
    .option('-l, --log-dir <path>', '日志目录 (已废弃，使用 --dir 代替)')
    .option('--date <date>', '指定日期 (YYYY-MM-DD)')
    .option('--week <week>', '指定周 (YYYY-Www，如 2026-W13)')
    .option('--month <month>', '指定月份 (YYYY-MM，如 2026-03)')
    .option('--by-hour', '按小时分布统计')
    .option('--by-model', '按模型细分显示（默认开启）')
    .option('--json', '输出 JSON 格式')
    .action((options: CliStatsOptions) => {
      try {
        const configDir = resolveConfigDir(options);

        // 初始化数据库
        const dbManager = DatabaseManager.getInstance(configDir);
        dbManager.initialize();

        // 构建核心库的选项
        const coreOptions: { date?: string; week?: string; month?: string; byHour?: boolean } = {};
        if (options.date) coreOptions.date = options.date;
        if (options.week) coreOptions.week = options.week;
        if (options.month) coreOptions.month = options.month;
        if (options.byHour) coreOptions.byHour = true;

        // 获取统计
        const stats = loadStats(dbManager.getDb(), coreOptions);

        if (stats.totalRequests === 0) {
          const dateRange = options.date || options.week || options.month || '今日';
          console.log(`📁 配置目录：${configDir}`);
          console.log(`❌ ${dateRange} 暂无请求记录`);
          dbManager.close();
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log(formatStats(stats, options));
        }

        dbManager.close();

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
