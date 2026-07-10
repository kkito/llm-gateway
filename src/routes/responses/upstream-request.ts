import { resolveApiKey, type ApiKey, type ProviderConfig } from '../../config.js';
import { buildHeaders, buildUrl } from '../../providers/index.js';
import { resolveConverterChain } from '../../converters/router.js';
import { mergeModelParams } from '../../lib/params-merger.js';
import { DetailLogger } from '../../detail-logger.js';

export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: any;
}

/**
 * Build the upstream URL, headers, and body for a Responses API request.
 *
 * 走星型 router 链：responses(客户端) -> canonical(chat) -> provider 格式。
 * 若 provider 为 response-api，router 自动 passthrough（同格式直传）。
 */
export async function buildResponsesUpstreamRequest(
  provider: ProviderConfig,
  body: any,
  _stream: boolean,
  apiKeys?: ApiKey[]
): Promise<UpstreamRequest> {
  const resolvedKey = resolveApiKey(provider.apiKey, apiKeys ?? []);
  const effectiveProvider = resolvedKey !== provider.apiKey
    ? { ...provider, apiKey: resolvedKey }
    : provider;

  const plan = resolveConverterChain('responses', effectiveProvider.provider as any);

  let requestBody: any;
  if (plan.passthrough) {
    requestBody = { ...body, model: effectiveProvider.realModel };
  } else {
    const chat = plan.sourceAdapter.toChatRequest(body);
    requestBody = { ...plan.providerAdapter.fromChatRequest(chat), model: effectiveProvider.realModel };
  }

  const requestHeaders = buildHeaders(effectiveProvider);
  const endpoint = effectiveProvider.provider === 'response-api' ? 'responses' : 'chat';
  const url = buildUrl(effectiveProvider, endpoint);

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
export async function sendResponsesUpstreamRequest(
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
