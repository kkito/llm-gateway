import { Hono } from 'hono';
import type { ProviderConfig, ProxyConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { DetailLogger } from '../detail-logger.js';
import { v4 as uuidv4 } from 'uuid';
import { buildHeaders, buildUrl } from '../providers/index.js';
import { convertAnthropicRequestToOpenAI, convertOpenAIResponseToAnthropic } from '../converters/anthropic-to-openai.js';
import { ModelGroupResolver } from '../lib/model-group-resolver.js';
import {
  createOpenAIToAnthropicStreamState,
  type OpenAIToAnthropicStreamState
} from '../converters/openai-to-anthropic.js';
import { getCurrentUser } from '../user/middleware/auth.js';
import { RateLimiter } from '../lib/rate-limiter.js';
import { parseAndConvertOpenAISSE } from './utils/sse-handlers-messages.js';

export function createMessagesRoute(
  config: ProxyConfig | (() => ProxyConfig),
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number,
  logDir: string
) {
  const router = new Hono();
  const rateLimiter = new RateLimiter(logDir);

  // 处理函数
  const handler = async (c: any, endpoint: string) => {
    const startTime = Date.now();
    const requestId = uuidv4();
    let customModel = 'unknown';
    let modelGroup: string | undefined;
    let actualModel: string | undefined;
    let triedModels: Array<{ model: string; exceeded: boolean; message?: string }> = [];
    let body: any = {};

    // 获取当前用户
    const currentUser = getCurrentUser(c);

    try {
      body = await c.req.json();
      const { model, model_group, stream } = body;

      // 调试日志：打印接收到的参数
      console.log(`   🔍 [调试] body.model=${JSON.stringify(model)}, body.model_group=${JSON.stringify(model_group)}`);

      // 验证参数互斥
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

      // 记录用户请求
      detailLogger.logRequest(requestId, body);

      // 获取最新配置
      const currentConfig = typeof config === 'function' ? config() : config;
      let provider: ProviderConfig | undefined;

      if (model_group) {
        // Model Group 模式：fallback 循环
        modelGroup = model_group;
        console.log(`\n📥 [请求] ${requestId} - 模型组：${model_group} - 流式：${!!stream}`);

        const resolver = new ModelGroupResolver();
        const modelNames = resolver.resolveModelGroup(currentConfig.modelGroups, model_group);
        console.log(`   ✓ 匹配 model_group: ${model_group} -> [${modelNames.join(', ')}]`);

        // 遍历模型列表，HTTP 失败后尝试下一个
        const fallbackResult = await tryMessagesFallback(
          c, modelNames, currentConfig.models, body, stream,
          rateLimiter, logger, detailLogger, requestId,
          startTime, currentUser, model_group, timeoutMs, logDir
        );
        actualModel = fallbackResult.actualModel;
        triedModels = fallbackResult.triedModels;
        customModel = actualModel || 'unknown';
        return fallbackResult.response;
      } else {
        // 单个模型模式
        customModel = model;
        console.log(`\n📥 [请求] ${requestId} - 模型：${model} - 流式：${!!stream}`);

        // 先找单个模型，找不到再智能识别为 modelGroup
        const found = currentConfig.models.find(p => p.customModel === model);
        if (found) {
          provider = found;
          actualModel = model;
        } else if (currentConfig.modelGroups) {
          try {
            const resolver = new ModelGroupResolver();
            const modelNames = resolver.resolveModelGroup(currentConfig.modelGroups, model);
            console.log(`   🔍 智能识别：${model} 被识别为 modelGroup -> [${modelNames.join(', ')}]`);
            modelGroup = model;
            console.log(`\n📥 [请求] ${requestId} - 模型组：${model} - 流式：${!!stream}`);

            // 智能识别也走 fallback 循环
            const fallbackResult = await tryMessagesFallback(
              c, modelNames, currentConfig.models, body, stream,
              rateLimiter, logger, detailLogger, requestId,
              startTime, currentUser, model, timeoutMs, logDir
            );
            actualModel = fallbackResult.actualModel;
            triedModels = fallbackResult.triedModels;
            customModel = actualModel || 'unknown';
            return fallbackResult.response;
          } catch (groupError) {
            // 不是有效的 modelGroup，继续查找单个模型（下面会返回 404）
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

      // 检查使用限制
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

      // 根据 provider 类型处理请求
      let upstreamBody: any;
      let requestHeaders: Record<string, string>;
      let upstreamUrl: string;

      if (provider.provider === 'anthropic') {
        // Anthropic provider: 直接透传
        upstreamBody = { ...body, model: provider.realModel };
        requestHeaders = buildHeaders(provider);
        upstreamUrl = buildUrl(provider, 'chat');
        console.log(`   🔄 [Anthropic 透传]`);
      } else {
        // OpenAI provider: 转换请求格式
        const openaiRequest = convertAnthropicRequestToOpenAI(body);
        upstreamBody = { ...openaiRequest, model: provider.realModel };
        requestHeaders = buildHeaders(provider);
        upstreamUrl = buildUrl(provider, 'chat');
        console.log(`   🔄 [Anthropic→OpenAI 转换]`);
      }

      detailLogger.logUpstreamRequest(requestId, upstreamBody);
      console.log(`   📤 [Proxy 转发] ${upstreamUrl}`);

      const response = await fetch(upstreamUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(upstreamBody),
        signal: AbortSignal.timeout(timeoutMs)
      });

      console.log(`   📤 [响应] 状态码：${response.status}`);

      // 非 2xx 响应时打印详细内容
      if (!response.ok) {
        try {
          const errorText = await response.clone().text();
          console.log(`   ❌ [错误详情] ${errorText}`);
        } catch {
          // 忽略解析错误
        }
      }

      const logEntry: any = {
        timestamp: new Date().toISOString(),
        requestId,
        customModel: model_group ? actualModel! : model,
        modelGroup: model_group,
        actualModel: actualModel,
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

      // 处理非流式响应
      if (response.ok && !stream) {
        try {
          const responseData = await response.clone().json() as any;

          // 如果 provider 是 OpenAI，需要转换响应格式回 Anthropic
          if (provider.provider === 'openai') {
            const anthropicResponse = convertOpenAIResponseToAnthropic(responseData, model);
            logEntry.promptTokens = responseData.usage?.prompt_tokens;
            logEntry.completionTokens = responseData.usage?.completion_tokens;
            logEntry.totalTokens = responseData.usage?.total_tokens;
            logEntry.cachedTokens = responseData.usage?.prompt_tokens_details?.cached_tokens ?? null;
            console.log(`   🔄 [OpenAI→Anthropic 转换]`);
            logger.log(logEntry);
            return c.json(anthropicResponse);
          } else {
            // Anthropic provider: 直接透传
            logEntry.promptTokens = responseData.usage?.input_tokens;
            logEntry.completionTokens = responseData.usage?.output_tokens;
            logEntry.totalTokens = responseData.usage?.input_tokens + responseData.usage?.output_tokens;
            logEntry.cachedTokens = responseData.usage?.input_tokens_details?.cached_tokens ?? null;
            logger.log(logEntry);
            // 记录用量
            const pricing = provider.inputPricePer1M !== undefined && provider.outputPricePer1M !== undefined && provider.cachedPricePer1M !== undefined ? {
              inputPricePer1M: provider.inputPricePer1M,
              outputPricePer1M: provider.outputPricePer1M,
              cachedPricePer1M: provider.cachedPricePer1M
            } : undefined;
            rateLimiter.recordUsage(actualModel || model, logEntry, pricing);
            return c.json(responseData);
          }
        } catch {
          // 忽略解析错误
        }
      }

      logger.log(logEntry);

      // 透传响应
      if (!response.body) {
        console.log(`\n❌ [错误] 上游响应体为空 ${requestId}`);
        return c.json({ error: { message: 'No response body' } }, 500);
      }

      // 流式响应处理
      if (stream && response.ok) {
        // 判断请求格式和 Provider 格式是否一致
        const requestFormat = 'anthropic'; // /v1/messages 是 Anthropic 格式
        const providerFormat = provider.provider;

        // 初始化流式转换状态（用于 OpenAI → Anthropic 转换）
        const streamState = providerFormat === 'openai' ? createOpenAIToAnthropicStreamState() : undefined;

        const chunks: string[] = [];
        const rawChunks: string[] = []; // 记录原始上游响应
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        const transformedStream = new ReadableStream({
          async start(controller) {
            try {
              let buffer = ''; // 用于累积不完整的 SSE 块

              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  // 记录原始上游响应到文件
                  detailLogger.logStreamResponse(requestId + '_raw', rawChunks);
                  // 从最后的 chunk 中提取 cachedTokens 和 usage 信息
                  let finalUsage: any = null;
                  for (let i = chunks.length - 1; i >= 0; i--) {
                    try {
                      // 尝试解析 SSE data 行
                      const chunkText = chunks[i];
                      const lines = chunkText.split('\n');
                      for (const line of lines) {
                        if (line.startsWith('data:')) {
                          const chunkJson = JSON.parse(line.slice(5).trim());
                          if (chunkJson.usage?.prompt_tokens_details?.cached_tokens) {
                            logEntry.cachedTokens = chunkJson.usage.prompt_tokens_details.cached_tokens;
                            finalUsage = chunkJson.usage;
                            break;
                          }
                          // Anthropic 格式
                          if (chunkJson.usage?.input_tokens_details?.cached_tokens) {
                            logEntry.cachedTokens = chunkJson.usage.input_tokens_details.cached_tokens;
                            finalUsage = chunkJson.usage;
                            break;
                          }
                          // 通用 usage 提取
                          if (chunkJson.usage && !finalUsage) {
                            finalUsage = chunkJson.usage;
                          }
                        }
                      }
                    } catch {
                      // 忽略解析错误
                    }
                  }

                  // 从 finalUsage 中提取完整的 Token 信息
                  if (finalUsage) {
                    logEntry.promptTokens = finalUsage.prompt_tokens || finalUsage.input_tokens;
                    logEntry.completionTokens = finalUsage.completion_tokens || finalUsage.output_tokens;
                    logEntry.totalTokens = finalUsage.total_tokens || (logEntry.promptTokens + logEntry.completionTokens);
                  }

                  // 记录流式请求的日志（包含 Token 信息）
                  logger.log(logEntry);

                  // 记录用量
                  const pricing = provider.inputPricePer1M !== undefined && provider.outputPricePer1M !== undefined && provider.cachedPricePer1M !== undefined ? {
                    inputPricePer1M: provider.inputPricePer1M,
                    outputPricePer1M: provider.outputPricePer1M,
                    cachedPricePer1M: provider.cachedPricePer1M
                  } : undefined;
                  rateLimiter.recordUsage(actualModel || model, logEntry, pricing);

                  // 记录流式响应到文件
                  detailLogger.logStreamResponse(requestId, chunks);
                  controller.close();
                  break;
                }

                const chunk = decoder.decode(value, { stream: false });
                rawChunks.push(chunk); // 记录原始上游响应
                buffer += chunk;

                // 按双换行符分割 SSE 块
                const parts = buffer.split('\n\n');
                buffer = parts.pop() || ''; // 保留最后一个不完整的块

                for (const part of parts) {
                  if (!part.trim()) continue;

                  // 根据 provider 格式处理
                  if (providerFormat === 'openai') {
                    // OpenAI → Anthropic 流式转换
                    const anthropicChunks = parseAndConvertOpenAISSE(
                      part,
                      streamState!
                    );

                    for (const anthropicChunk of anthropicChunks) {
                      chunks.push(anthropicChunk);
                      controller.enqueue(new TextEncoder().encode(anthropicChunk));
                    }
                  } else {
                    // 格式一致：直接透传 Anthropic SSE
                    // LongCat 等上游返回的 SSE 已经包含 event: 和 data: 行，直接透传即可
                    let sseLine = part;

                    // 添加 SSE 事件结束符（split('\n\n') 会移除它，需要加回来）
                    sseLine += '\n\n';

                    chunks.push(sseLine);
                    try {
                      controller.enqueue(new TextEncoder().encode(sseLine));
                    } catch (err: any) {
                      // 安静捕获中断错误：客户端断开或 controller 已关闭
                      if (err?.name === 'AbortError' ||
                          err?.code === 'ERR_INVALID_STATE' ||
                          err?.message?.includes('Controller is already closed')) {
                        // 正常中断，无需处理
                        return;
                      }
                      throw err;
                    }
                  }
                }
              }
            } catch (error) {
              console.log(`   ❌ [流式处理错误] ${error}`);
              try {
                controller.error(error);
              } catch {
                // Controller 已关闭，忽略错误
              }
            }
          }
        });

        console.log(`\n✅ [完成] ${requestId} - 耗时：${Date.now() - startTime}ms\n`);
        return c.body(transformedStream);
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
          error: {
            message: 'Upstream timeout',
            type: 'upstream_timeout',
            code: 'timeout'
          }
        }, 504);
      }

      // ModelGroupExhaustedError: 所有模型都超过限制
      if (error.name === 'ModelGroupExhaustedError') {
        return c.json({
          error: {
            message: error.message || 'All models in group exceeded their limits',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
            param: null
          }
        }, 429);
      }

      // Model group not found 或其他配置错误
      if (error.message && error.message.includes('Model group')) {
        return c.json({
          error: {
            message: error.message,
            type: 'invalid_request_error'
          }
        }, 400);
      }

      return c.json({
        error: { message: error.message || 'Internal error' }
      }, 500);
    }
  };

  // 注册多个 alias 路径
  router.post('/v1/messages', (c) => handler(c, '/v1/messages'));
  router.post('/messages', (c) => handler(c, '/messages'));
  router.post('/v1/v1/messages', (c) => handler(c, '/v1/v1/messages'));

  return router;
}

// ============================================================
// Model Group Fallback for /v1/messages
// ============================================================

interface MsgFallbackResult {
  actualModel: string | undefined;
  triedModels: Array<{ model: string; exceeded: boolean; message?: string }>;
  response: Response;
}

/**
 * Model Group fallback：遍历模型列表，HTTP 失败后尝试下一个
 */
async function tryMessagesFallback(
  c: any,
  modelNames: string[],
  allProviders: ProviderConfig[],
  body: any,
  stream: boolean,
  rateLimiter: RateLimiter,
  logger: Logger,
  detailLogger: DetailLogger,
  requestId: string,
  startTime: number,
  currentUser: any,
  modelGroupName: string,
  timeoutMs: number,
  logDir: string
): Promise<MsgFallbackResult> {
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

    // 构建上游请求
    let upstreamBody: any;
    let requestHeaders: Record<string, string>;
    let upstreamUrl: string;

    if (provider.provider === 'anthropic') {
      upstreamBody = { ...body, model: provider.realModel };
      requestHeaders = buildHeaders(provider);
      upstreamUrl = buildUrl(provider, 'chat');
      console.log(`   🔄 [Anthropic 透传]`);
    } else {
      const openaiRequest = convertAnthropicRequestToOpenAI(body);
      upstreamBody = { ...openaiRequest, model: provider.realModel };
      requestHeaders = buildHeaders(provider);
      upstreamUrl = buildUrl(provider, 'chat');
      console.log(`   🔄 [Anthropic→OpenAI 转换]`);
    }

    detailLogger.logUpstreamRequest(requestId, upstreamBody);
    console.log(`   📤 [Proxy 转发] ${upstreamUrl}`);

    const response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(timeoutMs)
    });

    console.log(`   📤 [响应] 状态码：${response.status}`);

    // 非 2xx 响应
    if (!response.ok) {
      try {
        const errorText = await response.clone().text();
        console.log(`   ❌ [错误详情] ${errorText}`);
      } catch { /* ignore */ }
      console.log(`   ❌ [模型 ${modelName} 失败] HTTP ${response.status}，尝试下一个`);
      triedModels.push({ model: modelName, exceeded: false, message: `HTTP ${response.status}` });

      try {
        lastErrorBody = await response.json();
      } catch {
        lastErrorBody = { error: { message: `HTTP ${response.status}` } };
      }
      lastErrorStatus = response.status;
      continue;
    }

    // 成功！处理响应
    console.log(`   ✓ 使用模型：${modelName}`);
    const processedResponse = await processMessagesSuccess(
      c, response, provider, modelName, stream, body,
      rateLimiter, logger, detailLogger, requestId,
      startTime, currentUser, modelGroupName, triedModels
    );

    return {
      actualModel: modelName,
      triedModels,
      response: processedResponse
    };
  }

  // 所有模型都失败
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
    isStreaming: !!stream,
    userName: currentUser?.name
  });

  return {
    actualModel: undefined,
    triedModels,
    response: c.json(lastErrorBody, lastErrorStatus)
  };
}

/**
 * 处理成功响应（非流式/流式）- /v1/messages 端点
 */
async function processMessagesSuccess(
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
    customModel: modelGroup ? modelName : body.model,
    modelGroup,
    actualModel: modelName,
    triedModels: triedModels.length > 0 ? triedModels : undefined,
    realModel: provider.realModel,
    provider: provider.provider,
    endpoint: c.req.path,
    method: 'POST',
    statusCode: response.status,
    durationMs: Date.now() - startTime,
    isStreaming: !!stream,
    userName: currentUser?.name
  };

  // 非流式响应处理
  if (!stream) {
    try {
      const responseData = await response.clone().json() as any;

      let resultResponse: any;
      if (provider.provider === 'openai') {
        const anthropicResponse = convertOpenAIResponseToAnthropic(responseData, body.model);
        logEntry.promptTokens = responseData.usage?.prompt_tokens;
        logEntry.completionTokens = responseData.usage?.completion_tokens;
        logEntry.totalTokens = responseData.usage?.total_tokens;
        logEntry.cachedTokens = responseData.usage?.prompt_tokens_details?.cached_tokens ?? null;
        console.log(`   🔄 [OpenAI→Anthropic 转换]`);
        resultResponse = anthropicResponse;
      } else {
        logEntry.promptTokens = responseData.usage?.input_tokens;
        logEntry.completionTokens = responseData.usage?.output_tokens;
        logEntry.totalTokens = responseData.usage?.input_tokens + responseData.usage?.output_tokens;
        logEntry.cachedTokens = responseData.usage?.cache_read_input_tokens ?? null;
        resultResponse = responseData;
      }

      logger.log(logEntry);
      const pricing = provider.inputPricePer1M !== undefined && provider.outputPricePer1M !== undefined && provider.cachedPricePer1M !== undefined
        ? { inputPricePer1M: provider.inputPricePer1M, outputPricePer1M: provider.outputPricePer1M, cachedPricePer1M: provider.cachedPricePer1M }
        : undefined;
      rateLimiter.recordUsage(modelName, logEntry, pricing);
      return c.json(resultResponse);
    } catch {
      // 忽略解析错误
    }
  }

  logger.log(logEntry);

  if (!response.body) {
    console.log(`\n❌ [错误] 上游响应体为空 ${requestId}`);
    return c.json({ error: { message: 'No response body' } }, 500);
  }

  // 流式响应处理
  if (stream) {
    const providerFormat = provider.provider;
    const streamState = providerFormat === 'openai' ? createOpenAIToAnthropicStreamState() : undefined;

    const chunks: string[] = [];
    const rawChunks: string[] = [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const transformedStream = new ReadableStream({
      async start(controller) {
        try {
          let buffer = '';
          let finalUsage: any = null;

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              detailLogger.logStreamResponse(requestId + '_raw', rawChunks);

              // 从最后的 chunk 中提取 cachedTokens 和 usage 信息
              for (let i = chunks.length - 1; i >= 0; i--) {
                try {
                  const chunkText = chunks[i];
                  const lines = chunkText.split('\n');
                  for (const line of lines) {
                    if (line.startsWith('data:')) {
                      const chunkJson = JSON.parse(line.slice(5).trim());
                      if (chunkJson.usage?.prompt_tokens_details?.cached_tokens) {
                        logEntry.cachedTokens = chunkJson.usage.prompt_tokens_details.cached_tokens;
                        finalUsage = chunkJson.usage;
                        break;
                      }
                      if (chunkJson.usage?.input_tokens_details?.cached_tokens) {
                        logEntry.cachedTokens = chunkJson.usage.input_tokens_details.cached_tokens;
                        finalUsage = chunkJson.usage;
                        break;
                      }
                      if (chunkJson.usage && !finalUsage) {
                        finalUsage = chunkJson.usage;
                      }
                    }
                  }
                } catch { /* ignore */ }
              }

              if (finalUsage) {
                logEntry.promptTokens = finalUsage.prompt_tokens || finalUsage.input_tokens;
                logEntry.completionTokens = finalUsage.completion_tokens || finalUsage.output_tokens;
                logEntry.totalTokens = finalUsage.total_tokens || (logEntry.promptTokens || 0) + (logEntry.completionTokens || 0);
              }

              logger.log(logEntry);
              const pricing = provider.inputPricePer1M !== undefined && provider.outputPricePer1M !== undefined && provider.cachedPricePer1M !== undefined
                ? { inputPricePer1M: provider.inputPricePer1M, outputPricePer1M: provider.outputPricePer1M, cachedPricePer1M: provider.cachedPricePer1M }
                : undefined;
              rateLimiter.recordUsage(modelName, logEntry, pricing);
              detailLogger.logStreamResponse(requestId, chunks);
              controller.close();
              break;
            }

            const chunk = decoder.decode(value, { stream: false });
            rawChunks.push(chunk);
            buffer += chunk;

            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';

            for (const part of parts) {
              if (!part.trim()) continue;

              if (providerFormat === 'openai') {
                const anthropicChunks = parseAndConvertOpenAISSE(part, streamState!);
                for (const anthropicChunk of anthropicChunks) {
                  chunks.push(anthropicChunk);
                  controller.enqueue(new TextEncoder().encode(anthropicChunk));
                }
              } else {
                let sseLine = part;
                sseLine += '\n\n';
                chunks.push(sseLine);
                try {
                  controller.enqueue(new TextEncoder().encode(sseLine));
                } catch (err: any) {
                  if (err?.name === 'AbortError' || err?.code === 'ERR_INVALID_STATE' || err?.message?.includes('Controller is already closed')) return;
                  throw err;
                }
              }
            }
          }
        } catch (error) {
          console.log(`   ❌ [流式处理错误] ${error}`);
          try { controller.error(error); } catch { /* ignore */ }
        }
      }
    });

    console.log(`\n✅ [完成] ${requestId} - 耗时：${Date.now() - startTime}ms\n`);
    return c.body(transformedStream);
  }

  console.log(`\n✅ [完成] ${requestId} - 耗时：${Date.now() - startTime}ms\n`);
  return c.body(response.body);
}
