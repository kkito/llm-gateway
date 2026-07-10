import type { ProviderConfig, ProxyConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import { v4 as uuidv4 } from 'uuid';
import { ModelGroupResolver } from '../../lib/model-group-resolver.js';
import { getCurrentUser } from '../../user/middleware/auth.js';
import { RateLimiter } from '../../lib/rate-limiter.js';
import { applyPrivacyProtection } from '../../privacy/apply.js';
import { restorePaths } from '../../privacy/sanitizer.js';
import { buildResponsesUpstreamRequest, sendResponsesUpstreamRequest } from './upstream-request.js';
import { handleResponsesNonStream } from './non-stream-handler.js';
import { handleStream as handleResponsesStream } from './stream-handler.js';
import { tryResponsesFallback } from './fallback.js';
import { interceptors } from '../../interceptor/index.js';
import { DatabaseManager } from '../../lib/db.js';
import { RequestLogger } from '../../lib/request-logger.js';

export function createResponsesHandler(
  config: ProxyConfig | (() => ProxyConfig),
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number,
  logDir: string
): (c: any, endpoint: string) => Promise<Response> {
  const rateLimiter = new RateLimiter(logDir);

  return async (c: any, endpoint: string) => {
    const startTime = Date.now();
    const requestId = uuidv4();
    let customModel = 'unknown';
    let modelGroup: string | undefined;
    let actualModel: string | undefined;
    let triedModels: Array<{ model: string; exceeded: boolean; message?: string }> = [];
    let body: any = {};

    const currentUser = (c as any).currentUser || getCurrentUser(c);

    const dm = DatabaseManager.getExistingInstance();
    const requestLogger = dm ? RequestLogger.getInstance(dm) : undefined;

    try {
      body = await c.req.json();
      const { model, model_group, stream } = body;

      if (model && model_group) {
        return c.json({
          error: { message: 'model and model_group are mutually exclusive', type: 'invalid_request_error' }
        }, 400);
      }

      if (!model && !model_group) {
        return c.json({
          error: { message: 'Either model or model_group must be provided', type: 'invalid_request_error' }
        }, 400);
      }

      detailLogger.logRequest(requestId, JSON.parse(JSON.stringify(body)));

      const currentConfig = typeof config === 'function' ? config() : config;

      if (currentConfig.privacySettings?.enabled) {
        body = applyPrivacyProtection(body, currentConfig.privacySettings, requestId);
      }

      let provider: ProviderConfig | undefined;

      if (model_group) {
        modelGroup = model_group;
        console.log(`\n📥 [请求] ${requestId} - 模型组：${model_group} - 流式：${!!stream}`);

        const resolver = new ModelGroupResolver();
        const modelNames = resolver.resolveModelGroup(currentConfig.modelGroups, model_group, currentConfig.models);
        console.log(`   ✓ 匹配 model_group: ${model_group} -> [${modelNames.join(', ')}]`);

        const fallbackResult = await tryResponsesFallback({
          c, modelNames, allProviders: currentConfig.models, body, stream,
          rateLimiter, logger, detailLogger, requestId, startTime,
          currentUser, modelGroupName: model_group, timeoutMs, logDir,
          privacySettings: currentConfig.privacySettings,
          apiKeys: currentConfig.apiKeys ?? [],
          requestLogger,
        });
        actualModel = fallbackResult.actualModel;
        triedModels = fallbackResult.triedModels;
        customModel = actualModel || 'unknown';
        return fallbackResult.response;
      } else {
        customModel = model;
        console.log(`\n📥 [请求] ${requestId} - 模型：${model} - 流式：${!!stream}`);

        const found = currentConfig.models.find(p => p.customModel === model);
        if (found) {
          provider = found;
          actualModel = model;
        } else if (currentConfig.modelGroups) {
          try {
            const resolver = new ModelGroupResolver();
            const modelNames = resolver.resolveModelGroup(currentConfig.modelGroups, model, currentConfig.models);
            console.log(`   🔍 智能识别：${model} 被识别为 modelGroup -> [${modelNames.join(', ')}]`);
            modelGroup = model;
            console.log(`\n📥 [请求] ${requestId} - 模型组：${model} - 流式：${!!stream}`);

            const fallbackResult = await tryResponsesFallback({
              c, modelNames, allProviders: currentConfig.models, body, stream,
              rateLimiter, logger, detailLogger, requestId, startTime,
              currentUser, modelGroupName: model, timeoutMs, logDir,
              privacySettings: currentConfig.privacySettings,
              apiKeys: currentConfig.apiKeys ?? [],
              requestLogger,
            });
            actualModel = fallbackResult.actualModel;
            triedModels = fallbackResult.triedModels;
            customModel = actualModel || 'unknown';
            return fallbackResult.response;
          } catch (_groupError) {
            // Not a valid modelGroup, fall through to 404 below
          }
        }

        if (!provider) {
          console.log(`   ❌ 未找到模型配置`);
          logger.log({
            timestamp: new Date().toISOString(),
            requestId,
            customModel: model,
            endpoint,
            method: 'POST',
            statusCode: 404,
            durationMs: Date.now() - startTime,
            isStreaming: !!stream,
            userName: currentUser?.name,
            error: { message: 'Model not found' }
          });
          if (requestLogger) {
            requestLogger.log({
              requestId, timestamp: new Date().toISOString(),
              userName: currentUser?.name ?? null,
              customModel: model, endpoint, statusCode: 404,
              durationMs: Date.now() - startTime, isStreaming: !!stream,
              errorMessage: 'Model not found',
            });
          }
          return c.json({ error: { message: 'Model not found' } }, 404);
        }
      }

      console.log(`   ✓ 匹配 provider: ${provider.customModel} -> ${provider.realModel} (${provider.provider})`);

      try {
        const limitResult = await rateLimiter.checkLimits(provider, logDir);
        if (limitResult.exceeded) {
          console.log(`   ⚠️  [限制触发] ${limitResult.message}`);
          const errorResponse = rateLimiter.createErrorResponse(limitResult.message!);
          return c.json(errorResponse, 429);
        }
      } catch (error: any) {
        console.log(`   ❌ [限制检查错误] ${error.message}`);
        return c.json({ error: { message: error.message } }, 500);
      }

      const upstream = await buildResponsesUpstreamRequest(provider, body, stream, currentConfig.apiKeys ?? []);

      const intercepted = await interceptors.execute(upstream, {
        provider,
        c,
        currentUser,
        clientIp: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null,
        requestId,
        customModel,
        stream,
        modelGroup,
      });

      const response = await sendResponsesUpstreamRequest(intercepted, detailLogger, requestId, timeoutMs);

      const logEntry: any = {
        timestamp: new Date().toISOString(),
        requestId,
        customModel: model_group ? actualModel! : model,
        modelGroup: model_group,
        actualModel: model_group ? actualModel : actualModel,
        triedModels: triedModels.length > 0 ? triedModels : undefined,
        realModel: provider.realModel,
        provider: provider.provider,
        endpoint,
        method: 'POST',
        statusCode: response.status,
        durationMs: Date.now() - startTime,
        isStreaming: !!stream,
        userName: currentUser?.name
      };

      if ((c as any).userAuthEnabled && !currentUser) {
        logger.log({
          timestamp: new Date().toISOString(),
          requestId,
          customModel: model_group ? actualModel! : model,
          modelGroup: model_group,
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
            customModel: model_group ? actualModel! : model, endpoint,
            statusCode: 401, durationMs: Date.now() - startTime,
            isStreaming: !!stream, errorMessage: 'Authentication required',
          });
        }
        return c.json({ error: { message: 'Authentication required' } }, 401);
      }

      if (response.ok && !stream) {
        const result = await handleResponsesNonStream(response, provider, model, logEntry, logger, detailLogger, requestId);
        if (result) {
          if (currentConfig.privacySettings?.enabled && currentConfig.privacySettings.sanitizeFilePaths) {
            restorePaths(result.responseData, requestId);
          }
          logger.log(result.logEntry);
          if (requestLogger) {
            requestLogger.log({
              requestId: result.logEntry.requestId,
              timestamp: result.logEntry.timestamp,
              userName: currentUser?.name ?? null,
              customModel: result.logEntry.customModel,
              realModel: result.logEntry.realModel,
              provider: result.logEntry.provider,
              endpoint: result.logEntry.endpoint,
              statusCode: result.logEntry.statusCode,
              durationMs: result.logEntry.durationMs,
              isStreaming: result.logEntry.isStreaming,
              promptTokens: result.logEntry.promptTokens,
              completionTokens: result.logEntry.completionTokens,
              totalTokens: result.logEntry.totalTokens,
              cachedTokens: result.logEntry.cachedTokens,
              modelGroup: result.logEntry.modelGroup,
              actualModel: result.logEntry.actualModel,
              errorMessage: result.logEntry.error?.message,
              errorType: result.logEntry.error?.type,
              responseMetadata: result.logEntry.responseMetadata,
            });
          }
          const pricing = provider.inputPricePer1M !== undefined && provider.outputPricePer1M !== undefined && provider.cachedPricePer1M !== undefined
            ? { inputPricePer1M: provider.inputPricePer1M, outputPricePer1M: provider.outputPricePer1M, cachedPricePer1M: provider.cachedPricePer1M }
            : undefined;
          rateLimiter.recordUsage(actualModel || model, result.logEntry, pricing);
          return c.json(result.responseData);
        }
      }

      logger.log(logEntry);
      if (requestLogger) {
        requestLogger.log({
          requestId: logEntry.requestId,
          timestamp: logEntry.timestamp,
          userName: currentUser?.name ?? null,
          customModel: logEntry.customModel,
          realModel: logEntry.realModel,
          provider: logEntry.provider,
          endpoint: logEntry.endpoint,
          statusCode: logEntry.statusCode,
          durationMs: logEntry.durationMs,
          isStreaming: logEntry.isStreaming,
          promptTokens: logEntry.promptTokens,
          completionTokens: logEntry.completionTokens,
          totalTokens: logEntry.totalTokens,
          cachedTokens: logEntry.cachedTokens,
          modelGroup: logEntry.modelGroup,
          actualModel: logEntry.actualModel,
          errorMessage: logEntry.error?.message,
          errorType: logEntry.error?.type,
          responseMetadata: logEntry.responseMetadata,
        });
      }

      if (!response.body) {
        console.log(`\n❌ [错误] 上游响应体为空 ${requestId}`);
        return c.json({ error: { message: 'No response body' } }, 500);
      }

      if (stream && response.ok) {
        return handleResponsesStream({
          response, provider, model, actualModel: actualModel || model,
          requestId, startTime, logEntry, rateLimiter, logger, detailLogger, c,
          privacySettings: currentConfig.privacySettings,
          requestLogger,
          currentUser,
        });
      }

      console.log(`\n✅ [完成] ${requestId} - 耗时：${Date.now() - startTime}ms\n`);
      return c.body(response.body);

    } catch (error: any) {
      console.log(`   ❌ [错误] ${error?.message || 'Unknown error'}`);
      console.log(`   错误类型：${error?.name || 'Unknown'}`);
      console.log(`   耗时：${Date.now() - startTime}ms\n`);

      logger.log({
        timestamp: new Date().toISOString(),
        requestId,
        customModel: modelGroup ? actualModel! : (body.model as string),
        modelGroup: modelGroup,
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
          customModel: modelGroup ? actualModel! : (body.model as string),
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
  };
}
