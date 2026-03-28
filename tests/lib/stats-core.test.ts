import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadStats, StatsEntry } from '@/lib/stats-core';

describe('stats-core 用户过滤', () => {
  const testLogDir = join(process.cwd(), 'test-logs-user-filter');

  beforeEach(() => {
    mkdirSync(testLogDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testLogDir, { recursive: true, force: true });
  });

  function createTestLogFile(filePath: string, entries: StatsEntry[]) {
    const content = entries.map(e => JSON.stringify(e)).join('\n');
    writeFileSync(filePath, content);
  }

  it('应该支持按 userName 过滤日志', () => {
    const today = new Date().toISOString().split('T')[0];
    const logFile = join(testLogDir, `proxy-${today}.log`);

    const entries: StatsEntry[] = [
      {
        timestamp: new Date().toISOString(),
        customModel: 'gpt-4',
        provider: 'openai',
        statusCode: 200,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        userName: 'user1'
      },
      {
        timestamp: new Date().toISOString(),
        customModel: 'gpt-4',
        provider: 'openai',
        statusCode: 200,
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        userName: 'user2'
      },
      {
        timestamp: new Date().toISOString(),
        customModel: 'gpt-4',
        provider: 'openai',
        statusCode: 200,
        promptTokens: 150,
        completionTokens: 75,
        totalTokens: 225,
        userName: 'user1'
      }
    ];

    createTestLogFile(logFile, entries);

    // 测试过滤 user1
    const statsUser1 = loadStats(testLogDir, { userName: 'user1' });
    expect(statsUser1.totalRequests).toBe(2);
    expect(statsUser1.totalTokens).toBe(375); // 150 + 225

    // 测试过滤 user2
    const statsUser2 = loadStats(testLogDir, { userName: 'user2' });
    expect(statsUser2.totalRequests).toBe(1);
    expect(statsUser2.totalTokens).toBe(300);

    // 测试不过滤
    const statsAll = loadStats(testLogDir);
    expect(statsAll.totalRequests).toBe(3);
    expect(statsAll.totalTokens).toBe(675);
  });

  it('应该支持按 userName 和日期同时过滤', () => {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    
    const todayFile = join(testLogDir, `proxy-${today}.log`);
    const yesterdayFile = join(testLogDir, `proxy-${yesterday}.log`);

    const todayEntries: StatsEntry[] = [
      {
        timestamp: new Date().toISOString(),
        customModel: 'gpt-4',
        provider: 'openai',
        statusCode: 200,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        userName: 'user1'
      },
      {
        timestamp: new Date().toISOString(),
        customModel: 'gpt-4',
        provider: 'openai',
        statusCode: 200,
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        userName: 'user2'
      }
    ];

    const yesterdayEntries: StatsEntry[] = [
      {
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        customModel: 'gpt-4',
        provider: 'openai',
        statusCode: 200,
        promptTokens: 50,
        completionTokens: 25,
        totalTokens: 75,
        userName: 'user1'
      }
    ];

    createTestLogFile(todayFile, todayEntries);
    createTestLogFile(yesterdayFile, yesterdayEntries);

    // 测试过滤 user1 且只看今天
    const statsUser1Today = loadStats(testLogDir, { date: today, userName: 'user1' });
    expect(statsUser1Today.totalRequests).toBe(1);
    expect(statsUser1Today.totalTokens).toBe(150);

    // 测试过滤 user2 且只看今天
    const statsUser2Today = loadStats(testLogDir, { date: today, userName: 'user2' });
    expect(statsUser2Today.totalRequests).toBe(1);
    expect(statsUser2Today.totalTokens).toBe(300);
  });

  it('当 userName 不存在时应该返回空统计', () => {
    const today = new Date().toISOString().split('T')[0];
    const logFile = join(testLogDir, `proxy-${today}.log`);

    const entries: StatsEntry[] = [
      {
        timestamp: new Date().toISOString(),
        customModel: 'gpt-4',
        provider: 'openai',
        statusCode: 200,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        userName: 'user1'
      }
    ];

    createTestLogFile(logFile, entries);

    // 过滤不存在的用户
    const statsNonExistent = loadStats(testLogDir, { userName: 'nonexistent' });
    expect(statsNonExistent.totalRequests).toBe(0);
    expect(statsNonExistent.totalTokens).toBe(0);
  });

  it('应该正确处理没有 userName 字段的日志条目', () => {
    const today = new Date().toISOString().split('T')[0];
    const logFile = join(testLogDir, `proxy-${today}.log`);

    const entries: StatsEntry[] = [
      {
        timestamp: new Date().toISOString(),
        customModel: 'gpt-4',
        provider: 'openai',
        statusCode: 200,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150
        // 没有 userName 字段
      },
      {
        timestamp: new Date().toISOString(),
        customModel: 'gpt-4',
        provider: 'openai',
        statusCode: 200,
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        userName: 'user1'
      }
    ];

    createTestLogFile(logFile, entries);

    // 过滤 user1，应该只返回有 userName 且匹配的条目
    const statsUser1 = loadStats(testLogDir, { userName: 'user1' });
    expect(statsUser1.totalRequests).toBe(1);
    expect(statsUser1.totalTokens).toBe(300);

    // 不过滤，应该返回所有条目
    const statsAll = loadStats(testLogDir);
    expect(statsAll.totalRequests).toBe(2);
    expect(statsAll.totalTokens).toBe(450);
  });
});
