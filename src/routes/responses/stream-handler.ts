import type { ProviderConfig } from '../../config.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { Logger } from '../../logger.js';
import { resolveConverterChain } from '../../converters/router.js';
import { calcTps } from '../../lib/stream-metrics.js';

export interface StreamHandlerOptions {
  response: Response;
  provider: ProviderConfig;
  model: string;
  actualModel: string;
  requestId: string;
  startTime: number;
  logEntry: any;
  rateLimiter: RateLimiter;
  logger: Logger;
  detailLogger: DetailLogger;
  c: any;
  privacySettings?: any;
  requestLogger?: any;
  currentUser?: { name: string } | null;
}

function isSilentError(err: any): boolean {
  return (
    err?.name === 'AbortError' ||
    err?.code === 'ERR_INVALID_STATE' ||
    err?.message?.includes('Controller is already closed')
  );
}

/**
 * 从 responses 命名事件 SSE 字符串里反向查找最后的 response.usage。
 * 最终用量在 `response.completed` 事件的 `response.usage.{input_tokens,output_tokens}` 中。
 */
function extractUsageFromResponsesChunks(chunks: string[]): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
} | null {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const lines = chunks[i].split('\n');
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr) continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const usage = parsed?.response?.usage;
        if (!usage) continue;
        const promptTokens = usage.input_tokens ?? 0;
        const completionTokens = usage.output_tokens ?? 0;
        const result: any = {
          promptTokens,
          completionTokens,
          totalTokens: usage.total_tokens ?? promptTokens + completionTokens,
        };
        if (usage.cached_tokens) result.cachedTokens = usage.cached_tokens;
        const cachedFromDetails = usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens;
        if (cachedFromDetails) result.cachedTokens = cachedFromDetails;
        return result;
      } catch {
        // 跳过无法解析的块
      }
    }
  }
  return null;
}

/**
 * 同构 passthrough（responses -> responses）：上游 SSE 命名事件字节直传，
 * 只做 SSE 块边界切分与用量提取，不做上游->chat->下游事件重组。
 * 重组会丢事件（如 response.output_item.done 的 function_call item、
 * completed.output），导致前端工具调用无法驱动。
 */
export function handleStream(options: StreamHandlerOptions): Response {
  const { response, provider, model, actualModel, requestId, startTime, logEntry, rateLimiter, logger, detailLogger, c, requestLogger, currentUser } = options;

  if (!response.body) {
    return c.json({ error: { message: 'No response body' } }, 500);
  }

  const plan = resolveConverterChain('responses', provider.provider as any);
  if (!plan.passthrough) {
    return handleConvertedStream(options, plan);
  }

  const chunks: string[] = [];
  const rawChunks: string[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const passthroughStream = new ReadableStream({
    async start(controller) {
      let firstEnqueueAt: number | null = null;
      const markTtft = () => {
        if (firstEnqueueAt === null) {
          firstEnqueueAt = Date.now();
          logEntry.ttftMs = firstEnqueueAt - startTime;
        }
      };
      const finish = () => {
        logEntry.durationMs = Date.now() - startTime;
        detailLogger.logStreamResponse(requestId + '_raw', rawChunks);
        detailLogger.logStreamResponse(requestId, chunks);

        const usage = extractUsageFromResponsesChunks(chunks.length ? chunks : rawChunks);
        if (usage) {
          logEntry.promptTokens = usage.promptTokens;
          logEntry.completionTokens = usage.completionTokens;
          logEntry.totalTokens = usage.totalTokens;
          if (usage.cachedTokens !== undefined) logEntry.cachedTokens = usage.cachedTokens;
        }
        logEntry.tps = calcTps(logEntry.completionTokens, logEntry.durationMs, logEntry.ttftMs);
        if (requestLogger) {
          requestLogger.log({
            requestId: logEntry.requestId,
            timestamp: logEntry.timestamp,
            userName: currentUser?.name ?? undefined,
            customModel: logEntry.customModel,
            realModel: logEntry.realModel,
            provider: logEntry.provider,
            endpoint: logEntry.endpoint,
            statusCode: logEntry.statusCode,
            durationMs: logEntry.durationMs,
            isStreaming: true,
            promptTokens: logEntry.promptTokens,
            completionTokens: logEntry.completionTokens,
            totalTokens: logEntry.totalTokens,
            cachedTokens: logEntry.cachedTokens,
            modelGroup: logEntry.modelGroup,
            actualModel: logEntry.actualModel,
            ttftMs: logEntry.ttftMs ?? null,
            tps: logEntry.tps ?? null,
          });
        }
        logger.log(logEntry);

        const pricing =
          provider.inputPricePer1M !== undefined &&
          provider.outputPricePer1M !== undefined &&
          provider.cachedPricePer1M !== undefined
            ? {
                inputPricePer1M: provider.inputPricePer1M,
                outputPricePer1M: provider.outputPricePer1M,
                cachedPricePer1M: provider.cachedPricePer1M,
              }
            : undefined;
        rateLimiter.recordUsage(actualModel || model, logEntry, pricing);
        controller.close();
      };
      try {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) {
              const block = buffer.endsWith('\n\n') ? buffer : buffer + '\n\n';
              chunks.push(block);
              controller.enqueue(new TextEncoder().encode(block)); markTtft();
            }
            finish();
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          rawChunks.push(chunk);
          buffer += chunk;

          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            if (!part.trim()) continue;
            const block = part + '\n\n';
            chunks.push(block);
            try {
              controller.enqueue(new TextEncoder().encode(block)); markTtft();
            } catch (err) {
              if (isSilentError(err)) return;
              throw err;
            }
          }
        }
      } catch (error) {
        try {
          controller.error(error);
        } catch {
          // controller already closed
        }
      }
    },
  });

  c.header('Content-Type', 'text/event-stream; charset=UTF-8');
  return c.body(passthroughStream);
}

/**
 * 串联两段有状态流：
 * 上游 provider 格式 SSE -> canonical ChatStreamChunk[] -> 客户端 responses 命名事件 SSE。
 */
function handleConvertedStream(options: StreamHandlerOptions, plan: ReturnType<typeof resolveConverterChain>): Response {
  const { response, provider, model, actualModel, requestId, startTime, logEntry, rateLimiter, logger, detailLogger, c, requestLogger, currentUser } = options;

  if (!response.body) {
    return c.json({ error: { message: 'No response body' } }, 500);
  }

  const upstream = plan.providerAdapter.createUpstreamStream();   // 上游格式 -> chat
  const downstream = plan.sourceAdapter.createDownstreamStream(); // chat -> responses 客户端

  const chunks: string[] = [];
  const rawChunks: string[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const transformedStream = new ReadableStream({
    async start(controller) {
      let firstEnqueueAt: number | null = null;
      const markTtft = () => {
        if (firstEnqueueAt === null) {
          firstEnqueueAt = Date.now();
          logEntry.ttftMs = firstEnqueueAt - startTime;
        }
      };
      try {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) {
              for (const chatChunk of upstream.transform(buffer)) {
                for (const out of downstream.transform(chatChunk)) {
                  chunks.push(out);
                  controller.enqueue(new TextEncoder().encode(out)); markTtft();
                }
              }
            }
            for (const chatChunk of upstream.flush()) {
              for (const out of downstream.transform(chatChunk)) {
                chunks.push(out);
                controller.enqueue(new TextEncoder().encode(out)); markTtft();
              }
            }
            for (const out of downstream.flush()) {
              chunks.push(out);
              controller.enqueue(new TextEncoder().encode(out)); markTtft();
            }

            logEntry.durationMs = Date.now() - startTime;
            detailLogger.logStreamResponse(requestId + '_raw', rawChunks);
            detailLogger.logStreamResponse(requestId, chunks);

            // 提取最终流式用量，对齐 messages/chat-completions 路由的记费与计量
            const usage = extractUsageFromResponsesChunks(chunks);
            if (usage) {
              logEntry.promptTokens = usage.promptTokens;
              logEntry.completionTokens = usage.completionTokens;
              logEntry.totalTokens = usage.totalTokens;
              if (usage.cachedTokens !== undefined) logEntry.cachedTokens = usage.cachedTokens;
            }
            logEntry.tps = calcTps(logEntry.completionTokens, logEntry.durationMs, logEntry.ttftMs);
            if (requestLogger) {
              requestLogger.log({
                requestId: logEntry.requestId,
                timestamp: logEntry.timestamp,
                userName: currentUser?.name ?? undefined,
                customModel: logEntry.customModel,
                realModel: logEntry.realModel,
                provider: logEntry.provider,
                endpoint: logEntry.endpoint,
                statusCode: logEntry.statusCode,
                durationMs: logEntry.durationMs,
                isStreaming: true,
                promptTokens: logEntry.promptTokens,
                completionTokens: logEntry.completionTokens,
                totalTokens: logEntry.totalTokens,
                cachedTokens: logEntry.cachedTokens,
                modelGroup: logEntry.modelGroup,
                actualModel: logEntry.actualModel,
                ttftMs: logEntry.ttftMs ?? null,
                tps: logEntry.tps ?? null,
              });
            }
            logger.log(logEntry);

            const pricing =
              provider.inputPricePer1M !== undefined &&
              provider.outputPricePer1M !== undefined &&
              provider.cachedPricePer1M !== undefined
                ? {
                    inputPricePer1M: provider.inputPricePer1M,
                    outputPricePer1M: provider.outputPricePer1M,
                    cachedPricePer1M: provider.cachedPricePer1M,
                  }
                : undefined;
            rateLimiter.recordUsage(actualModel || model, logEntry, pricing);
            controller.close();
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          rawChunks.push(chunk);
          buffer += chunk;

          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            if (!part.trim()) continue;
            for (const chatChunk of upstream.transform(part + '\n\n')) {
              for (const out of downstream.transform(chatChunk)) {
                chunks.push(out);
                try {
                  controller.enqueue(new TextEncoder().encode(out)); markTtft();
                } catch (err) {
                  if (isSilentError(err)) return;
                  throw err;
                }
              }
            }
          }
        }
      } catch (error) {
        try {
          controller.error(error);
        } catch {
          // controller already closed
        }
      }
    },
  });

  c.header('Content-Type', 'text/event-stream; charset=UTF-8');
  return c.body(transformedStream);
}
