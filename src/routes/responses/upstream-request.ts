import { resolveApiKey, type ApiKey, type ProviderConfig } from '../../config.js';
import { buildHeaders, buildUrl } from '../../providers/index.js';
import { resolveConverterChain } from '../../converters/router.js';
import { mergeModelParams } from '../../lib/params-merger.js';
import { filterOpenAIChatFields } from '../../lib/openai-chat-fields.js';
import { ensureToolParameters } from '../../converters/canonical/tools.js';
import { DetailLogger } from '../../detail-logger.js';
import { fetchWithProxy } from '../../lib/proxy.js';

export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: any;
  proxy?: string;
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
    // 同构 passthrough（responses <-> response-api）：请求体逐字节透传，
    // 只替换 model。Responses 字段（input/instructions/tools/tool_choice/
    // reasoning/store/include/text/parallel_tool_calls 等）一个不动。
    // 之前走 responses->chat->responses 重组会丢字段（developer role、
    // tool_choice、reasoning、store、include 等），导致模型行为异常。
    requestBody = { ...body, model: effectiveProvider.realModel };
  } else {
    const chat = plan.sourceAdapter.toChatRequest(body);
    requestBody = { ...plan.providerAdapter.fromChatRequest(chat), model: effectiveProvider.realModel };
    // chat 端点流式默认不回 usage，显式要 include_usage，
    // 否则转换后的 response.completed 用量全 0。
    if (_stream) {
      requestBody = { ...requestBody, stream_options: { include_usage: true } };
    }
  }

  const requestHeaders = buildHeaders(effectiveProvider);
  const endpoint = effectiveProvider.provider === 'response-api' ? 'responses' : 'chat';
  const url = buildUrl(effectiveProvider, endpoint);

  // 非 passthrough 路径才做 tool schema 兜底；passthrough 逐字节透传不动 tools。
  if (!plan.passthrough && Array.isArray((requestBody as any)?.tools)) {
    requestBody = { ...requestBody, tools: ensureToolParameters((requestBody as any).tools) };
  }

  // 合并默认参数（用户参数优先级更高）。
  // passthrough 路径跳过：defaultParams 是 chat 形状，混入 Responses 请求体会污染透传。
  if (!plan.passthrough) {
    requestBody = mergeModelParams(effectiveProvider.defaultParams, requestBody);
  }

  // 仅对 openai-compatible chat 端点收敛为白名单字段，防止 Responses 保真字段
  // （previous_response_id/instructions）或 provider 自定义 defaultParams
  // （thinking/reasoning_effort）泄漏到上游导致 400。
  // response-api passthrough 路径保留完整 Responses 字段，不做过滤。
  if (endpoint === 'chat') {
    requestBody = filterOpenAIChatFields(requestBody);
  }

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
export async function sendResponsesUpstreamRequest(
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
      detailLogger.logUpstreamResponse(requestId, { status: response.status, error: errorText });
    } catch {
      // ignore parse errors
    }
  }

  return response;
}
