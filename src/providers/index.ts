import type { ProviderConfig } from '../config.js';
import type { Provider, ProviderFactory } from './base.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';

/**
 * 默认 Provider 工厂实现
 */
export class DefaultProviderFactory implements ProviderFactory {
  private openAIProvider: OpenAIProvider;
  private anthropicProvider: AnthropicProvider;

  constructor() {
    this.openAIProvider = new OpenAIProvider();
    this.anthropicProvider = new AnthropicProvider();
  }

  getProvider(config: ProviderConfig): Provider {
    switch (config.provider) {
      case 'openai':
        return this.openAIProvider;
      case 'anthropic':
        return this.anthropicProvider;
      default:
        throw new Error(`Unknown provider type: ${config.provider}`);
    }
  }
}

/**
 * 便捷函数：根据配置获取 Provider
 */
export function getProvider(config: ProviderConfig): Provider {
  const factory = new DefaultProviderFactory();
  return factory.getProvider(config);
}

/**
 * 便捷函数：构建请求头
 */
export function buildHeaders(config: ProviderConfig): Record<string, string> {
  const provider = getProvider(config);
  return provider.buildHeaders(config.apiKey);
}

/**
 * 便捷函数：构建完整 URL
 */
export function buildUrl(config: ProviderConfig, path: string): string {
  const provider = getProvider(config);
  return provider.buildUrl(config, path);
}

// 导出具体 Provider 类供直接使用
export { OpenAIProvider } from './openai.js';
export { AnthropicProvider } from './anthropic.js';
export type { Provider, ProviderFactory } from './base.js';
