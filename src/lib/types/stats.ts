/**
 * 共享类型定义 - Stats 相关
 */

// ==================== Stats 类型 ====================

/**
 * 统计条目
 */
export interface StatsEntry {
  timestamp: string;
  customModel: string;
  provider?: string;
  statusCode: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  userName?: string;
}

/**
 * 模型统计数据
 */
export interface ModelStats {
  requests: number;
  successful: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cost?: number;  // 估算成本（美元）
}

/**
 * 统计数据
 */
export interface Stats {
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

export interface StatsOptions {
  date?: string;      // YYYY-MM-DD
  week?: string;      // YYYY-Www
  month?: string;     // YYYY-MM
  byHour?: boolean;
  userName?: string;  // 筛选特定用户
  forceReload?: boolean;  // 强制从日志重新加载
}

/**
 * 日志条目解析结果
 */
export interface ParsedLogEntry {
  timestamp: string;
  customModel: string;
  provider?: string;
  statusCode: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  userName?: string;
  cost?: number;  // 估算成本
}