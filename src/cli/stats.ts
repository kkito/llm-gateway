#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'fs';
import { join } from 'path';
import { getProxyDir } from '../config.js';
import { 
  loadStats, 
  formatDateRange, 
  getLogFilesForRange,
  parseLogFile,
  createEmptyModelStats,
  type StatsOptions,
  type Stats,
  type ModelStats
} from '../lib/stats-core.js';

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

function resolveLogDir(options: CliStatsOptions): string {
  const defaultDir = getProxyDir();
  const userDir = options.dir || defaultDir;

  if (options.logDir) {
    return options.logDir;
  }
  return join(userDir, 'logs/proxy');
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

function main() {
  const program = new Command();

  program
    .name('llm-gateway-stats')
    .description('查看代理服务器统计')
    .option('-d, --dir <path>', '工作目录 (默认 ~/.llm-gateway/)')
    .option('-l, --log-dir <path>', '日志目录')
    .option('--date <date>', '指定日期 (YYYY-MM-DD)')
    .option('--week <week>', '指定周 (YYYY-Www，如 2026-W13)')
    .option('--month <month>', '指定月份 (YYYY-MM，如 2026-03)')
    .option('--by-hour', '按小时分布统计')
    .option('--by-model', '按模型细分显示（默认开启）')
    .option('--json', '输出 JSON 格式')
    .action((options: CliStatsOptions) => {
      try {
        const logDir = resolveLogDir(options);
        
        // 构建核心库的选项
        const coreOptions: StatsOptions = {};
        if (options.date) coreOptions.date = options.date;
        if (options.week) coreOptions.week = options.week;
        if (options.month) coreOptions.month = options.month;
        if (options.byHour) coreOptions.byHour = true;
        
        // 获取日志文件列表
        const logFiles = getLogFilesForRange(logDir, coreOptions);
        
        if (logFiles.length === 0) {
          const dateRange = formatDateRange(coreOptions);
          console.log(`📁 日志目录：${logDir}`);
          console.log(`❌ ${dateRange} 暂无日志文件`);
          return;
        }

        // 解析所有日志文件
        let entries: any[] = [];
        for (const file of logFiles) {
          entries = entries.concat(parseLogFile(file));
        }

        if (entries.length === 0) {
          const dateRange = formatDateRange(coreOptions);
          console.log(`📁 日志目录：${logDir}`);
          console.log(`📄 日志文件：${logFiles.length} 个`);
          console.log(`❌ ${dateRange} 暂无请求记录`);
          return;
        }

        // 计算统计
        const stats = loadStats(logDir, coreOptions);

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
