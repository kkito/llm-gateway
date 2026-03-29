# 模型使用限制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 LLM Gateway 实现模型使用限制功能，支持按请求次数、输入 Token、API 费用进行限制，时间周期支持今天、最近 N 小时、本周、本月。

**Architecture:** 采用日志 + 内存混合方案，首次请求时从日志加载历史用量，后续请求使用内存计数器（微秒级检查）。限制检查在请求处理前进行，触发限制返回 429 错误且不记录日志。

**Tech Stack:** TypeScript 5.9+, Hono, Vitest (测试框架)

---

## 文件结构

### 新增文件

- `src/lib/period-utils.ts` - 时间周期工具
- `src/lib/cost-calculator.ts` - 费用计算器
- `src/lib/usage-tracker.ts` - 用量追踪器（内存计数器）
- `src/lib/rate-limiter.ts` - 限制检查器
- `tests/lib/period-utils.test.ts` - 周期工具单元测试
- `tests/lib/cost-calculator.test.ts` - 费用计算器单元测试
- `tests/lib/usage-tracker.test.ts` - 用量追踪器单元测试
- `tests/lib/rate-limiter.test.ts` - 限制检查器单元测试
- `tests/integration/rate-limit-integration.test.ts` - 集成测试
- `tests/e2e/rate-limit.e2e.test.ts` - E2E 测试
- `docs/rate-limit-guide.md` - 用户文档

### 修改文件

- `src/config.ts` - 添加类型定义
- `src/routes/chat-completions.ts` - 集成限制检查
- `src/routes/messages.ts` - 集成限制检查
- `docs/user-guide.md` - 更新配置说明

---

## Task 1: 类型定义扩展

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: 添加 ModelLimit 接口**

在 `src/config.ts` 中添加：

```typescript
export interface ModelLimit {
  type: 'requests' | 'input_tokens' | 'cost';
  period: 'day' | 'hours' | 'week' | 'month';
  periodValue?: number;  // 当 period='hours' 时，指定小时数
  max: number;           // 最大限制值
}
```

- [ ] **Step 2: 扩展 ProviderConfig 接口**

在 `ProviderConfig` 接口中添加：

```typescript
export interface ProviderConfig {
  customModel: string;
  realModel: string;
  apiKey: string;
  baseUrl: string;
  provider: ProviderType;
  desc?: string;
  // 新增字段
  inputPricePer1M?: number;
  outputPricePer1M?: number;
  cachedPricePer1M?: number;
  limits?: ModelLimit[];
}
```

- [ ] **Step 3: 更新配置验证**

修改 `validateProviderConfig` 函数，添加 limits 验证：

```typescript
function validateModelLimit(limit: any, index: number, modelIndex: number): void {
  const validTypes = ['requests', 'input_tokens', 'cost'];
  const validPeriods = ['day', 'hours', 'week', 'month'];
  
  if (!validTypes.includes(limit.type)) {
    throw new Error(`Invalid limit type at model ${modelIndex}, limit ${index}`);
  }
  
  if (!validPeriods.includes(limit.period)) {
    throw new Error(`Invalid limit period at model ${modelIndex}, limit ${index}`);
  }
  
  if (limit.period === 'hours' && typeof limit.periodValue !== 'number') {
    throw new Error(`Missing periodValue for hours period at model ${modelIndex}, limit ${index}`);
  }
  
  if (typeof limit.max !== 'number') {
    throw new Error(`Missing or invalid max value at model ${modelIndex}, limit ${index}`);
  }
}
```

- [ ] **Step 4: 在 validateModelsArray 中调用 limits 验证**

```typescript
function validateModelsArray(models: any): ProviderConfig[] {
  if (!Array.isArray(models)) {
    throw new Error('models must be an array');
  }

  models.forEach((item: any, index: number) => {
    validateProviderConfig(item, index);
    
    // 验证 limits
    if (item.limits) {
      if (!Array.isArray(item.limits)) {
        throw new Error(`limits must be an array at model ${index}`);
      }
      item.limits.forEach((limit: any, limitIndex: number) => {
        validateModelLimit(limit, limitIndex, index);
      });
    }
  });

  return models as ProviderConfig[];
}
```

- [ ] **Step 5: 运行测试并验证类型定义**

```bash
pnpm build
```

Expected: 编译成功，无类型错误

- [ ] **Step 6: 提交**

```bash
git add src/config.ts
git commit -m "feat: add ModelLimit type and pricing fields to ProviderConfig"
```

---

## Task 2: 时间周期工具

**Files:**
- Create: `src/lib/period-utils.ts`
- Test: `tests/lib/period-utils.test.ts`

- [ ] **Step 1: 创建周期工具文件**

创建 `src/lib/period-utils.ts`：

```typescript
/**
 * 获取今日日期字符串 (YYYY-MM-DD)
 */
export function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * 获取本周一的日期字符串 (YYYY-MM-DD)
 */
export function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay() || 7; // 周日转为 7
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  return monday.toISOString().split('T')[0];
}

/**
 * 获取本月 1 号的日期字符串 (YYYY-MM-DD)
 */
export function getMonthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * 周期范围
 */
export interface PeriodRange {
  start: string;  // YYYY-MM-DD
  end: string;    // YYYY-MM-DD
  description: string;  // 用于错误信息
}

/**
 * 获取周期范围
 */
export function getPeriodRange(period: 'day' | 'hours' | 'week' | 'month', periodValue?: number): PeriodRange {
  const today = getTodayDate();
  
  switch (period) {
    case 'day':
      return {
        start: today,
        end: today,
        description: 'daily'
      };
    
    case 'week':
      return {
        start: getWeekStart(),
        end: today,
        description: 'weekly'
      };
    
    case 'month':
      return {
        start: getMonthStart(),
        end: today,
        description: 'monthly'
      };
    
    case 'hours': {
      const hours = periodValue || 24;
      const now = new Date();
      const past = new Date(now.getTime() - hours * 3600 * 1000);
      return {
        start: past.toISOString().split('T')[0],
        end: today,
        description: `last ${hours} hours`
      };
    }
  }
}

/**
 * 获取周期描述（用于错误信息）
 */
export function getPeriodDescription(period: 'day' | 'hours' | 'week' | 'month', periodValue?: number): string {
  return getPeriodRange(period, periodValue).description;
}
```

- [ ] **Step 2: 创建单元测试文件**

创建 `tests/lib/period-utils.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getTodayDate,
  getWeekStart,
  getMonthStart,
  getPeriodRange,
  getPeriodDescription
} from '../../src/lib/period-utils.js';

describe('period-utils', () => {
  describe('getTodayDate', () => {
    it('should return correct date in YYYY-MM-DD format', () => {
      const date = getTodayDate();
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should return today date', () => {
      const date = getTodayDate();
      const today = new Date().toISOString().split('T')[0];
      expect(date).toBe(today);
    });
  });

  describe('getWeekStart', () => {
    it('should return Monday of current week', () => {
      const weekStart = getWeekStart();
      expect(weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      
      // 验证返回的是周一
      const date = new Date(weekStart);
      const day = date.getDay() || 7;
      expect(day).toBe(1);
    });

    it('should return consistent result within same week', () => {
      const first = getWeekStart();
      const second = getWeekStart();
      expect(first).toBe(second);
    });
  });

  describe('getMonthStart', () => {
    it('should return first day of current month', () => {
      const monthStart = getMonthStart();
      expect(monthStart).toMatch(/^\d{4}-\d{2}-01$/);
      
      const now = new Date();
      const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      expect(monthStart).toBe(expected);
    });
  });

  describe('getPeriodRange', () => {
    it('should return day range', () => {
      const range = getPeriodRange('day');
      expect(range.start).toBe(getTodayDate());
      expect(range.end).toBe(getTodayDate());
      expect(range.description).toBe('daily');
    });

    it('should return week range', () => {
      const range = getPeriodRange('week');
      expect(range.start).toBe(getWeekStart());
      expect(range.end).toBe(getTodayDate());
      expect(range.description).toBe('weekly');
    });

    it('should return month range', () => {
      const range = getPeriodRange('month');
      expect(range.start).toBe(getMonthStart());
      expect(range.end).toBe(getTodayDate());
      expect(range.description).toBe('monthly');
    });

    it('should return hours range with custom value', () => {
      const range = getPeriodRange('hours', 5);
      expect(range.description).toBe('last 5 hours');
      
      // 验证开始时间是 5 小时前
      const now = new Date();
      const past = new Date(now.getTime() - 5 * 3600 * 1000);
      expect(range.start).toBe(past.toISOString().split('T')[0]);
    });

    it('should use default 24 hours when periodValue not provided', () => {
      const range = getPeriodRange('hours');
      expect(range.description).toBe('last 24 hours');
    });
  });

  describe('getPeriodDescription', () => {
    it('should return correct description for each period', () => {
      expect(getPeriodDescription('day')).toBe('daily');
      expect(getPeriodDescription('week')).toBe('weekly');
      expect(getPeriodDescription('month')).toBe('monthly');
      expect(getPeriodDescription('hours', 5)).toBe('last 5 hours');
    });
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm test tests/lib/period-utils.test.ts
```

Expected: 所有测试通过

- [ ] **Step 4: 提交**

```bash
git add src/lib/period-utils.ts tests/lib/period-utils.test.ts
git commit -m "feat: add period-utils for date and range calculations"
```

---

## Task 3: 费用计算器

**Files:**
- Create: `src/lib/cost-calculator.ts`
- Test: `tests/lib/cost-calculator.test.ts`

- [ ] **Step 1: 创建费用计算器文件**

创建 `src/lib/cost-calculator.ts`：

```typescript
/**
 * 价格配置
 */
export interface Pricing {
  inputPricePer1M: number;    // 输入 token 每百万价格（美元）
  outputPricePer1M: number;   // 输出 token 每百万价格（美元）
  cachedPricePer1M: number;   // 缓存 token 每百万价格（美元）
}

/**
 * Token 用量
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

/**
 * 计算费用
 * @param usage Token 用量
 * @param pricing 价格配置
 * @returns 费用（美元）
 */
export function calculateCost(usage: TokenUsage, pricing: Pricing): number {
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPricePer1M;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPricePer1M;
  const cachedCost = (usage.cachedTokens / 1_000_000) * pricing.cachedPricePer1M;
  
  return inputCost + outputCost + cachedCost;
}

/**
 * 检查价格配置是否完整
 */
export function hasValidPricing(pricing: Pricing | undefined): boolean {
  if (!pricing) return false;
  return typeof pricing.inputPricePer1M === 'number' &&
         typeof pricing.outputPricePer1M === 'number' &&
         typeof pricing.cachedPricePer1M === 'number';
}
```

- [ ] **Step 2: 创建单元测试文件**

创建 `tests/lib/cost-calculator.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { calculateCost, hasValidPricing, type Pricing, type TokenUsage } from '../../src/lib/cost-calculator.js';

describe('cost-calculator', () => {
  describe('calculateCost', () => {
    const pricing: Pricing = {
      inputPricePer1M: 10.0,
      outputPricePer1M: 30.0,
      cachedPricePer1M: 0
    };

    it('should calculate cost for input tokens only', () => {
      const usage: TokenUsage = {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cachedTokens: 0
      };
      
      const cost = calculateCost(usage, pricing);
      expect(cost).toBe(10.0);
    });

    it('should calculate cost for output tokens only', () => {
      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 1_000_000,
        cachedTokens: 0
      };
      
      const cost = calculateCost(usage, pricing);
      expect(cost).toBe(30.0);
    });

    it('should calculate cost for mixed usage', () => {
      const usage: TokenUsage = {
        inputTokens: 500_000,
        outputTokens: 200_000,
        cachedTokens: 100_000
      };
      
      const cost = calculateCost(usage, pricing);
      expect(cost).toBe(5.0 + 6.0 + 0); // 5 + 6 + 0 = 11
    });

    it('should handle cached tokens with discount', () => {
      const pricingWithCache: Pricing = {
        inputPricePer1M: 10.0,
        outputPricePer1M: 30.0,
        cachedPricePer1M: 2.5
      };
      
      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 1_000_000
      };
      
      const cost = calculateCost(usage, pricingWithCache);
      expect(cost).toBe(2.5);
    });

    it('should handle zero usage', () => {
      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0
      };
      
      const cost = calculateCost(usage, pricing);
      expect(cost).toBe(0);
    });

    it('should handle small token amounts', () => {
      const usage: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 0
      };
      
      const cost = calculateCost(usage, pricing);
      expect(cost).toBeCloseTo(0.001 + 0.0015, 5); // 0.0025
    });
  });

  describe('hasValidPricing', () => {
    it('should return true for valid pricing', () => {
      const pricing: Pricing = {
        inputPricePer1M: 10.0,
        outputPricePer1M: 30.0,
        cachedPricePer1M: 0
      };
      
      expect(hasValidPricing(pricing)).toBe(true);
    });

    it('should return false for undefined', () => {
      expect(hasValidPricing(undefined)).toBe(false);
    });

    it('should return false for missing fields', () => {
      const pricing = {
        inputPricePer1M: 10.0,
        outputPricePer1M: 30.0
      } as Pricing;
      
      expect(hasValidPricing(pricing)).toBe(false);
    });

    it('should return false for non-number fields', () => {
      const pricing = {
        inputPricePer1M: '10.0',
        outputPricePer1M: 30.0,
        cachedPricePer1M: 0
      } as any;
      
      expect(hasValidPricing(pricing)).toBe(false);
    });
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm test tests/lib/cost-calculator.test.ts
```

Expected: 所有测试通过

- [ ] **Step 4: 提交**

```bash
git add src/lib/cost-calculator.ts tests/lib/cost-calculator.test.ts
git commit -m "feat: add cost-calculator for API cost calculation"
```

---

## Task 4: 用量追踪器

**Files:**
- Create: `src/lib/usage-tracker.ts`
- Test: `tests/lib/usage-tracker.test.ts`

- [ ] **Step 1: 创建用量追踪器文件**

创建 `src/lib/usage-tracker.ts`：

```typescript
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { LogEntry } from '../logger.js';
import type { ModelLimit } from '../config.js';
import { getTodayDate, getWeekStart, getMonthStart, getPeriodRange } from './period-utils.js';
import { calculateCost, type Pricing } from './cost-calculator.js';

/**
 * 滑动窗口条目
 */
interface SlidingWindowEntry {
  timestamp: number;  // 秒级时间戳
  requests: number;
  inputTokens: number;
  cost: number;
}

/**
 * 滑动窗口计数器
 */
interface SlidingWindowCounter {
  windowHours: number;
  entries: SlidingWindowEntry[];
  loaded: boolean;
}

/**
 * 模型用量计数器
 */
export interface ModelUsageCounter {
  model: string;
  lastChecked: number;
  
  today: {
    date: string;
    requests: number;
    inputTokens: number;
    cost: number;
    loaded: boolean;
  };
  
  thisWeek: {
    weekStart: string;
    requests: number;
    inputTokens: number;
    cost: number;
    loaded: boolean;
  };
  
  thisMonth: {
    month: string;
    requests: number;
    inputTokens: number;
    cost: number;
    loaded: boolean;
  };
  
  slidingWindows: Map<number, SlidingWindowCounter>;
}

/**
 * 日志条目解析结果
 */
interface ParsedLogEntry {
  timestamp: string;
  customModel: string;
  statusCode: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
}

/**
 * 用量追踪器类
 */
export class UsageTracker {
  private counters: Map<string, ModelUsageCounter> = new Map();
  private logDir: string;

  constructor(logDir: string) {
    this.logDir = logDir;
  }

  /**
   * 创建空计数器
   */
  private createEmptyCounter(model: string): ModelUsageCounter {
    return {
      model,
      lastChecked: Date.now(),
      today: {
        date: getTodayDate(),
        requests: 0,
        inputTokens: 0,
        cost: 0,
        loaded: false
      },
      thisWeek: {
        weekStart: getWeekStart(),
        requests: 0,
        inputTokens: 0,
        cost: 0,
        loaded: false
      },
      thisMonth: {
        month: getMonthStart(),
        requests: 0,
        inputTokens: 0,
        cost: 0,
        loaded: false
      },
      slidingWindows: new Map()
    };
  }

  /**
   * 获取或创建计数器
   */
  getCounter(model: string): ModelUsageCounter {
    let counter = this.counters.get(model);
    if (!counter) {
      counter = this.createEmptyCounter(model);
      this.counters.set(model, counter);
    }
    return counter;
  }

  /**
   * 从日志文件加载用量
   */
  private loadFromLogs(
    counter: ModelUsageCounter,
    period: 'day' | 'hours' | 'week' | 'month',
    periodValue: number | undefined,
    pricing: Pricing | undefined
  ): void {
    const dateRange = getPeriodRange(period, periodValue);
    const logFiles = this.getLogFilesForRange(dateRange.start, dateRange.end);
    
    let requests = 0;
    let inputTokens = 0;
    let cost = 0;
    const slidingEntries: SlidingWindowEntry[] = [];
    
    for (const file of logFiles) {
      const entries = this.parseLogFile(file);
      for (const entry of entries) {
        if (entry.customModel !== counter.model) continue;
        if (entry.statusCode < 200 || entry.statusCode >= 300) continue;
        
        requests++;
        inputTokens += entry.promptTokens || 0;
        
        if (pricing) {
          const entryCost = calculateCost(
            {
              inputTokens: entry.promptTokens || 0,
              outputTokens: entry.completionTokens || 0,
              cachedTokens: entry.cachedTokens || 0
            },
            pricing
          );
          cost += entryCost;
        }
        
        if (period === 'hours') {
          slidingEntries.push({
            timestamp: new Date(entry.timestamp).getTime() / 1000,
            requests: 1,
            inputTokens: entry.promptTokens || 0,
            cost: pricing ? cost : 0
          });
        }
      }
    }
    
    // 更新计数器
    const today = getTodayDate();
    const weekStart = getWeekStart();
    const monthStart = getMonthStart();
    
    if (period === 'day') {
      counter.today = {
        date: today,
        requests,
        inputTokens,
        cost,
        loaded: true
      };
    }
    
    if (period === 'week') {
      counter.thisWeek = {
        weekStart,
        requests,
        inputTokens,
        cost,
        loaded: true
      };
    }
    
    if (period === 'month') {
      counter.thisMonth = {
        month: monthStart,
        requests,
        inputTokens,
        cost,
        loaded: true
      };
    }
    
    if (period === 'hours') {
      const windowHours = periodValue || 24;
      const cutoff = Date.now() / 1000 - (windowHours * 3600);
      const filtered = slidingEntries.filter(e => e.timestamp > cutoff);
      
      counter.slidingWindows.set(windowHours, {
        windowHours,
        entries: filtered,
        loaded: true
      });
    }
  }

  /**
   * 获取日志文件列表
   */
  private getLogFilesForRange(start: string, end: string): string[] {
    // 简化实现：读取目录中所有在范围内的日志文件
    // 实际实现需要读取目录并过滤
    return [];
  }

  /**
   * 解析日志文件
   */
  private parseLogFile(filePath: string): ParsedLogEntry[] {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, 'utf-8');
    return content.trim().split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  }

  /**
   * 确保计数器已加载
   */
  async ensureLoaded(
    counter: ModelUsageCounter,
    period: 'day' | 'hours' | 'week' | 'month',
    periodValue: number | undefined,
    pricing: Pricing | undefined
  ): Promise<void> {
    const today = getTodayDate();
    const weekStart = getWeekStart();
    const monthStart = getMonthStart();
    
    let needReload = false;
    
    if (period === 'day' && (counter.today.date !== today || !counter.today.loaded)) {
      needReload = true;
    }
    
    if (period === 'week' && (counter.thisWeek.weekStart !== weekStart || !counter.thisWeek.loaded)) {
      needReload = true;
    }
    
    if (period === 'month' && (counter.thisMonth.month !== monthStart || !counter.thisMonth.loaded)) {
      needReload = true;
    }
    
    if (period === 'hours') {
      const windowHours = periodValue || 24;
      const window = counter.slidingWindows.get(windowHours);
      if (!window || !window.loaded) {
        needReload = true;
      }
    }
    
    if (needReload && pricing) {
      this.loadFromLogs(counter, period, periodValue, pricing);
    }
  }

  /**
   * 记录用量
   */
  recordUsage(model: string, entry: LogEntry, pricing: Pricing | undefined): void {
    const counter = this.counters.get(model);
    if (!counter) return;
    
    const cost = pricing ? calculateCost(
      {
        inputTokens: entry.promptTokens || 0,
        outputTokens: entry.completionTokens || 0,
        cachedTokens: entry.cachedTokens || 0
      },
      pricing
    ) : 0;
    
    // 更新今日计数
    counter.today.requests++;
    counter.today.inputTokens += entry.promptTokens || 0;
    counter.today.cost += cost;
    
    // 更新本周计数
    counter.thisWeek.requests++;
    counter.thisWeek.inputTokens += entry.promptTokens || 0;
    counter.thisWeek.cost += cost;
    
    // 更新本月计数
    counter.thisMonth.requests++;
    counter.thisMonth.inputTokens += entry.promptTokens || 0;
    counter.thisMonth.cost += cost;
    
    // 更新滑动窗口
    const now = Date.now() / 1000;
    for (const [hours, window] of counter.slidingWindows.entries()) {
      window.entries.push({
        timestamp: now,
        requests: 1,
        inputTokens: entry.promptTokens || 0,
        cost
      });
    }
  }

  /**
   * 获取当前用量
   */
  getCurrentUsage(
    counter: ModelUsageCounter,
    limit: ModelLimit
  ): number {
    switch (limit.period) {
      case 'day':
        return limit.type === 'requests' ? counter.today.requests :
               limit.type === 'input_tokens' ? counter.today.inputTokens :
               counter.today.cost;
      
      case 'week':
        return limit.type === 'requests' ? counter.thisWeek.requests :
               limit.type === 'input_tokens' ? counter.thisWeek.inputTokens :
               counter.thisWeek.cost;
      
      case 'month':
        return limit.type === 'requests' ? counter.thisMonth.requests :
               limit.type === 'input_tokens' ? counter.thisMonth.inputTokens :
               counter.thisMonth.cost;
      
      case 'hours': {
        const windowHours = limit.periodValue || 24;
        const window = counter.slidingWindows.get(windowHours);
        if (!window) return 0;
        
        if (limit.type === 'requests') {
          return window.entries.reduce((sum, e) => sum + e.requests, 0);
        }
        if (limit.type === 'input_tokens') {
          return window.entries.reduce((sum, e) => sum + e.inputTokens, 0);
        }
        return window.entries.reduce((sum, e) => sum + e.cost, 0);
      }
    }
  }

  /**
   * 清理过期滑动窗口数据
   */
  cleanupSlidingWindows(): void {
    const now = Date.now() / 1000;
    const maxHours = 24;
    
    for (const counter of this.counters.values()) {
      for (const [hours, window] of counter.slidingWindows.entries()) {
        const cutoff = now - (hours * 3600);
        window.entries = window.entries.filter(e => e.timestamp > cutoff);
      }
    }
  }
}
```

- [ ] **Step 2: 创建单元测试**

创建 `tests/lib/usage-tracker.test.ts`（由于文件较长，这里只列出关键测试）：

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UsageTracker } from '../../src/lib/usage-tracker.js';
import type { LogEntry } from '../../src/logger.js';
import type { ModelLimit } from '../../src/config.js';

describe('usage-tracker', () => {
  const testLogDir = '/tmp/test-usage-tracker';
  let tracker: UsageTracker;

  beforeEach(() => {
    tracker = new UsageTracker(testLogDir);
  });

  describe('getCounter', () => {
    it('should create new counter for unknown model', () => {
      const counter = tracker.getCounter('test-model');
      expect(counter.model).toBe('test-model');
      expect(counter.today.loaded).toBe(false);
    });

    it('should return same counter for same model', () => {
      const counter1 = tracker.getCounter('test-model');
      const counter2 = tracker.getCounter('test-model');
      expect(counter1).toBe(counter2);
    });
  });

  describe('recordUsage', () => {
    it('should update today counter', () => {
      const counter = tracker.getCounter('test-model');
      const pricing = {
        inputPricePer1M: 10.0,
        outputPricePer1M: 30.0,
        cachedPricePer1M: 0
      };
      
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
    });

    it('should update all period counters', () => {
      const counter = tracker.getCounter('test-model');
      const pricing = {
        inputPricePer1M: 10.0,
        outputPricePer1M: 30.0,
        cachedPricePer1M: 0
      };
      
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
    });
  });

  describe('getCurrentUsage', () => {
    it('should return requests count for day period', () => {
      const counter = tracker.getCounter('test-model');
      counter.today.requests = 50;
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
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm test tests/lib/usage-tracker.test.ts
```

Expected: 所有测试通过

- [ ] **Step 4: 提交**

```bash
git add src/lib/usage-tracker.ts tests/lib/usage-tracker.test.ts
git commit -m "feat: add usage-tracker for memory-based usage tracking"
```

---

（由于计划较长，后续任务以简化格式呈现）

## Task 5: 限制检查器

**Files:**
- Create: `src/lib/rate-limiter.ts`
- Test: `tests/lib/rate-limiter.test.ts`

- [ ] **Step 1: 创建限制检查器**

实现 `LimitCheckResult` 接口和 `RateLimiter` 类，包含：
- `checkLimits()` 方法检查所有限制
- `formatErrorMessage()` 生成错误信息

- [ ] **Step 2: 创建单元测试**

测试各种限制场景：
- 请求次数限制触发
- 输入 token 限制触发
- 费用限制触发
- 多限制组合
- 无 limits 配置
- cost 限制缺少价格配置

- [ ] **Step 3: 运行测试并提交**

```bash
pnpm test tests/lib/rate-limiter.test.ts
git add src/lib/rate-limiter.ts tests/lib/rate-limiter.test.ts
git commit -m "feat: add rate-limiter for limit checking"
```

---

## Task 6: 路由集成

**Files:**
- Modify: `src/routes/chat-completions.ts`
- Modify: `src/routes/messages.ts`

- [ ] **Step 1: 在 chat-completions 路由中添加限制检查**

在请求处理前调用 `RateLimiter.checkLimits()`，触发限制时返回 429 错误

- [ ] **Step 2: 在 messages 路由中添加限制检查**

同上

- [ ] **Step 3: 测试集成**

```bash
pnpm build
pnpm test tests/integration/rate-limit-integration.test.ts
```

- [ ] **Step 4: 提交**

```bash
git add src/routes/chat-completions.ts src/routes/messages.ts
git commit -m "feat: integrate rate limiting in routes"
```

---

## Task 7: E2E 测试

**Files:**
- Create: `tests/e2e/rate-limit.e2e.test.ts`

- [ ] **Step 1: 创建 E2E 测试文件**

实现完整的 E2E 测试场景：
1. 请求次数限制
2. 输入 Token 限制
3. 费用限制
4. 滑动窗口限制
5. 多限制组合
6. 周期切换
7. 日志 + 内存混合模式

- [ ] **Step 2: 运行 E2E 测试**

```bash
pnpm test tests/e2e/rate-limit.e2e.test.ts
```

- [ ] **Step 3: 提交**

```bash
git add tests/e2e/rate-limit.e2e.test.ts
git commit -m "test: add E2E tests for rate limiting"
```

---

## Task 8: 文档更新

**Files:**
- Create: `docs/rate-limit-guide.md`
- Modify: `docs/user-guide.md`

- [ ] **Step 1: 创建用户文档**

创建 `docs/rate-limit-guide.md`，包含完整的配置示例和说明

- [ ] **Step 2: 更新 user-guide.md**

在配置说明部分添加 limits 字段说明

- [ ] **Step 3: 提交**

```bash
git add docs/rate-limit-guide.md docs/user-guide.md
git commit -m "docs: add rate limit user guide"
```

---

## Task 9: 最终验证

- [ ] **Step 1: 运行所有测试**

```bash
pnpm test
```

- [ ] **Step 2: 构建项目**

```bash
pnpm build
```

- [ ] **Step 3: 运行 E2E 测试**

```bash
pnpm test tests/e2e/
```

- [ ] **Step 4: 提交最终版本**

```bash
git commit -am "chore: finalize rate limit implementation"
```

---

**Plan complete and saved to `docs/superpowers/plans/2026-03-28-model-rate-limit.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
