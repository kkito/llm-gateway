import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UsageTracker } from '../../src/lib/usage-tracker.js';
import { RateLimiter } from '../../src/lib/rate-limiter.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('UsageTracker 单例模式', () => {
  let testLogDir: string;

  beforeEach(() => {
    // 创建临时日志目录
    testLogDir = mkdtempSync(join(tmpdir(), 'usage-tracker-test-'));
    // 重置单例状态
    UsageTracker.resetInstance();
  });

  afterEach(() => {
    // 清理临时目录
    try {
      rmSync(testLogDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
    // 重置单例状态
    UsageTracker.resetInstance();
  });

  it('多次调用 getInstance 应返回同一实例', () => {
    const instance1 = UsageTracker.getInstance(testLogDir);
    const instance2 = UsageTracker.getInstance(testLogDir);
    const instance3 = UsageTracker.getInstance(testLogDir);

    expect(instance1).toBe(instance2);
    expect(instance2).toBe(instance3);
  });

  it('logDir 不匹配时应抛出错误', () => {
    const anotherDir = mkdtempSync(join(tmpdir(), 'usage-tracker-test-'));
    
    // 第一次创建实例
    UsageTracker.getInstance(testLogDir);
    
    // 第二次使用不同的 logDir 应该抛错
    expect(() => UsageTracker.getInstance(anotherDir)).toThrow('logDir mismatch');
    
    // 清理
    try {
      rmSync(anotherDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  it('resetInstance 后可以重新创建实例', () => {
    const instance1 = UsageTracker.getInstance(testLogDir);
    
    // 重置
    UsageTracker.resetInstance();
    
    // 重新获取应该可以成功
    const instance2 = UsageTracker.getInstance(testLogDir);
    
    // 应该是不同的实例
    expect(instance1).not.toBe(instance2);
  });

  it('RateLimiter 应使用与 UsageTracker 相同的单例实例', () => {
    // 创建 UsageTracker 实例
    const usageTracker = UsageTracker.getInstance(testLogDir);
    
    // 创建 RateLimiter（内部会调用 getInstance）
    const rateLimiter = new RateLimiter(testLogDir);
    
    // 获取 RateLimiter 内部的 tracker
    const trackerFromRateLimiter = rateLimiter.getTracker();
    
    // 应该是同一个实例
    expect(usageTracker).toBe(trackerFromRateLimiter);
  });

  it('多个 RateLimiter 实例应共享同一个 UsageTracker', () => {
    const rateLimiter1 = new RateLimiter(testLogDir);
    const rateLimiter2 = new RateLimiter(testLogDir);
    
    expect(rateLimiter1.getTracker()).toBe(rateLimiter2.getTracker());
  });

  it('记录用量后应能在同一实例中读取', async () => {
    const usageTracker = UsageTracker.getInstance(testLogDir);
    const rateLimiter = new RateLimiter(testLogDir);
    
    // 确保是同一实例
    expect(usageTracker).toBe(rateLimiter.getTracker());
    
    // 获取计数器
    const counter = usageTracker.getCounter('test-model');
    
    // 初始值应为 0
    expect(counter.today.requests).toBe(0);
    
    // 通过 RateLimiter 记录用量
    const mockLogEntry = {
      timestamp: new Date().toISOString(),
      requestId: 'test-request',
      customModel: 'test-model',
      endpoint: '/v1/chat/completions',
      method: 'POST' as const,
      statusCode: 200,
      durationMs: 100,
      isStreaming: false,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedTokens: null,
      userName: 'test-user'
    };
    
    rateLimiter.recordUsage('test-model', mockLogEntry, undefined);
    
    // 再次获取计数器，验证用量已记录
    const counterAfter = usageTracker.getCounter('test-model');
    expect(counterAfter.today.requests).toBe(1);
    expect(counterAfter.today.inputTokens).toBe(100);
  });
});
