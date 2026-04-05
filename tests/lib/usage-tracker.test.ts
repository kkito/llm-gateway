import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { UsageTracker } from '../../src/lib/usage-tracker.js';
import type { LogEntry } from '../../src/logger.js';
import type { ModelLimit } from '../../src/config.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('usage-tracker', () => {
  const testLogDir = join(tmpdir(), 'test-usage-tracker-' + Date.now());
  let tracker: UsageTracker;

  beforeEach(() => {
    if (!existsSync(testLogDir)) {
      mkdirSync(testLogDir, { recursive: true });
    }
    tracker = new UsageTracker(testLogDir);
  });

  afterEach(() => {
    try {
      if (existsSync(testLogDir)) {
        rmSync(testLogDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('getCounter', () => {
    it('should create new counter for unknown model', () => {
      const counter = tracker.getCounter('test-model');
      expect(counter.model).toBe('test-model');
      expect(counter.today.loaded).toBe(false);
      expect(counter.today.requests).toBe(0);
    });

    it('should return same counter for same model', () => {
      const counter1 = tracker.getCounter('test-model');
      const counter2 = tracker.getCounter('test-model');
      expect(counter1).toBe(counter2);
    });
  });

  describe('recordUsage', () => {
    const pricing = {
      inputPricePer1M: 10.0,
      outputPricePer1M: 30.0,
      cachedPricePer1M: 0
    };

    it('should update today counter', () => {
      const counter = tracker.getCounter('test-model');
      
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: 'test-1',
        customModel: 'test-model',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        statusCode: 200,
        durationMs: 100,
        isStreaming: false,
        promptTokens: 1000,
        completionTokens: 500
      };
      
      tracker.recordUsage('test-model', entry, pricing);
      
      expect(counter.today.requests).toBe(1);
      expect(counter.today.inputTokens).toBe(1000);
      expect(counter.today.cost).toBeCloseTo(0.01 + 0.015, 4); // (1000/1M * 10) + (500/1M * 30)
    });

    it('should update all period counters', () => {
      const counter = tracker.getCounter('test-model');
      
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: 'test-1',
        customModel: 'test-model',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        statusCode: 200,
        durationMs: 100,
        isStreaming: false,
        promptTokens: 1000
      };
      
      tracker.recordUsage('test-model', entry, pricing);
      
      expect(counter.today.requests).toBe(1);
      expect(counter.thisWeek.requests).toBe(1);
      expect(counter.thisMonth.requests).toBe(1);
    });

    it('should update sliding windows', () => {
      const counter = tracker.getCounter('test-model');
      // 先初始化一个滑动窗口
      counter.slidingWindows.set(5, {
        windowHours: 5,
        entries: [],
        loaded: true
      });
      
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: 'test-1',
        customModel: 'test-model',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        statusCode: 200,
        durationMs: 100,
        isStreaming: false,
        promptTokens: 1000
      };
      
      tracker.recordUsage('test-model', entry, undefined);
      
      const window = counter.slidingWindows.get(5);
      expect(window?.entries.length).toBe(1);
      expect(window?.entries[0].inputTokens).toBe(1000);
    });

    it('should accumulate multiple requests', () => {
      const counter = tracker.getCounter('test-model');
      
      const entry1: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: 'test-1',
        customModel: 'test-model',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        statusCode: 200,
        durationMs: 100,
        isStreaming: false,
        promptTokens: 1000
      };
      
      const entry2: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: 'test-2',
        customModel: 'test-model',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        statusCode: 200,
        durationMs: 100,
        isStreaming: false,
        promptTokens: 2000
      };
      
      tracker.recordUsage('test-model', entry1, pricing);
      tracker.recordUsage('test-model', entry2, pricing);
      
      expect(counter.today.requests).toBe(2);
      expect(counter.today.inputTokens).toBe(3000);
    });
  });

  describe('getCurrentUsage', () => {
    it('should return requests count for day period', () => {
      const counter = tracker.getCounter('test-model');
      counter.today.requests = 50;
      counter.today.inputTokens = 10000;
      counter.today.cost = 5.5;
      counter.today.loaded = true;
      
      const limit: ModelLimit = {
        type: 'requests',
        period: 'day',
        max: 100
      };
      
      const usage = tracker.getCurrentUsage(counter, limit);
      expect(usage).toBe(50);
    });

    it('should return input tokens for day period', () => {
      const counter = tracker.getCounter('test-model');
      counter.today.inputTokens = 10000;
      counter.today.loaded = true;
      
      const limit: ModelLimit = {
        type: 'input_tokens',
        period: 'day',
        max: 50000
      };
      
      const usage = tracker.getCurrentUsage(counter, limit);
      expect(usage).toBe(10000);
    });

    it('should return cost for month period', () => {
      const counter = tracker.getCounter('test-model');
      counter.thisMonth.cost = 250.5;
      counter.thisMonth.loaded = true;
      
      const limit: ModelLimit = {
        type: 'cost',
        period: 'month',
        max: 500
      };
      
      const usage = tracker.getCurrentUsage(counter, limit);
      expect(usage).toBe(250.5);
    });

    it('should return 0 for empty sliding window', () => {
      const counter = tracker.getCounter('test-model');
      
      const limit: ModelLimit = {
        type: 'requests',
        period: 'hours',
        periodValue: 5,
        max: 50
      };
      
      const usage = tracker.getCurrentUsage(counter, limit);
      expect(usage).toBe(0);
    });
  });

  describe('ensureLoaded', () => {
    it('should load from log files on first access', async () => {
      // 创建测试日志文件（使用本地日期，与 getTodayDate() 一致）
      const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
      const logFile = join(testLogDir, `proxy-${today}.log`);
      
      const logEntry = {
        timestamp: new Date().toISOString(),
        requestId: 'test-1',
        customModel: 'test-model',
        realModel: 'gpt-4',
        provider: 'openai',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        statusCode: 200,
        durationMs: 100,
        isStreaming: false,
        promptTokens: 1000,
        completionTokens: 500
      };
      
      writeFileSync(logFile, JSON.stringify(logEntry) + '\n', 'utf-8');
      
      const pricing = {
        inputPricePer1M: 10.0,
        outputPricePer1M: 30.0,
        cachedPricePer1M: 0
      };
      
      const counter = tracker.getCounter('test-model');
      await tracker.ensureLoaded(counter, 'day', undefined, pricing);
      
      expect(counter.today.loaded).toBe(true);
      expect(counter.today.requests).toBe(1);
      expect(counter.today.inputTokens).toBe(1000);
    });

    it('should not reload if already loaded for same day', async () => {
      const pricing = {
        inputPricePer1M: 10.0,
        outputPricePer1M: 30.0,
        cachedPricePer1M: 0
      };
      
      const counter = tracker.getCounter('test-model');
      counter.today.loaded = true;
      counter.today.requests = 50;
      
      await tracker.ensureLoaded(counter, 'day', undefined, pricing);
      
      expect(counter.today.requests).toBe(50); // 应该保持不变
    });
  });

  describe('cleanupSlidingWindows', () => {
    it('should remove expired entries from sliding windows', () => {
      const counter = tracker.getCounter('test-model');
      const now = Date.now() / 1000;
      
      // 添加一个过期条目（10 小时前）
      counter.slidingWindows.set(5, {
        windowHours: 5,
        entries: [
          {
            timestamp: now - (10 * 3600), // 10 小时前
            requests: 1,
            inputTokens: 1000,
            cost: 0.01
          },
          {
            timestamp: now - (1 * 3600), // 1 小时前
            requests: 1,
            inputTokens: 2000,
            cost: 0.02
          }
        ],
        loaded: true
      });
      
      tracker.cleanupSlidingWindows();
      
      const window = counter.slidingWindows.get(5);
      expect(window?.entries.length).toBe(1); // 只保留 1 小时前的条目
      expect(window?.entries[0].inputTokens).toBe(2000);
    });
  });

  describe('multi-model isolation', () => {
    it('should keep counters separate for different models', () => {
      const pricing = {
        inputPricePer1M: 10.0,
        outputPricePer1M: 30.0,
        cachedPricePer1M: 0
      };
      
      // 先获取计数器
      const counterA = tracker.getCounter('model-a');
      const counterB = tracker.getCounter('model-b');
      
      const entry1: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: 'test-1',
        customModel: 'model-a',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        statusCode: 200,
        durationMs: 100,
        isStreaming: false,
        promptTokens: 1000
      };
      
      const entry2: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: 'test-2',
        customModel: 'model-b',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        statusCode: 200,
        durationMs: 100,
        isStreaming: false,
        promptTokens: 2000
      };
      
      // 直接更新已获取的计数器
      tracker.recordUsage('model-a', entry1, pricing);
      tracker.recordUsage('model-b', entry2, pricing);
      
      // 验证计数器是独立的
      expect(counterA.today.requests).toBe(1);
      expect(counterA.today.inputTokens).toBe(1000);
      
      expect(counterB.today.requests).toBe(1);
      expect(counterB.today.inputTokens).toBe(2000);
    });
  });
});
