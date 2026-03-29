import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../../src/lib/rate-limiter.js';
import type { ModelLimit } from '../../src/config.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('rate-limiter', () => {
  const testLogDir = join(tmpdir(), 'test-rate-limiter-' + Date.now());
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    if (!existsSync(testLogDir)) {
      mkdirSync(testLogDir, { recursive: true });
    }
    rateLimiter = new RateLimiter(testLogDir);
  });

  afterEach(() => {
    try {
      if (existsSync(testLogDir)) {
        rmSync(testLogDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('checkLimits - no limits', () => {
    it('should return exceeded: false when no limits configured', async () => {
      const config = {
        customModel: 'test-model',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const
      };

      const result = await rateLimiter.checkLimits(config, testLogDir);
      expect(result.exceeded).toBe(false);
    });

    it('should return exceeded: false when limits array is empty', async () => {
      const config = {
        customModel: 'test-model',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const,
        limits: []
      };

      const result = await rateLimiter.checkLimits(config, testLogDir);
      expect(result.exceeded).toBe(false);
    });
  });

  describe('checkLimits - requests limit', () => {
    it('should allow requests under limit', async () => {
      const config = {
        customModel: 'test-model',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const,
        limits: [
          { type: 'requests' as const, period: 'day' as const, max: 100 }
        ]
      };

      // 手动设置计数器
      const tracker = rateLimiter.getTracker();
      const counter = tracker.getCounter('test-model');
      counter.today.requests = 50;
      counter.today.loaded = true;

      const result = await rateLimiter.checkLimits(config, testLogDir);
      expect(result.exceeded).toBe(false);
    });

    it('should block requests at limit', async () => {
      const config = {
        customModel: 'test-model',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const,
        limits: [
          { type: 'requests' as const, period: 'day' as const, max: 100 }
        ]
      };

      const tracker = rateLimiter.getTracker();
      const counter = tracker.getCounter('test-model');
      counter.today.requests = 100;
      counter.today.loaded = true;

      const result = await rateLimiter.checkLimits(config, testLogDir);
      expect(result.exceeded).toBe(true);
      expect(result.limit?.type).toBe('requests');
      expect(result.current).toBe(100);
      expect(result.message).toContain('Daily request count limit (100) reached');
    });
  });

  describe('checkLimits - input_tokens limit', () => {
    it('should allow under token limit', async () => {
      const config = {
        customModel: 'test-model',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const,
        limits: [
          { type: 'input_tokens' as const, period: 'day' as const, max: 50000 }
        ]
      };

      const tracker = rateLimiter.getTracker();
      const counter = tracker.getCounter('test-model');
      counter.today.inputTokens = 10000;
      counter.today.loaded = true;

      const result = await rateLimiter.checkLimits(config, testLogDir);
      expect(result.exceeded).toBe(false);
    });

    it('should block at token limit', async () => {
      const config = {
        customModel: 'test-model',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const,
        limits: [
          { type: 'input_tokens' as const, period: 'day' as const, max: 50000 }
        ]
      };

      const tracker = rateLimiter.getTracker();
      const counter = tracker.getCounter('test-model');
      counter.today.inputTokens = 50000;
      counter.today.loaded = true;

      const result = await rateLimiter.checkLimits(config, testLogDir);
      expect(result.exceeded).toBe(true);
      expect(result.message).toContain('Daily input token limit (50000) reached');
    });
  });

  describe('checkLimits - cost limit', () => {
    const pricing = {
      inputPricePer1M: 10.0,
      outputPricePer1M: 30.0,
      cachedPricePer1M: 0
    };

    it('should allow under cost limit', async () => {
      const config = {
        customModel: 'test-model',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const,
        inputPricePer1M: pricing.inputPricePer1M,
        outputPricePer1M: pricing.outputPricePer1M,
        cachedPricePer1M: pricing.cachedPricePer1M,
        limits: [
          { type: 'cost' as const, period: 'month' as const, max: 500 }
        ]
      };

      const tracker = rateLimiter.getTracker();
      const counter = tracker.getCounter('test-model');
      counter.thisMonth.cost = 100;
      counter.thisMonth.loaded = true;

      const result = await rateLimiter.checkLimits(config, testLogDir);
      expect(result.exceeded).toBe(false);
    });

    it('should block at cost limit', async () => {
      const config = {
        customModel: 'test-model',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const,
        inputPricePer1M: pricing.inputPricePer1M,
        outputPricePer1M: pricing.outputPricePer1M,
        cachedPricePer1M: pricing.cachedPricePer1M,
        limits: [
          { type: 'cost' as const, period: 'month' as const, max: 500 }
        ]
      };

      const tracker = rateLimiter.getTracker();
      const counter = tracker.getCounter('test-model');
      counter.thisMonth.cost = 500;
      counter.thisMonth.loaded = true;

      const result = await rateLimiter.checkLimits(config, testLogDir);
      expect(result.exceeded).toBe(true);
      expect(result.message).toContain('Monthly cost limit ($500) reached');
    });

    it('should throw error when cost limit without pricing', async () => {
      const config = {
        customModel: 'test-model',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const,
        limits: [
          { type: 'cost' as const, period: 'month' as const, max: 500 }
        ]
      };

      await expect(rateLimiter.checkLimits(config, testLogDir))
        .rejects.toThrow('Cost limit requires pricing configuration');
    });
  });

  describe('checkLimits - multiple limits', () => {
    it('should block when any limit is exceeded', async () => {
      const config = {
        customModel: 'test-model',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const,
        inputPricePer1M: 10.0,
        outputPricePer1M: 30.0,
        cachedPricePer1M: 0,
        limits: [
          { type: 'requests' as const, period: 'day' as const, max: 100 },
          { type: 'input_tokens' as const, period: 'day' as const, max: 50000 },
          { type: 'cost' as const, period: 'month' as const, max: 500 }
        ]
      };

      const tracker = rateLimiter.getTracker();
      const counter = tracker.getCounter('test-model');
      
      // 设置 requests 达到限制
      counter.today.requests = 100;
      counter.today.inputTokens = 10000;
      counter.thisMonth.cost = 100;
      counter.today.loaded = true;
      counter.thisMonth.loaded = true;

      const result = await rateLimiter.checkLimits(config, testLogDir);
      expect(result.exceeded).toBe(true);
      expect(result.limit?.type).toBe('requests');
    });

    it('should check limits in order', async () => {
      const config = {
        customModel: 'test-model',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai' as const,
        limits: [
          { type: 'requests' as const, period: 'day' as const, max: 100 },
          { type: 'input_tokens' as const, period: 'day' as const, max: 50000 }
        ]
      };

      const tracker = rateLimiter.getTracker();
      const counter = tracker.getCounter('test-model');
      
      // 设置 input_tokens 达到限制，但 requests 未达到
      counter.today.requests = 50;
      counter.today.inputTokens = 50000;
      counter.today.loaded = true;

      const result = await rateLimiter.checkLimits(config, testLogDir);
      expect(result.exceeded).toBe(true);
      // 应该先检查 requests，所以不会到 input_tokens
      expect(result.limit?.type).toBe('input_tokens');
    });
  });

  describe('createErrorResponse', () => {
    it('should create proper error response format', () => {
      const message = 'Rate limit exceeded';
      const response = rateLimiter.createErrorResponse(message);

      expect(response.error.message).toBe(message);
      expect(response.error.type).toBe('rate_limit_error');
      expect(response.error.param).toBe(null);
      expect(response.error.code).toBe('rate_limit_exceeded');
    });
  });

  describe('recordUsage', () => {
    it('should record usage for model', () => {
      const tracker = rateLimiter.getTracker();
      const counter = tracker.getCounter('test-model');
      
      const entry = {
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

      const pricing = {
        inputPricePer1M: 10.0,
        outputPricePer1M: 30.0,
        cachedPricePer1M: 0
      };

      rateLimiter.recordUsage('test-model', entry, pricing);

      expect(counter.today.requests).toBe(1);
      expect(counter.today.inputTokens).toBe(1000);
    });
  });
});
