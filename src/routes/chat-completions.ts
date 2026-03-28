import { Hono } from 'hono';
import type { ProviderConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { DetailLogger } from '../detail-logger.js';
import { v4 as uuidv4 } from 'uuid';
import { buildHeaders, buildUrl } from '../providers/index.js';
import { convertOpenAIRequestToAnthropic, convertAnthropicResponseToOpenAI } from '../converters/openai-to-anthropic.js';
import {
  convertAnthropicStreamEventToOpenAI,
  parseSSEBlock,
  createStreamConverterState,
  type StreamConverterState
} from '../converters/anthropic-to-openai.js';
import { getCurrentUser } from '../user/middleware/auth.js';
import { RateLimiter } from '../lib/rate-limiter.js';
import { getProxyDir } from '../config.js';

/**
 * 从 SSE chunks 构建完整的 OpenAI 响应
 */
function buildFullOpenAIResponse(chunks: string[]): any {
  const choices: any[] = [];
  let usage: any = null;
  let model = '';
  let id = '';
  let created = 0;

  for (const chunk of chunks) {
    if (!chunk.startsWith('data:') || chunk === 'data: [DONE]') continue;
    const data = chunk.slice(5).trim();
    if (!data || data === '[DONE]') continue;

    try {
      const json = JSON.parse(data);
      id = json.id || id;
      model = json.model || model;
      created = json.created || created;

      if (json.choices) {
        for (const choice of json.choices) {
          if (!choices[choice.index]) {
            choices[choice.index] = { index: choice.index, message: { role: '', content: '' }, finish_reason: '' };
          }
          if (choice.delta?.content) {
            choices[choice.index].message.content += choice.delta.content;
          }
          if (choice.delta?.role) {
            choices[choice.index].message.role = choice.delta.role;
          }
          if (choice.finish_reason) {
            choices[choice.index].finish_reason = choice.finish_reason;
          }
        }
      }

      if (json.usage) {
        usage = json.usage;
      }
    } catch {
      // 忽略解析错误
    }
  }

  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: choices.filter(Boolean),
    usage
  };
}

/**
 * 解析 Anthropic SSE 块并转换为 OpenAI 格式
 */
function parseAndConvertAnthropicSSE(
  sseBlock: string,
  requestId: string,
  model: string,
  state: StreamConverterState
): string[] {
  const openAIChunks: string[] = [];
  const events = parseSSEBlock(sseBlock);
  
  for (const { event, data } of events) {
    if (!data) continue;
    
    // 将 Anthropic 事件转换为 OpenAI chunk
    const openAIChunk = convertAnthropicStreamEventToOpenAI(data, requestId, model, state);
    
    if (openAIChunk) {
      openAIChunks.push(`data: ${JSON.stringify(openAIChunk)}\n\n`);
    }
  }
  
  return openAIChunks;
}

export function createChatCompletionsRoute(
  config: ProviderConfig[] | (() => ProviderConfig[]),
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
    
    // 获取当前用户
    const currentUser = getCurrentUser(c);

    try {
      const body = await c.req.json();
      customModel = body.model;
      const { model, stream } = body;

      // 记录用户请求
      detailLogger.logRequest(requestId, body);

      console.log(`\n📥 [请求] ${requestId} - 模型：${model} - 流式：${!!stream}`);

      // 获取最新配置
      const currentConfig = typeof config === 'function' ? config() : config;
      const provider = currentConfig.find(p => p.customModel === model);
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

      if (provider.provider === 'openai') {
        // OpenAI provider: 流式请求需要添加 stream_options.include_usage=true 才能获取 cached_tokens
        upstreamBody = { 
          ...body, 
          model: provider.realModel,
          ...(stream ? { stream_options: { include_usage: true } } : {})
        };
        requestHeaders = buildHeaders(provider);
        upstreamUrl = buildUrl(provider, 'chat');
        console.log(`   🔄 [OpenAI 透传]${stream ? ' (含 stream_options)' : ''}`);
      } else {
        // Anthropic provider: 转换请求格式
        const anthropicRequest = await convertOpenAIRequestToAnthropic(body);
        upstreamBody = { ...anthropicRequest, model: provider.realModel };
        requestHeaders = buildHeaders(provider);
        upstreamUrl = buildUrl(provider, 'chat');
        console.log(`   🔄 [OpenAI→Anthropic 转换]`);
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
        customModel: model,
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

          // 如果 provider 是 Anthropic，需要转换响应格式回 OpenAI
          if (provider.provider === 'anthropic') {
            const openaiResponse = convertAnthropicResponseToOpenAI(responseData, model);
            logEntry.promptTokens = responseData.usage?.input_tokens;
            logEntry.completionTokens = responseData.usage?.output_tokens;
            logEntry.totalTokens = responseData.usage?.input_tokens + responseData.usage?.output_tokens;
            // Anthropic 返回 cache_read_input_tokens 和 cache_creation_input_tokens 在顶层
            logEntry.cachedTokens = responseData.usage?.cache_read_input_tokens ?? null;
            console.log(`   🔄 [Anthropic→OpenAI 转换]`);
            logger.log(logEntry);
            // 记录用量
            const pricing = provider.inputPricePer1M !== undefined && provider.outputPricePer1M !== undefined && provider.cachedPricePer1M !== undefined ? {
              inputPricePer1M: provider.inputPricePer1M,
              outputPricePer1M: provider.outputPricePer1M,
              cachedPricePer1M: provider.cachedPricePer1M
            } : undefined;
            rateLimiter.recordUsage(model, logEntry, pricing);
            return c.json(openaiResponse);
          } else {
            // OpenAI provider: 直接透传
            logEntry.promptTokens = responseData.usage?.prompt_tokens;
            logEntry.completionTokens = responseData.usage?.completion_tokens;
            logEntry.totalTokens = responseData.usage?.total_tokens;
            // OpenAI 返回 prompt_tokens_details.cached_tokens
            logEntry.cachedTokens = responseData.usage?.prompt_tokens_details?.cached_tokens ?? null;
            logger.log(logEntry);
            // 记录用量
            const pricing = provider.inputPricePer1M !== undefined && provider.outputPricePer1M !== undefined && provider.cachedPricePer1M !== undefined ? {
              inputPricePer1M: provider.inputPricePer1M,
              outputPricePer1M: provider.outputPricePer1M,
              cachedPricePer1M: provider.cachedPricePer1M
            } : undefined;
            rateLimiter.recordUsage(model, logEntry, pricing);
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
        const requestFormat = 'openai'; // /v1/chat/completions 是 OpenAI 格式
        const providerFormat = provider.provider;

        // 初始化流式转换状态（用于 Anthropic → OpenAI 转换）
        const streamState = providerFormat === 'anthropic' ? createStreamConverterState() : undefined;

        const chunks: string[] = [];
        const rawChunks: string[] = []; // 记录原始上游响应
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        const transformedStream = new ReadableStream({
          async start(controller) {
            try {
              let buffer = ''; // 用于累积不完整的 SSE 块
              let finalUsage: any = null; // 用于存储最终的 usage 信息

              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  // 记录原始上游响应到文件
                  detailLogger.logStreamResponse(requestId + '_raw', rawChunks);
                  // 从最后的 chunk 中提取 cachedTokens 和 usage 信息
                  for (let i = chunks.length - 1; i >= 0; i--) {
                    try {
                      const chunkJson = JSON.parse(chunks[i].slice(5).trim());
                      // OpenAI 格式：从 prompt_tokens_details.cached_tokens 读取
                      if (chunkJson.usage?.prompt_tokens_details?.cached_tokens) {
                        logEntry.cachedTokens = chunkJson.usage.prompt_tokens_details.cached_tokens;
                        finalUsage = chunkJson.usage;
                        break;
                      }
                      // Anthropic 格式：从 message_delta 事件的 usage 读取，字段是 cache_read_input_tokens
                      if (chunkJson.usage?.cache_read_input_tokens) {
                        logEntry.cachedTokens = chunkJson.usage.cache_read_input_tokens;
                        finalUsage = chunkJson.usage;
                        break;
                      }
                      // 通用 usage 提取（兜底）
                      if (chunkJson.usage && !finalUsage) {
                        finalUsage = chunkJson.usage;
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
                    // cachedTokens 已经在上面提取了
                  }

                  // 如果有最终 usage 信息，发送最后一个包含 usage 的 chunk
                  if (finalUsage) {
                    const finalChunk = `data: ${JSON.stringify({
                      id: requestId,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model,
                      choices: [{ index: 0, delta: {}, finish_reason: null }],
                      usage: finalUsage
                    })}\n\n`;
                    controller.enqueue(new TextEncoder().encode(finalChunk));
                  }

                  // 记录流式响应到文件
                  detailLogger.logStreamResponse(requestId, chunks);

                  // 构建完整 JSON 并记录
                  const fullResponse = buildFullOpenAIResponse(chunks);
                  detailLogger.logConvertedResponse(requestId, fullResponse);

                  // 记录流式请求的日志（包含 Token 信息）
                  logger.log(logEntry);

                  // 记录用量
                  const pricing = provider.inputPricePer1M !== undefined && provider.outputPricePer1M !== undefined && provider.cachedPricePer1M !== undefined ? {
                    inputPricePer1M: provider.inputPricePer1M,
                    outputPricePer1M: provider.outputPricePer1M,
                    cachedPricePer1M: provider.cachedPricePer1M
                  } : undefined;
                  rateLimiter.recordUsage(model, logEntry, pricing);

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
                  if (providerFormat === 'anthropic') {
                    // Anthropic → OpenAI 流式转换
                    const openAIChunks = parseAndConvertAnthropicSSE(
                      part,
                      requestId,
                      model,
                      streamState!
                    );

                    for (const openAIChunk of openAIChunks) {
                      chunks.push(openAIChunk);
                      controller.enqueue(new TextEncoder().encode(openAIChunk));
                    }
                  } else {
                    // 格式一致：直接透传
                    // 确保 SSE 格式正确
                    let sseLine = part;
                    if (!sseLine.startsWith('data:')) {
                      sseLine = `data: ${sseLine}`;
                    }
                    if (!sseLine.endsWith('\n\n')) {
                      sseLine += '\n\n';
                    }

                    chunks.push(sseLine);
                    controller.enqueue(new TextEncoder().encode(sseLine));
                  }
                }
              }
            } catch (error) {
              console.log(`   ❌ [流式处理错误] ${error}`);
              controller.error(error);
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
        customModel,
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
      return c.json({
        error: { message: error.message || 'Internal error' }
      }, 500);
    }
  };

  // 注册多个 alias 路径
  router.post('/v1/chat/completions', (c) => handler(c, '/v1/chat/completions'));
  router.post('/chat/completions', (c) => handler(c, '/chat/completions'));
  router.post('/v1/v1/chat/completions', (c) => handler(c, '/v1/v1/chat/completions'));

  return router;
}
