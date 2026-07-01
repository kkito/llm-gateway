import type { ProviderConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { RequestLogger } from '../../lib/request-logger.js';
import type { PrivacySettings } from '../../config.js';
import { ModelGroupResolver } from '../../lib/model-group-resolver.js';
import { buildUpstreamRequest, sendUpstreamRequest } from './upstream-request.js';
import { processSuccessfulResponse } from './response-processor.js';
import { tryModelGroupWithFallback } from './model-fallback.js';
import { applyPrivacyProtection } from '../../privacy/apply.js';
import { restorePaths } from '../../privacy/sanitizer.js';
import { interceptors } from '../../interceptor/index.js';
import type { OutputFormat } from './non-stream-handler.js';

export interface HandlerCtx {
  c: any;
  endpoint: string;
  provider: ProviderConfig;
  body: any;
  stream: boolean;
  outputFormat: OutputFormat;
  rateLimiter: RateLimiter;
  logger: Logger;
  detailLogger: DetailLogger;
  requestId: string;
  startTime: number;
  timeoutMs: number;
  currentUser: any;
  modelGroup?: string;
  privacySettings?: PrivacySettings;
  apiKeys?: any[];
  requestLogger?: RequestLogger;
}

export async function handler(ctx: HandlerCtx): Promise<Response> {
  const {
    c, endpoint, provider, body, stream, outputFormat,
    rateLimiter, logger, detailLogger, requestId, startTime,
    timeoutMs, currentUser, privacySettings, apiKeys, requestLogger
  } = ctx;

  try {
    // Auth check
    if (c.userAuthEnabled && !currentUser) {
      logger.log({
        timestamp: new Date().toISOString(),
        requestId,
        customModel: body.model,
        modelGroup: ctx.modelGroup,
        endpoint,
        method: 'POST',
        statusCode: 401,
        durationMs: Date.now() - startTime,
        isStreaming: !!stream,
        userName: currentUser?.name,
        error: { message: 'Authentication required' }
      });
      if (requestLogger) {
        requestLogger.log({
          requestId, timestamp: new Date().toISOString(),
          userName: currentUser?.name ?? null,
          customModel: body.model, endpoint,
          statusCode: 401, durationMs: Date.now() - startTime,
          isStreaming: !!stream, errorMessage: 'Authentication required',
        });
      }
      return c.json({ error: { message: 'Authentication required' } }, 401);
    }

    // Rate limit check
    try {
      const limitResult = await rateLimiter.checkLimits(provider, c.req.path);
      if (limitResult.exceeded) {
        console.log(`   ⚠️  [限制触发] ${limitResult.message}`);
        const errorResponse = rateLimiter.createErrorResponse(limitResult.message!);
        return c.json(errorResponse, 429);
      }
    } catch (error: any) {
      console.log(`   ❌ [限制检查错误] ${error.message}`);
      return c.json({ error: { message: error.message } }, 500);
    }

    const modelName = body.model as string;

    console.log(`   ✓ 匹配 provider: ${provider.customModel} -> ${provider.realModel} (${provider.provider})`);

    // Build and send upstream request
    const upstream = await buildUpstreamRequest(provider, body, stream, apiKeys);

    // Execute registered interceptors for custom modifications (e.g., cache headers/body fields)
    const intercepted = await interceptors.execute(upstream, {
      provider,
      c,
      currentUser,
      clientIp: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null,
      requestId,
      customModel: modelName,
      stream,
      modelGroup: ctx.modelGroup,
    });

    const response = await sendUpstreamRequest(intercepted, detailLogger, requestId, timeoutMs);

    // Process response (handles both stream and non-stream)
    return await processSuccessfulResponse(
      c, response, provider, modelName, stream, body,
      rateLimiter, logger, detailLogger, requestId,
      startTime, currentUser, ctx.modelGroup, [],
      outputFormat, privacySettings, requestLogger
    );

  } catch (error: any) {
    console.log(`   ❌ [错误] ${error?.message || 'Unknown error'}`);
    console.log(`   错误类型：${error?.name || 'Unknown'}`);
    console.log(`   耗时：${Date.now() - startTime}ms\n`);

    logger.log({
      timestamp: new Date().toISOString(),
      requestId,
      customModel: ctx.modelGroup ? provider.customModel : (body.model as string),
      modelGroup: ctx.modelGroup,
      endpoint,
      method: 'POST',
      statusCode: 500,
      durationMs: Date.now() - startTime,
      isStreaming: false,
      userName: currentUser?.name,
      error: { message: error.message || 'Internal error', type: error.name }
    });
    if (requestLogger) {
      requestLogger.log({
        requestId, timestamp: new Date().toISOString(),
        userName: currentUser?.name ?? null,
        customModel: ctx.modelGroup ? provider.customModel : (body.model as string),
        endpoint, statusCode: 500,
        durationMs: Date.now() - startTime, isStreaming: false,
        errorMessage: error.message || 'Internal error',
        errorType: error.name,
      });
    }

    if (error.name === 'TimeoutError') {
      return c.json({
        error: { message: 'Upstream timeout', type: 'upstream_timeout', code: 'timeout' }
      }, 504);
    }

    if (error.name === 'ModelGroupExhaustedError') {
      return c.json({
        error: { message: error.message || 'All models in group exceeded their limits', type: 'rate_limit_error', code: 'rate_limit_exceeded', param: null }
      }, 429);
    }

    if (error.message && error.message.includes('Model group')) {
      return c.json({
        error: { message: error.message, type: 'invalid_request_error' }
      }, 400);
    }

    if (error.name === 'PermissionError') {
      return c.json({
        error: { message: error.message, type: 'permission_error' }
      }, 403);
    }

    return c.json({ error: { message: error.message || 'Internal error' } }, 500);
  }
}
