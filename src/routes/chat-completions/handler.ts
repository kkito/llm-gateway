import type { ProviderConfig, ProxyConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import { v4 as uuidv4 } from 'uuid';
import { ModelGroupResolver } from '../../lib/model-group-resolver.js';
import { getCurrentUser } from '../../user/middleware/auth.js';
import { RateLimiter } from '../../lib/rate-limiter.js';
import { applyPrivacyProtection } from '../../privacy/apply.js';
import { handler as commonHandler } from '../common/handler.js';
import { tryModelGroupWithFallback } from '../common/model-fallback.js';
import { DatabaseManager } from '../../lib/db.js';
import { RequestLogger } from '../../lib/request-logger.js';

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

      // Model Group mode
      if (model_group) {
        console.log(`\n📥 [请求] ${requestId} - 模型组：${model_group} - 流式：${!!stream}`);

        const resolver = new ModelGroupResolver();
        const modelNames = resolver.resolveModelGroup(currentConfig.modelGroups, model_group, currentConfig.models);
        console.log(`   ✓ 匹配 model_group: ${model_group} -> [${modelNames.join(', ')}]`);

        return tryModelGroupWithFallback({
          c, modelNames, allProviders: currentConfig.models, body, stream,
          rateLimiter, logger, detailLogger, requestId, startTime,
          currentUser, modelGroupName: model_group, timeoutMs, logDir,
          outputFormat: 'openai',
          privacySettings: currentConfig.privacySettings,
          apiKeys: currentConfig.apiKeys ?? [],
          requestLogger,
        });
      }

      // Single model mode
      console.log(`\n📥 [请求] ${requestId} - 模型：${model} - 流式：${!!stream}`);

      const found = currentConfig.models.find(p => p.customModel === model);
      if (found) {
        console.log(`   ✓ 匹配 provider: ${found.customModel} -> ${found.realModel} (${found.provider})`);
        return commonHandler({
          c, endpoint, provider: found, body, stream,
          outputFormat: 'openai',
          rateLimiter, logger, detailLogger, requestId, startTime,
          timeoutMs, currentUser,
          privacySettings: currentConfig.privacySettings,
          apiKeys: currentConfig.apiKeys ?? [],
          requestLogger,
        });
      }

      // Smart recognition: try resolving as a model group
      if (currentConfig.modelGroups) {
        try {
          const resolver = new ModelGroupResolver();
          const modelNames = resolver.resolveModelGroup(currentConfig.modelGroups, model, currentConfig.models);
          console.log(`   🔍 智能识别：${model} 被识别为 modelGroup -> [${modelNames.join(', ')}]`);
          console.log(`\n📥 [请求] ${requestId} - 模型组：${model} - 流式：${!!stream}`);

          return tryModelGroupWithFallback({
            c, modelNames, allProviders: currentConfig.models, body, stream,
            rateLimiter, logger, detailLogger, requestId, startTime,
            currentUser, modelGroupName: model, timeoutMs, logDir,
            outputFormat: 'openai',
            privacySettings: currentConfig.privacySettings,
            apiKeys: currentConfig.apiKeys ?? [],
            requestLogger,
          });
        } catch (_groupError) {
          // Not a valid modelGroup, fall through to 404
        }
      }

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
          requestId,
          timestamp: new Date().toISOString(),
          userName: currentUser?.name ?? null,
          customModel: model,
          endpoint,
          statusCode: 404,
          durationMs: Date.now() - startTime,
          isStreaming: !!stream,
          errorMessage: 'Model not found',
        });
      }
      return c.json({ error: { message: 'Model not found' } }, 404);

    } catch (error: any) {
      console.log(`   ❌ [错误] ${error?.message || 'Unknown error'}`);
      console.log(`   错误类型：${error?.name || 'Unknown'}`);
      console.log(`   耗时：${Date.now() - startTime}ms\n`);

      logger.log({
        timestamp: new Date().toISOString(),
        requestId,
        customModel: body.model as string,
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
          customModel: body.model as string,
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
