import type { ProviderConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import { handleNonStream } from './non-stream-handler.js';
import { handleStream } from './stream-handler.js';

export async function processSuccessfulResponse(
  c: any,
  response: Response,
  provider: ProviderConfig,
  modelName: string,
  stream: boolean,
  body: any,
  rateLimiter: RateLimiter,
  logger: Logger,
  detailLogger: DetailLogger,
  requestId: string,
  startTime: number,
  currentUser: any,
  modelGroup: string | undefined,
  triedModels: Array<{ model: string; exceeded: boolean; message?: string }>
): Promise<Response> {
  const logEntry: any = {
    timestamp: new Date().toISOString(),
    requestId,
    customModel: modelName,
    modelGroup,
    actualModel: modelName,
    triedModels: triedModels.length > 0 ? triedModels : undefined,
    realModel: provider.realModel,
    provider: provider.provider,
    endpoint: c.req.path,
    method: 'POST',
    statusCode: response.status,
    durationMs: Date.now() - startTime,
    isStreaming: stream,
    userName: currentUser?.name
  };

  // Auth check
  if (c.userAuthEnabled && !currentUser) {
    logger.log({
      ...logEntry,
      statusCode: 401,
      error: { message: 'Authentication required' }
    });
    return c.json({ error: { message: 'Authentication required' } }, 401);
  }

  // Non-stream path
  if (!stream) {
    const result = await handleNonStream(response, provider, modelName, logEntry, logger);
    if (result) {
      logger.log(result.logEntry);
      const pricing =
        provider.inputPricePer1M !== undefined &&
        provider.outputPricePer1M !== undefined &&
        provider.cachedPricePer1M !== undefined
          ? {
              inputPricePer1M: provider.inputPricePer1M,
              outputPricePer1M: provider.outputPricePer1M,
              cachedPricePer1M: provider.cachedPricePer1M
            }
          : undefined;
      rateLimiter.recordUsage(modelName, result.logEntry, pricing);
      return c.json(result.responseData);
    }
  }

  // Log the logEntry (reached when non-stream JSON parse fails, or before stream handling)
  logger.log(logEntry);

  // Stream path
  if (stream) {
    return handleStream({
      response,
      provider,
      model: modelName,
      actualModel: modelName,
      requestId,
      startTime,
      logEntry,
      rateLimiter,
      logger,
      detailLogger,
      c
    });
  }

  // Fallback: return raw response body
  if (!response.body) {
    return c.json({ error: { message: 'No response body' } }, 500);
  }
  return c.body(response.body);
}
