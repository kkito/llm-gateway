import type { ProviderConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import { convertAnthropicResponseToOpenAI } from '../../converters/openai-to-anthropic.js';

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
  } catch {
    return null;
  }

  if (provider.provider === 'anthropic') {
    const converted = convertAnthropicResponseToOpenAI(responseData, model);
    responseData = converted;

    const usage = responseData.usage;
    logEntry.promptTokens = usage?.prompt_tokens;
    logEntry.completionTokens = usage?.completion_tokens;
    logEntry.totalTokens = usage?.total_tokens;

    logger.log({ ...logEntry, message: 'Converted Anthropic response to OpenAI format' });
  } else {
    const usage = responseData.usage;
    logEntry.promptTokens = usage?.prompt_tokens;
    logEntry.completionTokens = usage?.completion_tokens;
    logEntry.totalTokens = usage?.total_tokens;
    logEntry.cachedTokens = usage?.prompt_tokens_details?.cached_tokens;
  }

  return { responseData, logEntry };
}
