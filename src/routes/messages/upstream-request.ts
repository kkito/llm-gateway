import { resolveApiKey, type ApiKey, type ProviderConfig } from '../../config.js';
import { buildHeaders, buildUrl } from '../../providers/index.js';
import { convertAnthropicRequestToOpenAI } from '../../converters/anthropic-to-openai.js';
import { mergeModelParams } from '../../lib/params-merger.js';
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
  _stream: boolean,
  apiKeys?: ApiKey[]
): Promise<UpstreamRequest> {
  let requestBody: any;

  const resolvedKey = resolveApiKey(provider.apiKey, apiKeys ?? []);
  const effectiveProvider = resolvedKey !== provider.apiKey
    ? { ...provider, apiKey: resolvedKey }
    : provider;

  if (effectiveProvider.provider === 'anthropic') {
    requestBody = { ...body, model: effectiveProvider.realModel };
  } else {
    const openaiRequest = convertAnthropicRequestToOpenAI(body);
    requestBody = { ...openaiRequest, model: effectiveProvider.realModel };
  }

  const requestHeaders = buildHeaders(effectiveProvider);
  const url = buildUrl(effectiveProvider, 'chat');

  // 合并默认参数（用户参数优先级更高）
  requestBody = mergeModelParams(effectiveProvider.defaultParams, requestBody);

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

  const response = await globalThis.fetch(upstream.url, {
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
      detailLogger.logUpstreamResponse(requestId, { status: response.status, error: errorText });
    } catch {
      // ignore parse errors
    }
  }

  return response;
}
