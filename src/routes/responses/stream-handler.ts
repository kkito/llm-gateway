import type { ProviderConfig } from '../../config.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { Logger } from '../../logger.js';
import { resolveConverterChain } from '../../converters/router.js';

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
        return result;
      } catch {
        // 跳过无法解析的块
      }
    }
  }
  return null;
}

/**
 * 串联两段有状态流：
 * 上游 provider 格式 SSE -> canonical ChatStreamChunk[] -> 客户端 responses 命名事件 SSE。
 */
export function handleStream(options: StreamHandlerOptions): Response {
  const { response, provider, model, actualModel, requestId, logEntry, rateLimiter, logger, detailLogger, c, requestLogger, currentUser } = options;

  if (!response.body) {
    return c.json({ error: { message: 'No response body' } }, 500);
  }

  const plan = resolveConverterChain('responses', provider.provider as any);
  const upstream = plan.providerAdapter.createUpstreamStream();   // 上游格式 -> chat
  const downstream = plan.sourceAdapter.createDownstreamStream(); // chat -> responses 客户端

  const chunks: string[] = [];
  const rawChunks: string[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const transformedStream = new ReadableStream({
    async start(controller) {
      try {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) {
              for (const chatChunk of upstream.transform(buffer)) {
                for (const out of downstream.transform(chatChunk)) {
                  chunks.push(out);
                  controller.enqueue(new TextEncoder().encode(out));
                }
              }
            }
            for (const chatChunk of upstream.flush()) {
              for (const out of downstream.transform(chatChunk)) {
                chunks.push(out);
                controller.enqueue(new TextEncoder().encode(out));
              }
            }
            for (const out of downstream.flush()) {
              chunks.push(out);
              controller.enqueue(new TextEncoder().encode(out));
            }

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
                  controller.enqueue(new TextEncoder().encode(out));
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
