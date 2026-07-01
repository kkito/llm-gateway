import type { ProviderConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import { convertAnthropicResponseToOpenAI } from '../../converters/openai-to-anthropic.js';
import { convertOpenAIResponseToAnthropic } from '../../converters/anthropic-to-openai.js';
import { SystemLogger } from '../../lib/system-logger.js';

export type OutputFormat = 'openai' | 'anthropic';

export interface NonStreamResult {
  responseData: any;
  logEntry: any;
}

export async function handleNonStream(
  response: Response,
  provider: ProviderConfig,
  model: string,
  logEntry: any,
  logger: Logger,
  outputFormat: OutputFormat = 'openai'
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

  if (outputFormat === 'openai') {
    // Target: OpenAI format
    if (provider.provider === 'anthropic') {
      const converted = convertAnthropicResponseToOpenAI(responseData, model);
      responseData = converted;
      logger.log({ ...logEntry, message: 'Converted Anthropic response to OpenAI format' });
    }
    const usage = responseData.usage;
    logEntry.promptTokens = usage?.prompt_tokens;
    logEntry.completionTokens = usage?.completion_tokens;
    logEntry.totalTokens = usage?.total_tokens;
    logEntry.cachedTokens = usage?.prompt_tokens_details?.cached_tokens;
    logEntry.responseMetadata = JSON.stringify(responseData.usage ?? {});
  } else {
    // Target: Anthropic format
    if (provider.provider === 'openai') {
      const originalUsage = responseData.usage;
      logEntry.promptTokens = originalUsage?.prompt_tokens;
      logEntry.completionTokens = originalUsage?.completion_tokens;
      logEntry.totalTokens = originalUsage?.total_tokens;
      logEntry.cachedTokens = originalUsage?.prompt_tokens_details?.cached_tokens;

      const converted = convertOpenAIResponseToAnthropic(responseData, model);
      responseData = converted;
      logger.log({ ...logEntry, message: 'Converted OpenAI response to Anthropic format' });
    } else {
      const usage = responseData.usage;
      logEntry.promptTokens = usage?.input_tokens;
      logEntry.completionTokens = usage?.output_tokens;
      logEntry.totalTokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
      logEntry.cachedTokens = usage?.input_tokens_details?.cached_tokens;
    }
    logEntry.responseMetadata = JSON.stringify(responseData.usage ?? {});
  }

  return { responseData, logEntry };
}
