import type { ProviderConfig, PrivacySettings } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import { buildUpstreamRequest, sendUpstreamRequest } from './upstream-request.js';
import { processSuccessfulResponse } from './response-processor.js';
import { restorePaths } from '../../privacy/sanitizer.js';

export interface FallbackResult {
  actualModel: string | undefined;
  triedModels: Array<{ model: string; exceeded: boolean; message?: string }>;
  response: Response;
}

export interface FallbackContext {
  c: any;
  modelNames: string[];
  allProviders: ProviderConfig[];
  body: any;
  stream: boolean;
  rateLimiter: RateLimiter;
  logger: Logger;
  detailLogger: DetailLogger;
  requestId: string;
  startTime: number;
  currentUser: any;
  modelGroupName: string;
  timeoutMs: number;
  logDir: string;
  privacySettings?: PrivacySettings;
}

export async function tryModelGroupWithFallback(ctx: FallbackContext): Promise<FallbackResult> {
  const { c, modelNames, allProviders, body, stream, rateLimiter, logger, detailLogger, requestId, startTime, currentUser, modelGroupName, timeoutMs, logDir, privacySettings } = ctx;
  const triedModels: Array<{ model: string; exceeded: boolean; message?: string }> = [];
  let lastErrorBody: any = null;
  let lastErrorStatus = 500;

  for (const modelName of modelNames) {
    // 1. Find provider config by customModel
    const provider = allProviders.find(p => p.customModel === modelName);
    if (!provider) {
      triedModels.push({ model: modelName, exceeded: false, message: 'Model config not found' });
      continue;
    }

    // 2. Check rate limits
    const limitResult = await rateLimiter.checkLimits(provider, logDir);
    if (limitResult.exceeded) {
      triedModels.push({ model: modelName, exceeded: true, message: limitResult.message });
      continue;
    }

    // 3. Build and send upstream request
    const upstream = await buildUpstreamRequest(provider, body, stream);
    const response = await sendUpstreamRequest(upstream, detailLogger, requestId, timeoutMs);

    // 4. If response is not OK, save error and try next model
    if (!response.ok) {
      triedModels.push({ model: modelName, exceeded: false, message: `HTTP ${response.status}` });

      // Save error response body for final fallback
      try {
        lastErrorBody = await response.json();
      } catch {
        lastErrorBody = { error: { message: `HTTP ${response.status}` } };
      }
      lastErrorStatus = response.status;
      continue;
    }

    // 5. Success — process and return
    const processedResponse = await processSuccessfulResponse(
      c, response, provider, modelName, stream, body,
      rateLimiter, logger, detailLogger, requestId,
      startTime, currentUser, modelGroupName, triedModels,
      privacySettings
    );

    return {
      actualModel: modelName,
      triedModels,
      response: processedResponse
    };
  }

  // 6. All models failed — log and return last error
  for (const tried of triedModels) {
    if (tried.exceeded) {
      console.log(`   ⚠️  [跳过] ${tried.model} - ${tried.message}`);
    }
  }
  logger.log({
    timestamp: new Date().toISOString(),
    requestId,
    customModel: modelNames[0] || 'unknown',
    modelGroup: modelGroupName,
    actualModel: undefined,
    triedModels: triedModels.length > 0 ? triedModels : undefined,
    endpoint: c.req.path,
    method: 'POST',
    statusCode: lastErrorStatus,
    durationMs: Date.now() - startTime,
    isStreaming: stream,
    userName: currentUser?.name
  });

  return {
    actualModel: undefined,
    triedModels,
    response: c.json(lastErrorBody, lastErrorStatus)
  };
}
