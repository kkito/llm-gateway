import { resolveApiKey, type ApiKey, type ProviderConfig } from '../../config.js';
import { buildHeaders, buildUrl } from '../../providers/index.js';
import { convertOpenAIRequestToAnthropic } from '../../converters/formats/anthropic/openai-to-anthropic.js';
import { mergeModelParams } from '../../lib/params-merger.js';
import { resolveConverterChain } from '../../converters/router.js';
import type { FormatName } from '../../converters/format-adapter.js';
import { DetailLogger } from '../../detail-logger.js';
import { fetchWithProxy } from '../../lib/proxy.js';

export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: any;
  proxy?: string;
}

/**
 * Build the upstream URL, headers, and body for a chat completions request.
 *
 * For OpenAI providers: passes through the body with `stream_options` added when stream=true.
 * For Anthropic providers: converts the body via convertOpenAIRequestToAnthropic.
 */
export async function buildUpstreamRequest(
  provider: ProviderConfig,
  body: any,
  stream: boolean,
  apiKeys?: ApiKey[]
): Promise<UpstreamRequest> {
  let requestBody: any;

  // Resolve $$name$$ reference if present
  const resolvedKey = resolveApiKey(provider.apiKey, apiKeys ?? []);
  const effectiveProvider = resolvedKey !== provider.apiKey
    ? { ...provider, apiKey: resolvedKey }
    : provider;

  const plan = resolveConverterChain('chat', effectiveProvider.provider as FormatName);
  let url: string;
  if (plan.passthrough) {
    requestBody = {
      ...body,
      model: effectiveProvider.realModel,
      ...(stream ? { stream_options: { include_usage: true } } : {})
    };
  } else if (effectiveProvider.provider === 'response-api') {
    // 客户端 chat 格式 -> canonical -> response-api（复用通用 adapter 链，与 /v1/responses 路由一致）
    const chat = plan.sourceAdapter.toChatRequest(body);
    requestBody = { ...plan.providerAdapter.fromChatRequest({ ...chat, model: effectiveProvider.realModel }) };
  } else {
    const anthropicRequest = await convertOpenAIRequestToAnthropic(body);
    requestBody = { ...anthropicRequest, model: effectiveProvider.realModel };
  }

  const requestHeaders = buildHeaders(effectiveProvider);
  url = buildUrl(effectiveProvider, effectiveProvider.provider === 'response-api' ? 'responses' : 'chat');

  // 合并默认参数（用户参数优先级更高）
  requestBody = mergeModelParams(effectiveProvider.defaultParams, requestBody);

  return {
    url,
    headers: requestHeaders,
    body: requestBody,
    proxy: effectiveProvider.proxy
  };
}

/**
 * Make the fetch call to the upstream provider and return the Response.
 */
export async function sendUpstreamRequest(
  upstream: UpstreamRequest,
  detailLogger: DetailLogger,
  requestId: string,
  timeoutMs: number
): Promise<Response> {
  detailLogger.logUpstreamRequest(requestId, upstream.body);
  console.log(`   📤 [Proxy 转发] ${upstream.url}`);

  const response = await fetchWithProxy(upstream.url, {
    method: 'POST',
    headers: upstream.headers,
    body: JSON.stringify(upstream.body),
    signal: AbortSignal.timeout(timeoutMs),
    proxy: upstream.proxy
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
