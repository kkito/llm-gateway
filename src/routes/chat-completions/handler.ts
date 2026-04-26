import type { ProviderConfig, ProxyConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import { v4 as uuidv4 } from 'uuid';
import { ModelGroupResolver } from '../../lib/model-group-resolver.js';
import { getCurrentUser } from '../../user/middleware/auth.js';
import { RateLimiter } from '../../lib/rate-limiter.js';
import { buildUpstreamRequest, sendUpstreamRequest } from './upstream-request.js';
import { handleNonStream } from './non-stream-handler.js';
import { handleStream } from './stream-handler.js';
import { tryModelGroupWithFallback } from './model-fallback.js';
import { applyPrivacyProtection } from '../../privacy/apply.js';
import { restorePaths } from '../../privacy/sanitizer.js';

export function createChatCompletionsHandler(
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

    // Get current user
    const currentUser = (c as any).currentUser || getCurrentUser(c);

    try {
      body = await c.req.json();
      const { model, model_group, stream } = body;

      // Debug log
      console.log(`   🔍 [调试] body.model=${JSON.stringify(model)}, body.model_group=${JSON.stringify(model_group)}`);

      // Validate mutual exclusivity
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

      // Log raw request (before privacy protection, for audit)
      // Deep copy to preserve original content since privacy protection mutates in place
      detailLogger.logRequest(requestId, JSON.parse(JSON.stringify(body)));

      // Get latest config
      const currentConfig = typeof config === 'function' ? config() : config;

      // Apply privacy protections (before any routing, so all paths get protection)
      if (currentConfig.privacySettings?.enabled) {
        body = applyPrivacyProtection(body, currentConfig.privacySettings, requestId);
      }

      let provider: ProviderConfig | undefined;

      if (model_group) {
        // Model Group mode: fallback loop
        modelGroup = model_group;
        console.log(`\n📥 [请求] ${requestId} - 模型组：${model_group} - 流式：${!!stream}`);

        const resolver = new ModelGroupResolver();
        const modelNames = resolver.resolveModelGroup(currentConfig.modelGroups, model_group, currentConfig.models);
        console.log(`   ✓ 匹配 model_group: ${model_group} -> [${modelNames.join(', ')}]`);

        const ctx: any = {
          c, modelNames, allProviders: currentConfig.models, body, stream,
          rateLimiter, logger, detailLogger, requestId, startTime,
          currentUser, modelGroupName: model_group, timeoutMs, logDir
        };
        const fallbackResult = await tryModelGroupWithFallback(ctx);
        actualModel = fallbackResult.actualModel;
        triedModels = fallbackResult.triedModels;
        customModel = actualModel || 'unknown';
        return fallbackResult.response;
      } else {
        // Single model mode
        customModel = model;
        console.log(`\n📥 [请求] ${requestId} - 模型：${model} - 流式：${!!stream}`);

        // Try direct provider lookup first
        const found = currentConfig.models.find(p => p.customModel === model);
        if (found) {
          provider = found;
          actualModel = model;
        } else if (currentConfig.modelGroups) {
          // Try resolving as a model group (smart recognition)
          try {
            const resolver = new ModelGroupResolver();
            const modelNames = resolver.resolveModelGroup(currentConfig.modelGroups, model, currentConfig.models);
            console.log(`   🔍 智能识别：${model} 被识别为 modelGroup -> [${modelNames.join(', ')}]`);
            modelGroup = model;
            console.log(`\n📥 [请求] ${requestId} - 模型组：${model} - 流式：${!!stream}`);

            const ctx: any = {
              c, modelNames, allProviders: currentConfig.models, body, stream,
              rateLimiter, logger, detailLogger, requestId, startTime,
              currentUser, modelGroupName: model, timeoutMs, logDir
            };
            const fallbackResult = await tryModelGroupWithFallback(ctx);
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
          return c.json({ error: { message: 'Model not found' } }, 404);
        }
      }

      console.log(`   ✓ 匹配 provider: ${provider.customModel} -> ${provider.realModel} (${provider.provider})`);

      // Rate limit check
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

      // Build and send upstream request
      const upstream = await buildUpstreamRequest(provider, body, stream);
      const response = await sendUpstreamRequest(upstream, detailLogger, requestId, timeoutMs);

      // Build log entry
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

      // Auth check
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
        return c.json({ error: { message: 'Authentication required' } }, 401);
      }

      // Non-stream response handling
      if (response.ok && !stream) {
        const result = await handleNonStream(response, provider, model, logEntry, logger);
        if (result) {
          // Restore paths in response
          if (currentConfig.privacySettings?.enabled && currentConfig.privacySettings.sanitizeFilePaths) {
            restorePaths(result.responseData, requestId);
          }
          logger.log(result.logEntry);
          const pricing = provider.inputPricePer1M !== undefined && provider.outputPricePer1M !== undefined && provider.cachedPricePer1M !== undefined
            ? { inputPricePer1M: provider.inputPricePer1M, outputPricePer1M: provider.outputPricePer1M, cachedPricePer1M: provider.cachedPricePer1M }
            : undefined;
          rateLimiter.recordUsage(actualModel || model, result.logEntry, pricing);
          return c.json(result.responseData);
        }
      }

      logger.log(logEntry);

      // Fallback for non-OK or empty body
      if (!response.body) {
        console.log(`\n❌ [错误] 上游响应体为空 ${requestId}`);
        return c.json({ error: { message: 'No response body' } }, 500);
      }

      // Stream response handling
      if (stream && response.ok) {
        return handleStream({
          response, provider, model, actualModel: actualModel || model,
          requestId, startTime, logEntry, rateLimiter, logger, detailLogger, c,
          privacySettings: currentConfig.privacySettings
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

      return c.json({ error: { message: error.message || 'Internal error' } }, 500);
    }
  };
}