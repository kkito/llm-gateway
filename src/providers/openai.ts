import { BaseProvider } from './base.js';
import type { ProviderType } from '../config.js';
import { VERSION } from '../lib/version.js';

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
      'Content-Type': 'application/json',
      'User-Agent': `kkito-llm-agent/${VERSION}`
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

  getType(): ProviderType {
    return 'openai';
  }
}

/**
 * Responses API Provider 实现
 *
 * 认证方式与 OpenAI 一致（Bearer），endpoint 指向 /v1/responses。
 * 形同 OpenAI，但出站走 Responses API 而非 chat/completions。
 */
export class ResponseApiProvider extends OpenAIProvider {
  getEndpoint(path: string): string {
    if (path === 'responses') {
      return '/v1/responses';
    }
    return super.getEndpoint(path);
  }

  getType(): 'response-api' {
    return 'response-api';
  }
}
