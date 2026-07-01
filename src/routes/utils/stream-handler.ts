import type { ProviderConfig } from '../../config.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { Logger } from '../../logger.js';
import type { FormatAdapter } from '../../hub/adapters/adapter.interface.js';
import { buildFullOpenAIResponse } from './sse-handlers.js';
import { sanitizeSSEChunk } from '../../privacy/sanitizer.js';
import { findFinalUsageFromChunks } from '../../lib/stream-usage.js';
import { RequestLogger } from '../../lib/request-logger.js';

export interface UnifiedStreamOptions {
  response: Response;
  provider: ProviderConfig;
  adapter: FormatAdapter;
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

/**
 * Unified stream handler that works with any format adapter.
 *
 * - Native provider: SSE chunks pass through unchanged
 * - Non-native provider: SSE chunks are converted via adapter.fromStreamHubResponse()
 *
 * Usage extraction and logging is format-aware via adapter.extractStreamUsage().
 */
export function handleUnifiedStream(options: UnifiedStreamOptions): Response {
  const {
    response, provider, adapter, model, actualModel,
    requestId, logEntry, rateLimiter, logger, detailLogger,
    c, privacySettings, requestLogger, currentUser,
  } = options;

  if (!response.body) {
    return c.json({ error: { message: 'No response body' } }, 500);
  }

  const isNative = adapter.isNativeProvider(provider.provider);

  // Create streaming state for non-native providers (needed for content block tracking)
  const streamState = !isNative && adapter.createStreamState
    ? adapter.createStreamState()
    : undefined;

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
            // Handle remaining buffer (OpenRouter may not end with \n\n)
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
                controller.enqueue(new TextEncoder().encode(sseLine));
              } catch (err) {
                if (!isSilentError(err)) throw err;
              }
            }

            detailLogger.logStreamResponse(requestId + '_raw', rawChunks);

            // Extract usage using format-aware adapter
            const streamUsage = isNative
              ? findFinalUsageFromChunks(chunks, 'openai', { requestId, provider: provider.provider })
              : adapter.extractStreamUsage(chunks);

            if (streamUsage) {
              logEntry.promptTokens = streamUsage.promptTokens;
              logEntry.completionTokens = streamUsage.completionTokens;
              logEntry.totalTokens = streamUsage.totalTokens;
              if (streamUsage.cachedTokens) {
                logEntry.cachedTokens = streamUsage.cachedTokens;
              }
            }

            // For native OpenAI: append final usage chunk
            if (isNative && streamUsage) {
              const finalChunk = `data: ${JSON.stringify({
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: {}, finish_reason: null }],
                usage: {
                  prompt_tokens: streamUsage.promptTokens,
                  completion_tokens: streamUsage.completionTokens,
                  total_tokens: streamUsage.totalTokens,
                },
              })}\n\n`;
              controller.enqueue(new TextEncoder().encode(finalChunk));
            }

            detailLogger.logStreamResponse(requestId, chunks);

            // Build full response for logging (native format only)
            if (isNative) {
              detailLogger.logConvertedResponse(requestId, buildFullOpenAIResponse(chunks, { requestId, provider: provider.provider }));
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
                promptTokens: logEntry.promptTokens,
                completionTokens: logEntry.completionTokens,
                totalTokens: logEntry.totalTokens,
                cachedTokens: logEntry.cachedTokens,
                modelGroup: logEntry.modelGroup,
                actualModel: logEntry.actualModel,
                responseMetadata: logEntry.responseMetadata,
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

          const chunk = decoder.decode(value, { stream: false });
          rawChunks.push(chunk);
          buffer += chunk;

          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            if (!part.trim()) continue;

            // Skip SSE comment lines (keepalive pings)
            if (part.startsWith(':')) {
              continue;
            }

            if (isNative) {
              // Native provider: passthrough with optional privacy sanitization
              let sseLine = part;
              if (!sseLine.startsWith('data:')) {
                sseLine = `data: ${sseLine}`;
              }
              if (!sseLine.endsWith('\n\n')) {
                sseLine += '\n\n';
              }
              chunks.push(sseLine);
              let sanitized = sseLine;
              if (privacySettings?.enabled && privacySettings.sanitizeFilePaths) {
                sanitized = sanitizeSSEChunk(sanitized, requestId);
              }
              try {
                controller.enqueue(new TextEncoder().encode(sanitized));
              } catch (err) {
                if (isSilentError(err)) return;
                throw err;
              }
            } else {
              // Non-native provider: convert via adapter
              const convertedChunks = adapter.fromStreamHubResponse(part, streamState);
              for (const convertedChunk of convertedChunks) {
                chunks.push(convertedChunk);
                let sanitized = convertedChunk;
                if (privacySettings?.enabled && privacySettings.sanitizeFilePaths) {
                  sanitized = sanitizeSSEChunk(sanitized, requestId);
                }
                controller.enqueue(new TextEncoder().encode(sanitized));
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

  return c.body(transformedStream);
}
