import type { ProviderConfig, PrivacySettings } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { RequestLogger } from '../../lib/request-logger.js';
import { handleResponsesNonStream } from './non-stream-handler.js';
import { handleStream as handleResponsesStream } from './stream-handler.js';
import { restorePaths } from '../../privacy/sanitizer.js';

export interface ProcessResponsesOptions {
  c: any;
  response: Response;
  provider: ProviderConfig;
  modelName: string;
  actualModel: string;
  stream: boolean;
  body: any;
  rateLimiter: RateLimiter;
  logger: Logger;
  detailLogger: DetailLogger;
  requestId: string;
  startTime: number;
  currentUser: any;
  modelGroup: string | undefined;
  triedModels: Array<{ model: string; exceeded: boolean; message?: string }>;
  privacySettings?: PrivacySettings;
  requestLogger?: RequestLogger;
}

export async function processResponsesSuccess(options: ProcessResponsesOptions): Promise<Response> {
  const {
    c,
    response,
    provider,
    modelName,
    stream,
    rateLimiter,
    logger,
    detailLogger,
    requestId,
    startTime,
    currentUser,
    modelGroup,
    triedModels,
    privacySettings,
    requestLogger
  } = options;

  const logEntry: any = {
    timestamp: new Date().toISOString(),
    requestId,
    customModel: modelName,
    modelGroup,
    actualModel: options.actualModel,
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
    const result = await handleResponsesNonStream(response, provider, modelName, logEntry, logger, detailLogger, requestId);
    if (result) {
      if (privacySettings?.enabled && privacySettings.sanitizeFilePaths) {
        restorePaths(result.responseData, requestId);
      }
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

  logger.log(logEntry);

  // Stream path
  if (stream) {
    return handleResponsesStream({
      response,
      provider,
      model: modelName,
      actualModel: options.actualModel,
      requestId,
      startTime,
      logEntry,
      rateLimiter,
      logger,
      detailLogger,
      c,
      requestLogger,
      currentUser,
      privacySettings
    });
  }

  if (!response.body) {
    return c.json({ error: { message: 'No response body' } }, 500);
  }
  return c.body(response.body);
}
