import type { ProviderConfig } from '../../config.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { Logger } from '../../logger.js';
import { createStreamConverterState, type StreamConverterState } from '../../converters/formats/anthropic/anthropic-to-openai.js';
import { buildFullOpenAIResponse, parseAndConvertAnthropicSSE } from '../utils/sse-handlers.js';
import { sanitizeSSEChunk } from '../../privacy/sanitizer.js';
import { findFinalUsageFromChunks, hasStreamEnded } from '../../lib/stream-usage.js';
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
  const plan = resolveConverterChain('chat', providerFormat as FormatName);
  const isResponseApi = providerFormat === 'response-api';
  const streamState: StreamConverterState | undefined =
    (!plan.passthrough && !isResponseApi) ? createStreamConverterState() : undefined;

  // response-api 上游（responses SSE -> canonical chunk -> OpenAI chat SSE）：按 cc-switch 思路，
  // 用 upstream/downstream 双 StreamConverter 串联，结尾补 data: [DONE]。
  const responsesUpstream = isResponseApi
    ? plan.providerAdapter.createUpstreamStream()
    : undefined;
  const chatDownstream = isResponseApi
    ? plan.sourceAdapter.createDownstreamStream()
    : undefined;

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

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // response-api 上游：flush 剩余 buffer，串接 upstream/downstream 转换
            // （[DONE] 在 finalUsage 之后统一补发，确保其是流最后一条）
            if (isResponseApi) {
              if (buffer.trim()) {
                for (const chatChunk of responsesUpstream!.transform(buffer)) {
                  for (const out of chatDownstream!.transform(chatChunk)) {
                    chunks.push(out);
                    controller.enqueue(new TextEncoder().encode(out)); markTtft();
                  }
                }
              }
              for (const chatChunk of responsesUpstream!.flush()) {
                for (const out of chatDownstream!.transform(chatChunk)) {
                  chunks.push(out);
                  controller.enqueue(new TextEncoder().encode(out)); markTtft();
                }
              }
              for (const out of chatDownstream!.flush()) {
                chunks.push(out);
                controller.enqueue(new TextEncoder().encode(out)); markTtft();
              }
            }
            // OpenRouter: last chunk may not end with \n\n
            if (provider.baseUrl?.includes('openrouter') && buffer.trim()) {
              let sseLine = buffer;
              if (!sseLine.startsWith('data:')) {
                sseLine = `data: ${sseLine}`;
              }
              if (!sseLine.endsWith('\n\n')) {
                sseLine += '\n\n';
              }
              chunks.push(sseLine);
              try {
                controller.enqueue(new TextEncoder().encode(sseLine)); markTtft();
              } catch (err) {
                if (!isSilentError(err)) throw err;
              }
            }

            detailLogger.logStreamResponse(requestId + '_raw', rawChunks);

            // Extract usage using unified function (output is always OpenAI format)
            const streamUsage = findFinalUsageFromChunks(chunks, 'openai', { requestId, provider: provider.provider });
            if (streamUsage) {
              logEntry.promptTokens = streamUsage.promptTokens;
              logEntry.completionTokens = streamUsage.completionTokens;
              logEntry.totalTokens = streamUsage.totalTokens;
              if (streamUsage.cachedTokens) {
                logEntry.cachedTokens = streamUsage.cachedTokens;
              }
              finalUsage = {
                prompt_tokens: streamUsage.promptTokens,
                completion_tokens: streamUsage.completionTokens,
                total_tokens: streamUsage.totalTokens,
              };
            }

            if (finalUsage) {
              const finalChunk = `data: ${JSON.stringify({
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: {}, finish_reason: null }],
                usage: finalUsage,
              })}\n\n`;
              controller.enqueue(new TextEncoder().encode(finalChunk)); markTtft();
            }

            // 非 response-api 上游兜底：若确实透传了内容块，但整个流既无 [DONE] 也无非 null
            // finish_reason（如 muse-spark 只回 finish_reason:null + usage/cost 的上游），则手动补
            // 一个标准终止 chunk，否则严格客户端会报 "Model stream ended without a finish reason"。
            // 幂等：hasStreamEnded 判定流已带结束标志时不补；chunks 为空（内容全被丢弃）也不补，
            // 避免把空流伪造成成功完成。
            if (!isResponseApi && chunks.length > 0 && !hasStreamEnded(chunks)) {
              const terminator = `data: ${JSON.stringify({
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              })}\n\n`;
              chunks.push(terminator);
              controller.enqueue(new TextEncoder().encode(terminator)); markTtft();
            }

            // response-api 转换分支：上游没有 chat 的 [DONE]，必须补发作为流的最后一条（cc-switch 实践）
            if (isResponseApi) {
              const doneLine = `data: [DONE]\n\n`;
              chunks.push(doneLine);
              controller.enqueue(new TextEncoder().encode(doneLine)); markTtft();
            }

            logEntry.durationMs = Date.now() - startTime;
            logEntry.tps = calcTps(logEntry.completionTokens, logEntry.durationMs, logEntry.ttftMs);
            detailLogger.logStreamResponse(requestId, chunks);
            detailLogger.logConvertedResponse(requestId, buildFullOpenAIResponse(chunks, { requestId, provider: provider.provider }));
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

            // Skip SSE comment lines (e.g., ": ping" keepalive) for all providers
            if (part.startsWith(':')) {
              continue;
            }

            if (isResponseApi) {
              const partBlock = `${part}\n\n`;
              for (const chatChunk of responsesUpstream!.transform(partBlock)) {
                for (const out of chatDownstream!.transform(chatChunk)) {
                  chunks.push(out);
                  try {
                    controller.enqueue(new TextEncoder().encode(out)); markTtft();
                  } catch (err) {
                    if (isSilentError(err)) return;
                    throw err;
                  }
                }
              }
            } else if (!plan.passthrough) {
              const openAIChunks = parseAndConvertAnthropicSSE(part, requestId, model, streamState!);
              for (const openAIChunk of openAIChunks) {
                chunks.push(openAIChunk);
                let sanitizedChunk = openAIChunk;
                if (options.privacySettings?.enabled && options.privacySettings.sanitizeFilePaths) {
                  sanitizedChunk = sanitizeSSEChunk(sanitizedChunk, options.requestId);
                }
                controller.enqueue(new TextEncoder().encode(sanitizedChunk)); markTtft();
              }
            } else {
              const dataLines = part.split('\n').filter((l) => l.startsWith('data:'));
              if (dataLines.length === 0) continue;
              for (let sseLine of dataLines) {
                if (!sseLine.endsWith('\n\n')) sseLine += '\n\n';
                chunks.push(sseLine);
                if (options.privacySettings?.enabled && options.privacySettings.sanitizeFilePaths) {
                  sseLine = sanitizeSSEChunk(sseLine, options.requestId);
                }
                try {
                  controller.enqueue(new TextEncoder().encode(sseLine)); markTtft();
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
