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
