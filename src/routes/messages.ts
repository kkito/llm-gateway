import { Hono } from 'hono';
import type { ProviderConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { DetailLogger } from '../detail-logger.js';
import { v4 as uuidv4 } from 'uuid';
import { buildHeaders, buildUrl } from '../providers/index.js';
import { convertAnthropicRequestToOpenAI, convertOpenAIResponseToAnthropic } from '../converters/anthropic-to-openai.js';
import {
  convertOpenAIStreamChunkToAnthropic,
  formatAnthropicEventToSSE,
  parseOpenAISSEData,
  createOpenAIToAnthropicStreamState,
  type OpenAIToAnthropicStreamState
} from '../converters/openai-to-anthropic.js';
import { getCurrentUser } from '../user/middleware/auth.js';

/**
 * 解析 OpenAI SSE 块并转换为 Anthropic 格式
 */
function parseAndConvertOpenAISSE(
  sseBlock: string,
  state: OpenAIToAnthropicStreamState
): string[] {
  const anthropicChunks: string[] = [];
  const lines = sseBlock.split('\n');
  
  for (const line of lines) {
    const parsed = parseOpenAISSEData(line);
    if (!parsed?.data) continue;
    
    // 将 OpenAI chunk 转换为 Anthropic 事件
    const anthropicEvents = convertOpenAIStreamChunkToAnthropic(parsed.data, state);
    
    for (const event of anthropicEvents) {
      anthropicChunks.push(formatAnthropicEventToSSE(event));
    }
  }
  
  return anthropicChunks;
}

export function createMessagesRoute(
  config: ProviderConfig[] | (() => ProviderConfig[]),
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number
) {
  const router = new Hono();

  // 处理函数
  const handler = async (c: any, endpoint: string) => {
    const startTime = Date.now();
    const requestId = uuidv4();
    let customModel = 'unknown';
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
  router.post('/v1/messages', (c) => handler(c, '/v1/messages'));
  router.post('/messages', (c) => handler(c, '/messages'));
  router.post('/v1/v1/messages', (c) => handler(c, '/v1/v1/messages'));

  return router;
}
