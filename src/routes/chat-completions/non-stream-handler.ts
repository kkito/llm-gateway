import type { ProviderConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import { convertAnthropicResponseToOpenAI } from '../../converters/formats/anthropic/openai-to-anthropic.js';
import { resolveConverterChain } from '../../converters/router.js';
import type { FormatName } from '../../converters/format-adapter.js';
import { SystemLogger } from '../../lib/system-logger.js';

export interface NonStreamResult {
  responseData: any;
  logEntry: any;
}

export async function handleNonStream(
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

  const plan = resolveConverterChain('chat', provider.provider as FormatName);
  if (!plan.passthrough) {
    const converted = convertAnthropicResponseToOpenAI(responseData, model);
    responseData = converted;

    const usage = responseData.usage;
    logEntry.promptTokens = usage?.prompt_tokens;
    logEntry.completionTokens = usage?.completion_tokens;
    logEntry.totalTokens = usage?.total_tokens;
    logEntry.responseMetadata = JSON.stringify(responseData.usage ?? {});

    logger.log({ ...logEntry, message: 'Converted Anthropic response to OpenAI format' });
  } else {
    const usage = responseData.usage;
    logEntry.promptTokens = usage?.prompt_tokens;
    logEntry.completionTokens = usage?.completion_tokens;
    logEntry.totalTokens = usage?.total_tokens;
    logEntry.cachedTokens = usage?.prompt_tokens_details?.cached_tokens;
    logEntry.responseMetadata = JSON.stringify(responseData.usage ?? {});
  }

  return { responseData, logEntry };
}
