import type { ProviderConfig, PrivacySettings, ApiKey } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { RequestLogger } from '../../lib/request-logger.js';
import { interceptors } from '../../interceptor/index.js';
import { buildResponsesUpstreamRequest, sendResponsesUpstreamRequest } from './upstream-request.js';
import { processResponsesSuccess } from './response.js';

export interface ResponsesFallbackResult {
  actualModel: string | undefined;
  triedModels: Array<{ model: string; exceeded: boolean; message?: string }>;
  response: Response;
}

export interface ResponsesFallbackContext {
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
  apiKeys?: ApiKey[];
  requestLogger?: RequestLogger;
}

export async function tryResponsesFallback(ctx: ResponsesFallbackContext): Promise<ResponsesFallbackResult> {
  const { c, modelNames, allProviders, body, stream, rateLimiter, logger, detailLogger, requestId, startTime, currentUser, modelGroupName, timeoutMs, logDir, privacySettings, requestLogger } = ctx;
  const triedModels: Array<{ model: string; exceeded: boolean; message?: string }> = [];
  let lastErrorBody: any = null;
  let lastErrorStatus = 500;

  for (const modelName of modelNames) {
    const provider = allProviders.find(p => p.customModel === modelName);
    if (!provider) {
      triedModels.push({ model: modelName, exceeded: false, message: 'Model config not found' });
      continue;
    }

    const limitResult = await rateLimiter.checkLimits(provider, logDir);
    if (limitResult.exceeded) {
      triedModels.push({ model: modelName, exceeded: true, message: limitResult.message });
      continue;
    }

    const upstream = await buildResponsesUpstreamRequest(provider, body, stream, ctx.apiKeys);

    const intercepted = await interceptors.execute(upstream, {
      provider,
      c: ctx.c,
      currentUser: ctx.currentUser,
      clientIp: ctx.c?.req?.header?.('x-forwarded-for') ?? ctx.c?.req?.header?.('x-real-ip') ?? null,
      requestId: ctx.requestId,
      customModel: modelName,
      stream: ctx.stream,
      modelGroup: ctx.modelGroupName,
    });

    const response = await sendResponsesUpstreamRequest(intercepted, detailLogger, requestId, timeoutMs);

    if (!response.ok) {
      triedModels.push({ model: modelName, exceeded: false, message: `HTTP ${response.status}` });
      try {
        lastErrorBody = await response.json();
      } catch {
        lastErrorBody = { error: { message: `HTTP ${response.status}` } };
      }
      lastErrorStatus = response.status;
      continue;
    }

    const processedResponse = await processResponsesSuccess({
      c,
      response,
      provider,
      modelName,
      actualModel: modelName,
      stream,
      body,
      rateLimiter,
      logger,
      detailLogger,
      requestId,
      startTime,
      currentUser,
      modelGroup: modelGroupName,
      triedModels,
      privacySettings,
      requestLogger
    });

    return {
      actualModel: modelName,
      triedModels,
      response: processedResponse
    };
  }

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
