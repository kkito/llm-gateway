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
  logEntry.responseMetadata = JSON.stringify(responseData.usage ?? responseData.usage ?? {});

  detailLogger.logUpstreamResponse(requestId + '_converted', responseData);
  logger.log({ ...logEntry, message: 'Converted upstream response to Responses format' });

  return { responseData, logEntry };
}
