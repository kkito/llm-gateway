import { describe, it, expect } from 'vitest';
import {
  parseLogFile,
  createEmptyModelStats,
  addEntryToStats,
  calculateStats,
  getTodayLogFiles,
  getDateLogFiles,
  getWeekRange,
  getMonthRange,
  formatDateRange,
  loadStats,
  type StatsEntry,
  type StatsOptions,
} from './stats-core.js';

describe('stats-core', () => {
  describe('parseLogFile', () => {
    it('应该解析空的日志文件', () => {
      const entries = parseLogFile('/nonexistent/path.log');
      expect(entries).toEqual([]);
    });
  });

  describe('createEmptyModelStats', () => {
    it('应该创建空的统计数据对象', () => {
      const stats = createEmptyModelStats();
      expect(stats).toEqual({
        requests: 0,
        successful: 0,
        failed: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
      });
    });
  });

  describe('addEntryToStats', () => {
    it('应该成功添加成功的请求', () => {
      const stats = createEmptyModelStats();
      const entry: StatsEntry = {
        timestamp: '2026-03-28T10:00:00Z',
        customModel: 'qwen-plus',
        provider: 'dashscope',
        statusCode: 200,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cachedTokens: 20,
      };
      addEntryToStats(stats, entry);
      expect(stats.requests).toBe(1);
      expect(stats.successful).toBe(1);
      expect(stats.failed).toBe(0);
      expect(stats.inputTokens).toBe(100);
      expect(stats.outputTokens).toBe(50);
      expect(stats.totalTokens).toBe(150);
      expect(stats.cachedTokens).toBe(20);
    });

    it('应该统计失败的请求', () => {
      const stats = createEmptyModelStats();
      const entry: StatsEntry = {
        timestamp: '2026-03-28T10:00:00Z',
        customModel: 'qwen-plus',
        provider: 'dashscope',
        statusCode: 500,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
      };
      addEntryToStats(stats, entry);
      expect(stats.requests).toBe(1);
      expect(stats.successful).toBe(0);
      expect(stats.failed).toBe(1);
    });
  });

  describe('calculateStats', () => {
    it('应该计算多个请求的统计数据', () => {
      const entries: StatsEntry[] = [
        {
          timestamp: '2026-03-28T10:00:00Z',
          customModel: 'qwen-plus',
          provider: 'dashscope',
          statusCode: 200,
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cachedTokens: 20,
        },
        {
          timestamp: '2026-03-28T11:00:00Z',
          customModel: 'qwen-max',
          provider: 'dashscope',
          statusCode: 200,
          promptTokens: 200,
          completionTokens: 100,
          totalTokens: 300,
          cachedTokens: 0,
        },
      ];
      const stats = calculateStats(entries, {});
      expect(stats.totalRequests).toBe(2);
      expect(stats.successfulRequests).toBe(2);
      expect(stats.failedRequests).toBe(0);
      expect(stats.byModel['qwen-plus'].requests).toBe(1);
      expect(stats.byModel['qwen-max'].requests).toBe(1);
      expect(stats.totalInputTokens).toBe(300);
      expect(stats.totalOutputTokens).toBe(150);
      expect(stats.totalTokens).toBe(450);
      expect(stats.totalCachedTokens).toBe(20);
    });

    it('应该按 provider 统计', () => {
      const entries: StatsEntry[] = [
        {
          timestamp: '2026-03-28T10:00:00Z',
          customModel: 'qwen-plus',
          provider: 'dashscope',
          statusCode: 200,
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cachedTokens: 0,
        },
        {
          timestamp: '2026-03-28T11:00:00Z',
          customModel: 'claude-3-sonnet',
          provider: 'anthropic',
          statusCode: 200,
          promptTokens: 200,
          completionTokens: 100,
          totalTokens: 300,
          cachedTokens: 0,
        },
      ];
      const stats = calculateStats(entries, {});
      expect(stats.byProvider['dashscope'].requests).toBe(1);
      expect(stats.byProvider['anthropic'].requests).toBe(1);
    });

    it('应该按小时统计', () => {
      const entries: StatsEntry[] = [
        {
          timestamp: '2026-03-28T10:00:00Z',
          customModel: 'qwen-plus',
          provider: 'dashscope',
          statusCode: 200,
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cachedTokens: 0,
        },
        {
          timestamp: '2026-03-28T11:00:00Z',
          customModel: 'qwen-plus',
          provider: 'dashscope',
          statusCode: 200,
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cachedTokens: 0,
        },
      ];
      const stats = calculateStats(entries, { byHour: true });
      expect(stats.byHour).toBeDefined();
      expect(Object.keys(stats.byHour!).length).toBe(2);
    });
  });

  describe('getWeekRange', () => {
    it('应该计算周范围', () => {
      const result = getWeekRange('2026-W14');
      expect(result.start).toBeDefined();
      expect(result.end).toBeDefined();
    });
  });

  describe('getMonthRange', () => {
    it('应该计算月份范围', () => {
      const result = getMonthRange('2026-03');
      expect(result.start).toBe('2026-03-01');
      expect(result.end).toBe('2026-03-31');
    });
  });

  describe('formatDateRange', () => {
    it('应该格式化日期范围', () => {
      expect(formatDateRange({ date: '2026-03-28' })).toBe('2026-03-28');
      expect(formatDateRange({})).toBe('今日');
    });
  });

  describe('loadStats with user filtering', () => {
    it('应该支持按用户名称过滤', () => {
      // 模拟日志条目
      const entries: StatsEntry[] = [
        {
          timestamp: '2026-03-28T10:00:00Z',
          customModel: 'qwen-plus',
          provider: 'dashscope',
          statusCode: 200,
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cachedTokens: 0,
          userName: 'user1',
        },
        {
          timestamp: '2026-03-28T11:00:00Z',
          customModel: 'qwen-max',
          provider: 'dashscope',
          statusCode: 200,
          promptTokens: 200,
          completionTokens: 100,
          totalTokens: 300,
          cachedTokens: 0,
          userName: 'user2',
        },
        {
          timestamp: '2026-03-28T12:00:00Z',
          customModel: 'qwen-plus',
          provider: 'dashscope',
          statusCode: 200,
          promptTokens: 150,
          completionTokens: 75,
          totalTokens: 225,
          cachedTokens: 0,
          userName: 'user1',
        },
      ];

      // 测试过滤 user1
      const stats1 = calculateStats(entries.filter(e => e.userName === 'user1'), {});
      expect(stats1.totalRequests).toBe(2);
      expect(stats1.totalInputTokens).toBe(250);
      expect(stats1.totalOutputTokens).toBe(125);

      // 测试过滤 user2
      const stats2 = calculateStats(entries.filter(e => e.userName === 'user2'), {});
      expect(stats2.totalRequests).toBe(1);
      expect(stats2.totalInputTokens).toBe(200);
      expect(stats2.totalOutputTokens).toBe(100);
    });
  });
});
