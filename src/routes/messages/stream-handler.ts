import type { ProviderConfig } from '../../config.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { Logger } from '../../logger.js';
import { createOpenAIToAnthropicStreamState, type OpenAIToAnthropicStreamState } from '../../converters/formats/anthropic/openai-to-anthropic.js';
import { parseAndConvertOpenAISSE } from '../utils/sse-handlers-messages.js';
import { sanitizeSSEChunk } from '../../privacy/sanitizer.js';
import { findFinalUsageFromChunks } from '../../lib/stream-usage.js';
import { resolveConverterChain } from '../../converters/router.js';
import type { FormatName } from '../../converters/format-adapter.js';
import { RequestLogger } from '../../lib/request-logger.js';
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
  requestLogger?: RequestLogger;
  currentUser?: { name: string } | null;
}

function isSilentError(err: any): boolean {
  return (
    err?.name === 'AbortError' ||
    err?.code === 'ERR_INVALID_STATE' ||
    err?.message?.includes('Controller is already closed')
  );
}

export function handleStream(options: StreamHandlerOptions): Response {
  const { response, provider, model, actualModel, requestId, startTime, logEntry, rateLimiter, logger, detailLogger, c, requestLogger, currentUser } = options;

  if (!response.body) {
    return c.json({ error: { message: 'No response body' } }, 500);
  }

  const providerFormat = provider.provider;
  const plan = resolveConverterChain('anthropic', providerFormat as FormatName);
  const isResponseApi = providerFormat === 'response-api';
  const streamState: OpenAIToAnthropicStreamState | undefined =
    (!plan.passthrough && !isResponseApi) ? createOpenAIToAnthropicStreamState() : undefined;
  // response-api 上游：Responses 命名事件 SSE -> canonical -> Anthropic SSE（同 chat 路由的双转换串联思路）
  const responsesUpstream = isResponseApi ? plan.providerAdapter.createUpstreamStream() : undefined;
  const anthropicDownstream = isResponseApi ? plan.sourceAdapter.createDownstreamStream() : undefined;

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
        let finalUsage: any = null;
        let eventCounter = 0;
        let convertedEventCounter = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // 处理缓冲区中剩余的数据
            if (buffer.trim()) {
              const part = buffer.trim();
              if (isResponseApi) {
                const block = `${part}\n\n`;
                for (const chatChunk of responsesUpstream!.transform(block)) {
                  for (const out of anthropicDownstream!.transform(chatChunk)) {
                    chunks.push(out);
                    controller.enqueue(new TextEncoder().encode(out)); markTtft();
                    convertedEventCounter++;
                  }
                }
              } else if (!plan.passthrough) {
                const anthropicChunks = parseAndConvertOpenAISSE(part, streamState!, { requestId, provider: provider.provider });
                for (const anthropicChunk of anthropicChunks) {
                  chunks.push(anthropicChunk);
                  controller.enqueue(new TextEncoder().encode(anthropicChunk)); markTtft();
                  convertedEventCounter += anthropicChunks.length;
                }
              } else {
                const sseLine = part + '\n\n';
                chunks.push(sseLine);
                controller.enqueue(new TextEncoder().encode(sseLine)); markTtft();
              }
            }
            if (isResponseApi) {
              for (const chatChunk of responsesUpstream!.flush()) {
                for (const out of anthropicDownstream!.transform(chatChunk)) {
                  chunks.push(out);
                  controller.enqueue(new TextEncoder().encode(out)); markTtft();
                  convertedEventCounter++;
                }
              }
              for (const out of anthropicDownstream!.flush()) {
                chunks.push(out);
                controller.enqueue(new TextEncoder().encode(out)); markTtft();
                convertedEventCounter++;
              }
            }

            detailLogger.logStreamResponse(requestId + '_raw', rawChunks);

            // Extract usage using unified function (output is always Anthropic format)
            const streamUsage = findFinalUsageFromChunks(chunks, 'anthropic', { requestId, provider: provider.provider });
            if (streamUsage) {
              logEntry.promptTokens = streamUsage.promptTokens;
              logEntry.completionTokens = streamUsage.completionTokens;
              logEntry.totalTokens = streamUsage.totalTokens;
              if (streamUsage.cachedTokens) {
                logEntry.cachedTokens = streamUsage.cachedTokens;
              }
            }

            logEntry.durationMs = Date.now() - startTime;
            logEntry.tps = calcTps(logEntry.completionTokens, logEntry.durationMs, logEntry.ttftMs);
            detailLogger.logStreamResponse(requestId, chunks);
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
                errorMessage: logEntry.error?.message,
                errorType: logEntry.error?.type,
                responseMetadata: logEntry.responseMetadata,
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

            eventCounter++;

            if (isResponseApi) {
              const block = `${part}\n\n`;
              for (const chatChunk of responsesUpstream!.transform(block)) {
                for (const out of anthropicDownstream!.transform(chatChunk)) {
                  chunks.push(out);
                  let chunk = out;
                  if (options.privacySettings?.enabled && options.privacySettings.sanitizeFilePaths) {
                    chunk = sanitizeSSEChunk(chunk, options.requestId);
                  }
                  try {
                    controller.enqueue(new TextEncoder().encode(chunk)); markTtft();
                  } catch (err) {
                    if (isSilentError(err)) return;
                    throw err;
                  }
                  convertedEventCounter++;
                }
              }
            } else if (!plan.passthrough) {
              // OpenAI → Anthropic 流式转换
              const anthropicChunks = parseAndConvertOpenAISSE(part, streamState!, { requestId, provider: provider.provider });
              for (const anthropicChunk of anthropicChunks) {
                chunks.push(anthropicChunk);
                let chunk = anthropicChunk;
                if (options.privacySettings?.enabled && options.privacySettings.sanitizeFilePaths) {
                  chunk = sanitizeSSEChunk(chunk, options.requestId);
                }
                controller.enqueue(new TextEncoder().encode(chunk)); markTtft();
                convertedEventCounter++;
              }
            } else {
              // Anthropic provider: 直接透传
              const sseLine = part + '\n\n';
              chunks.push(sseLine);
              let chunk = sseLine;
              if (options.privacySettings?.enabled && options.privacySettings.sanitizeFilePaths) {
                chunk = sanitizeSSEChunk(chunk, options.requestId);
              }
              try {
                controller.enqueue(new TextEncoder().encode(chunk)); markTtft();
              } catch (err) {
                if (isSilentError(err)) return;
                throw err;
              }
            }
          }
        }

        detailLogger.logStreamResponse(requestId + '_stats', [JSON.stringify({ event: 'sse_stats', rawEvents: eventCounter, convertedEvents: convertedEventCounter })]);
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
