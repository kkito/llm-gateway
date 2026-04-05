import type { ProviderConfig } from '../../config.js';
import { buildHeaders, buildUrl } from '../../providers/index.js';
import { convertAnthropicRequestToOpenAI } from '../../converters/anthropic-to-openai.js';
import { DetailLogger } from '../../detail-logger.js';

export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: any;
}

/**
 * Build the upstream URL, headers, and body for a messages request.
 *
 * For Anthropic providers: direct passthrough with `model` override.
 * For OpenAI providers: converts the body via convertAnthropicRequestToOpenAI.
 */
export async function buildMessagesUpstreamRequest(
  provider: ProviderConfig,
  body: any,
  _stream: boolean
): Promise<UpstreamRequest> {
  let requestBody: any;

  if (provider.provider === 'anthropic') {
    requestBody = { ...body, model: provider.realModel };
  } else {
    const openaiRequest = convertAnthropicRequestToOpenAI(body);
    requestBody = { ...openaiRequest, model: provider.realModel };
  }

  const requestHeaders = buildHeaders(provider);
  const url = buildUrl(provider, 'chat');

  return {
    url,
    headers: requestHeaders,
    body: requestBody
  };
}

/**
 * Make the fetch call to the upstream provider and return the Response.
 */
export async function sendMessagesUpstreamRequest(
  upstream: UpstreamRequest,
  detailLogger: DetailLogger,
  requestId: string,
  timeoutMs: number
): Promise<Response> {
  detailLogger.logUpstreamRequest(requestId, upstream.body);
  console.log(`   📤 [Proxy 转发] ${upstream.url}`);

  const response = await fetch(upstream.url, {
    method: 'POST',
    headers: upstream.headers,
    body: JSON.stringify(upstream.body),
    signal: AbortSignal.timeout(timeoutMs)
  });

  console.log(`   📤 [响应] 状态码：${response.status}`);

  if (!response.ok) {
    try {
      const errorText = await response.clone().text();
      console.log(`   ❌ [错误详情] ${errorText}`);
    } catch {
      // ignore parse errors
    }
  }

  return response;
}
