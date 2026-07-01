import type { FormatAdapter } from '../../hub/adapters/adapter.interface.js';
import type { Logger } from '../../logger.js';
import { SystemLogger } from '../../lib/system-logger.js';

export interface NonStreamResult {
  responseData: any;
  logEntry: any;
}

export interface UnifiedNonStreamOptions {
  response: Response;
  adapter: FormatAdapter;
  providerType: string;
  model: string;
  logEntry: any;
  logger: Logger;
}

/**
 * Unified non-stream handler that works with any format adapter.
 *
 * When the provider is native (e.g., OpenAI provider for OpenAI Chat format),
 * the response passes through unchanged. When the provider is non-native
 * (e.g., OpenAI provider for Anthropic Messages format), the hub response
 * is converted to the client's format via the adapter.
 */
export async function handleNonStream({
  response,
  adapter,
  providerType,
  model,
  logEntry,
  logger,
}: UnifiedNonStreamOptions): Promise<NonStreamResult | null> {
  let responseData: any;
  try {
    const clonedResponse = response.clone();
    responseData = await clonedResponse.json();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    SystemLogger.getInstance()?.logError('response_parse_error', errMsg, undefined, {
      requestId: logEntry.requestId,
      provider: providerType,
    });
    return null;
  }

  const isNative = adapter.isNativeProvider(providerType);

  if (isNative) {
    extractUsageForLogEntry(responseData, adapter, logEntry);
    logEntry.responseMetadata = JSON.stringify(responseData.usage ?? {});
    logger.log({ ...logEntry, message: `${adapter.formatName} non-streaming response` });
  } else {
    const converted = adapter.fromHubResponse(responseData, model);
    responseData = converted;

    extractUsageForLogEntry(responseData, adapter, logEntry);
    logEntry.responseMetadata = JSON.stringify(responseData.usage ?? {});
    logger.log({ ...logEntry, message: `Converted ${providerType} response to ${adapter.formatName} format` });
  }

  return { responseData, logEntry };
}

/**
 * Extract token usage from response data into logEntry fields.
 * Handles both OpenAI and Anthropic usage field formats.
 */
function extractUsageForLogEntry(data: any, adapter: FormatAdapter, logEntry: any): void {
  const usage = data.usage;
  if (!usage) return;

  if (adapter.formatName === 'anthropic-messages') {
    logEntry.promptTokens = usage.input_tokens;
    logEntry.completionTokens = usage.output_tokens;
    logEntry.totalTokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
    logEntry.cachedTokens = usage.input_tokens_details?.cached_tokens;
  } else {
    logEntry.promptTokens = usage.prompt_tokens;
    logEntry.completionTokens = usage.completion_tokens;
    logEntry.totalTokens = usage.total_tokens;
    logEntry.cachedTokens = usage.prompt_tokens_details?.cached_tokens;
  }
}
