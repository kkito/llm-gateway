import { BaseProvider } from './base.js';

/**
 * Anthropic Provider 实现
 *
 * 认证方式：X-API-Key: ${apiKey}
 *          anthropic-version: 2023-06-01
 * Endpoint: /v1/messages
 */
export class AnthropicProvider extends BaseProvider {
  private readonly version: string;
  private readonly beta?: string;

  constructor(version: string = '2023-06-01', beta?: string) {
    super();
    this.version = version;
    this.beta = beta;
  }

  buildHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      'X-API-Key': apiKey,
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'anthropic-version': this.version
    };

    if (this.beta) {
      headers['anthropic-beta'] = this.beta;
    }

    return headers;
  }

  getEndpoint(path: string): string {
    // Anthropic 标准 endpoint
    if (path === 'chat') {
      return '/v1/messages';
    }
    if (path === 'complete') {
      return '/v1/complete';
    }
    return path;
  }

  getType(): 'anthropic' {
    return 'anthropic';
  }
}
