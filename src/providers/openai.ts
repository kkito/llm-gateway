import { BaseProvider } from './base.js';

/**
 * OpenAI Provider 实现
 *
 * 认证方式：Authorization: Bearer ${apiKey}
 * Endpoint: /v1/chat/completions
 */
export class OpenAIProvider extends BaseProvider {
  buildHeaders(apiKey: string): Record<string, string> {
    return {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
  }

  getEndpoint(path: string): string {
    // OpenAI 标准 endpoint
    if (path === 'chat') {
      return '/v1/chat/completions';
    }
    if (path === 'complete') {
      return '/v1/completions';
    }
    if (path === 'embed') {
      return '/v1/embeddings';
    }
    return path;
  }

  getType(): 'openai' {
    return 'openai';
  }
}
