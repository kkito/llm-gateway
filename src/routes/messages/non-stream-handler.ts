import type { ProviderConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import { convertOpenAIResponseToAnthropic } from '../../converters/formats/anthropic/anthropic-to-openai.js';
import { resolveConverterChain } from '../../converters/router.js';
import type { FormatName } from '../../converters/format-adapter.js';
import { SystemLogger } from '../../lib/system-logger.js';

export interface NonStreamResult {
  responseData: any;
  logEntry: any;
}

export async function handleMessagesNonStream(
  response: Response,
  provider: ProviderConfig,
  model: string,
  logEntry: any,
  logger: Logger
): Promise<NonStreamResult | null> {
  let responseData: any;
  try {
    const clonedResponse = response.clone();
    responseData = await clonedResponse.json();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    SystemLogger.getInstance()?.logError('response_parse_error', errMsg, undefined, {
      requestId: logEntry.requestId,
      provider: provider.provider,
    });
    return null;
  }

  const plan = resolveConverterChain('anthropic', provider.provider as FormatName);
  if (!plan.passthrough) {
    // Extract tokens from original OpenAI response before conversion
    const originalUsage = responseData.usage;
    logEntry.promptTokens = originalUsage?.prompt_tokens;
    logEntry.completionTokens = originalUsage?.completion_tokens;
    logEntry.totalTokens = originalUsage?.total_tokens;
    logEntry.cachedTokens = originalUsage?.prompt_tokens_details?.cached_tokens;

    const converted = convertOpenAIResponseToAnthropic(responseData, model);
    responseData = converted;

    logEntry.responseMetadata = JSON.stringify(responseData.usage ?? {});
    console.log('   🔄 [OpenAI→Anthropic 转换]');
    logger.log({ ...logEntry, message: 'Converted OpenAI response to Anthropic format' });
  } else {
    const usage = responseData.usage;
    logEntry.promptTokens = usage?.input_tokens;
    logEntry.completionTokens = usage?.output_tokens;
    logEntry.totalTokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
    logEntry.cachedTokens = usage?.input_tokens_details?.cached_tokens;
    logEntry.responseMetadata = JSON.stringify(responseData.usage ?? {});

    logger.log({ ...logEntry, message: 'Anthropic non-streaming response' });
  }

  return { responseData, logEntry };
}
