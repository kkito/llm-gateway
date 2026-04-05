import type { ModelLimit, ProviderConfig } from '../config.js';
import { UsageTracker, type ModelUsageCounter } from './usage-tracker.js';
import { getPeriodDescription } from './period-utils.js';
import { hasValidPricing, type Pricing } from './cost-calculator.js';

/**
 * 限制检查结果
 */
export interface LimitCheckResult {
  exceeded: boolean;
  limit?: ModelLimit;
  current?: number;
  message?: string;
}

/**
 * 错误响应格式
 */
export interface RateLimitError {
  error: {
    message: string;
    type: string;
    param: null;
    code: string;
  };
}

/**
 * 限制检查器类
 */
export class RateLimiter {
  private logDir: string;

  constructor(logDir: string) {
    this.logDir = logDir;
  }

  private get tracker(): UsageTracker {
    return UsageTracker.getInstance(this.logDir);
  }

  /**
   * 检查所有限制
   */
  async checkLimits(
    config: ProviderConfig,
    logDir: string
  ): Promise<LimitCheckResult> {
    if (!config.limits || config.limits.length === 0) {
      return { exceeded: false };
    }

    const pricing = this.extractPricing(config);
    const counter = this.tracker.getCounter(config.customModel);

    // 检查每个限制
    for (const limit of config.limits) {
      // 对于 cost 限制，需要价格配置
      if (limit.type === 'cost' && !hasValidPricing(pricing)) {
        throw new Error(
          `Cost limit requires pricing configuration for model '${config.customModel}'`
        );
      }

      // 确保计数器已加载
      await this.tracker.ensureLoaded(
        counter,
        limit.period,
        limit.periodValue,
        pricing
      );

      // 获取当前用量
      const current = this.tracker.getCurrentUsage(counter, limit);

      // 检查是否超过限制
      if (current >= limit.max) {
        return {
          exceeded: true,
          limit,
          current,
          message: this.formatErrorMessage(config.customModel, limit, current)
        };
      }
    }

    return { exceeded: false };
  }

  /**
   * 从配置中提取价格信息
   */
  private extractPricing(config: ProviderConfig): Pricing | undefined {
    if (
      config.inputPricePer1M === undefined ||
      config.outputPricePer1M === undefined ||
      config.cachedPricePer1M === undefined
    ) {
      return undefined;
    }

    return {
      inputPricePer1M: config.inputPricePer1M,
      outputPricePer1M: config.outputPricePer1M,
      cachedPricePer1M: config.cachedPricePer1M
    };
  }

  /**
   * 生成错误信息
   */
  private formatErrorMessage(
    model: string,
    limit: ModelLimit,
    current: number
  ): string {
    const period = getPeriodDescription(limit.period, limit.periodValue);
    const periodStr = period.charAt(0).toUpperCase() + period.slice(1);

    switch (limit.type) {
      case 'requests':
        return `Rate limit exceeded for model '${model}': ${periodStr} request count limit (${limit.max}) reached`;
      case 'input_tokens':
        return `Rate limit exceeded for model '${model}': ${periodStr} input token limit (${limit.max}) reached`;
      case 'cost':
        return `Rate limit exceeded for model '${model}': ${periodStr} cost limit ($${limit.max}) reached`;
    }
  }

  /**
   * 创建 429 错误响应
   */
  createErrorResponse(message: string): RateLimitError {
    return {
      error: {
        message,
        type: 'rate_limit_error',
        param: null,
        code: 'rate_limit_exceeded'
      }
    };
  }

  /**
   * 记录用量（请求成功后调用）
   */
  recordUsage(
    model: string,
    entry: import('../logger.js').LogEntry,
    pricing: Pricing | undefined
  ): void {
    this.tracker.recordUsage(model, entry, pricing);
  }

  /**
   * 获取追踪器实例（用于测试）
   */
  getTracker(): UsageTracker {
    return this.tracker;
  }


}
