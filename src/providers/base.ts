import type { ProviderConfig } from '../config.js';

/**
 * Provider 接口定义
 * 每个 provider 需要实现这些方法来处理 API 请求差异
 */
export interface Provider {
  /**
   * 构建请求头
   */
  buildHeaders(apiKey: string): Record<string, string>;

  /**
   * 获取 endpoint 路径
   */
  getEndpoint(path: string): string;

  /**
   * 获取 provider 类型
   */
  getType(): 'openai' | 'anthropic';

  /**
   * 构建完整的请求 URL
   */
  buildUrl(config: ProviderConfig, path: string): string;
}

/**
 * Provider 工厂接口
 */
export interface ProviderFactory {
  getProvider(config: ProviderConfig): Provider;
}

/**
 * 基础 Provider 实现（共享逻辑）
 */
export abstract class BaseProvider implements Provider {
  abstract buildHeaders(apiKey: string): Record<string, string>;
  abstract getEndpoint(path: string): string;
  abstract getType(): 'openai' | 'anthropic';

  /**
   * 获取 Base URL
   */
  getBaseUrl(config: ProviderConfig): string {
    return config.baseUrl;
  }

  /**
   * 规范化 URL 路径：移除末尾的斜杠
   */
  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '');
  }

  /**
   * 规范化 endpoint 路径：确保以 / 开头
   */
  private normalizeEndpoint(endpoint: string): string {
    return endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  }

  /**
   * 检测 baseUrl 是否已包含 endpoint 的前缀
   * 例如：baseUrl = "https://api.openai.com/v1", endpoint = "/v1/chat/completions"
   * 应该返回 true，因为 baseUrl 已经包含了 /v1
   */
  private baseUrlIncludesEndpoint(baseUrl: string, endpoint: string): boolean {
    const normalizedBase = this.normalizeBaseUrl(baseUrl);
    const normalizedEndpoint = this.normalizeEndpoint(endpoint);

    // 提取 endpoint 的第一级路径（如 /v1/chat/completions -> /v1）
    const endpointPrefix = normalizedEndpoint.split('/').slice(0, 2).join('/');

    return normalizedBase.endsWith(endpointPrefix);
  }

  /**
   * 构建完整的请求 URL
   *
   * 智能处理各种 baseUrl 格式：
   * - https://api.openai.com + /v1/chat/completions -> https://api.openai.com/v1/chat/completions
   * - https://api.openai.com/ + /v1/chat/completions -> https://api.openai.com/v1/chat/completions
   * - https://api.openai.com/v1 + /v1/chat/completions -> https://api.openai.com/v1/chat/completions
   * - https://api.openai.com/v1/ + /v1/chat/completions -> https://api.openai.com/v1/chat/completions
   */
  buildUrl(config: ProviderConfig, path: string): string {
    const baseUrl = this.getBaseUrl(config);
    const endpoint = this.getEndpoint(path);

    const normalizedBase = this.normalizeBaseUrl(baseUrl);
    const normalizedEndpoint = this.normalizeEndpoint(endpoint);

    // 如果 baseUrl 已经包含 endpoint 的前缀，则跳过重复部分
    if (this.baseUrlIncludesEndpoint(baseUrl, endpoint)) {
      const endpointPrefix = normalizedEndpoint.split('/').slice(0, 2).join('/');
      const remainingEndpoint = normalizedEndpoint.slice(endpointPrefix.length);
      return `${normalizedBase}${remainingEndpoint}`;
    }

    // 正常拼接
    return `${normalizedBase}${normalizedEndpoint}`;
  }
}
