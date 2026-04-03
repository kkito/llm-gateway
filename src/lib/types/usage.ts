/**
 * 共享类型定义 - Usage Tracker 相关
 */

import type { ModelLimit } from '../../config.js';

/**
 * 滑动窗口条目
 */
export interface SlidingWindowEntry {
  timestamp: number;  // 秒级时间戳
  requests: number;
  inputTokens: number;
  cost: number;
}

/**
 * 滑动窗口计数器
 */
export interface SlidingWindowCounter {
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
export interface ParsedLogEntry {
  timestamp: string;
  customModel: string;
  statusCode: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
}

/**
 * Pricing 信息（引用自 cost-calculator）
 */
export type Pricing = Record<string, {
  input: number;
  output: number;
  cache?: number;
}>;