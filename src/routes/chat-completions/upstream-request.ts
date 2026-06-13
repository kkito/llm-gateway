import { resolveApiKey, type ApiKey, type ProviderConfig } from '../../config.js';
import { buildHeaders, buildUrl } from '../../providers/index.js';
import { convertOpenAIRequestToAnthropic } from '../../converters/openai-to-anthropic.js';
import { mergeModelParams } from '../../lib/params-merger.js';
import { DetailLogger } from '../../detail-logger.js';

export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: any;
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

  if (effectiveProvider.provider === 'openai') {
    requestBody = {
      ...body,
      model: effectiveProvider.realModel,
      ...(stream ? { stream_options: { include_usage: true } } : {})
    };
  } else {
    const anthropicRequest = await convertOpenAIRequestToAnthropic(body);
    requestBody = { ...anthropicRequest, model: effectiveProvider.realModel };
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
export async function sendUpstreamRequest(
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
    } catch {
      // ignore parse errors
    }
  }

  return response;
}
