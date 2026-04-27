import type { ProviderConfig } from '../../config.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { Logger } from '../../logger.js';
import { createOpenAIToAnthropicStreamState, type OpenAIToAnthropicStreamState } from '../../converters/openai-to-anthropic.js';
import { parseAndConvertOpenAISSE } from '../utils/sse-handlers-messages.js';
import { sanitizeSSEChunk } from '../../privacy/sanitizer.js';
import { findFinalUsageFromChunks } from '../../lib/stream-usage.js';

export interface StreamHandlerOptions {
  response: Response;
  provider: ProviderConfig;
  model: string;
  actualModel: string;
  requestId: string;
  logEntry: any;
  rateLimiter: RateLimiter;
  logger: Logger;
  detailLogger: DetailLogger;
  c: any;
  privacySettings?: any;
}

function isSilentError(err: any): boolean {
  return (
    err?.name === 'AbortError' ||
    err?.code === 'ERR_INVALID_STATE' ||
    err?.message?.includes('Controller is already closed')
  );
}

export function handleStream(options: StreamHandlerOptions): Response {
  const { response, provider, model, actualModel, requestId, logEntry, rateLimiter, logger, detailLogger, c } = options;

  if (!response.body) {
    return c.json({ error: { message: 'No response body' } }, 500);
  }

  const providerFormat = provider.provider;
  const streamState: OpenAIToAnthropicStreamState | undefined =
    providerFormat === 'openai' ? createOpenAIToAnthropicStreamState() : undefined;

  const chunks: string[] = [];
  const rawChunks: string[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const transformedStream = new ReadableStream({
    async start(controller) {
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
              if (providerFormat === 'openai') {
                const anthropicChunks = parseAndConvertOpenAISSE(part, streamState!);
                for (const anthropicChunk of anthropicChunks) {
                  chunks.push(anthropicChunk);
                  controller.enqueue(new TextEncoder().encode(anthropicChunk));
                  convertedEventCounter += anthropicChunks.length;
                }
              } else {
                const sseLine = part + '\n\n';
                chunks.push(sseLine);
                controller.enqueue(new TextEncoder().encode(sseLine));
              }
            }

            detailLogger.logStreamResponse(requestId + '_raw', rawChunks);

            // Extract usage using unified function (output is always Anthropic format)
            const streamUsage = findFinalUsageFromChunks(chunks, 'anthropic');
            if (streamUsage) {
              logEntry.promptTokens = streamUsage.promptTokens;
              logEntry.completionTokens = streamUsage.completionTokens;
              logEntry.totalTokens = streamUsage.totalTokens;
              if (streamUsage.cachedTokens) {
                logEntry.cachedTokens = streamUsage.cachedTokens;
              }
            }

            detailLogger.logStreamResponse(requestId, chunks);
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

          const chunk = decoder.decode(value, { stream: false });
          rawChunks.push(chunk);
          buffer += chunk;

          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            if (!part.trim()) continue;

            eventCounter++;

            if (providerFormat === 'openai') {
              // OpenAI → Anthropic 流式转换
              const anthropicChunks = parseAndConvertOpenAISSE(part, streamState!);
              for (const anthropicChunk of anthropicChunks) {
                chunks.push(anthropicChunk);
                let chunk = anthropicChunk;
                if (options.privacySettings?.enabled && options.privacySettings.sanitizeFilePaths) {
                  chunk = sanitizeSSEChunk(chunk, options.requestId);
                }
                controller.enqueue(new TextEncoder().encode(chunk));
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
                controller.enqueue(new TextEncoder().encode(chunk));
              } catch (err) {
                if (isSilentError(err)) return;
                throw err;
              }
            }
          }
        }

        detailLogger.logStreamResponse(requestId + '_stats', [{ event: 'sse_stats', rawEvents: eventCounter, convertedEvents: convertedEventCounter }]);
      } catch (error) {
        try {
          controller.error(error);
        } catch {
          // controller already closed
        }
      }
    },
  });

  return c.body(transformedStream);
}
