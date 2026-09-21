import type { ProviderConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import { resolveConverterChain } from '../../converters/router.js';
import { SystemLogger } from '../../lib/system-logger.js';

export interface NonStreamResult {
  responseData: any;
  logEntry: any;
}

/**
 * 非流式响应还原：provider 格式 -> canonical chat -> responses 客户端格式。
 * 同构 passthrough（responses -> responses）时上游 JSON 原样返回，
 * 避免重组丢失 output item、encrypted_content 等字段。
 */
export async function handleResponsesNonStream(
  response: Response,
  provider: ProviderConfig,
  _model: string,
  logEntry: any,
  logger: Logger,
  detailLogger: DetailLogger,
  requestId: string
): Promise<NonStreamResult | null> {
  let responseData: any;
  try {
    const clonedResponse = response.clone();
    responseData = await clonedResponse.json();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    SystemLogger.getInstance()?.logError('response_parse_error', errMsg, undefined, {
      requestId,
      provider: provider.provider,
    });
    return null;
  }

  const plan = resolveConverterChain('responses', provider.provider as any);

  // 同构 passthrough：上游 JSON 原样返回，仅从中提取用量记费
  if (plan.passthrough) {
    const usage = (responseData as any)?.usage;
    if (usage) {
      logEntry.promptTokens = usage.input_tokens;
      logEntry.completionTokens = usage.output_tokens;
      logEntry.totalTokens = usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
      logEntry.cachedTokens = usage.input_tokens_details?.cached_tokens;
    }
    logEntry.responseMetadata = JSON.stringify((responseData as any)?.usage ?? {});

    detailLogger.logUpstreamResponse(requestId + '_converted', responseData);
    logger.log({ ...logEntry, message: 'Passthrough upstream Responses response' });

    return { responseData, logEntry };
  }

  const chat = plan.providerAdapter.toChatResponse(responseData);
  const converted = plan.sourceAdapter.fromChatResponse(chat);
  responseData = converted;

  // 提取用量（统一从 chat canonical 取）
  const usage = (chat as any).usage;
  if (usage) {
    logEntry.promptTokens = usage.prompt_tokens;
    logEntry.completionTokens = usage.completion_tokens;
    logEntry.totalTokens = usage.total_tokens;
    logEntry.cachedTokens = usage.prompt_tokens_details?.cached_tokens;
  }
  logEntry.responseMetadata = JSON.stringify((chat as any).usage ?? {});

  detailLogger.logUpstreamResponse(requestId + '_converted', responseData);
  logger.log({ ...logEntry, message: 'Converted upstream response to Responses format' });

  return { responseData, logEntry };
}
