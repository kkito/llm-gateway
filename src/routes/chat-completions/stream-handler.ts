import type { ProviderConfig } from '../../config.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { Logger } from '../../logger.js';
import { createStreamConverterState, type StreamConverterState } from '../../converters/anthropic-to-openai.js';
import { buildFullOpenAIResponse, parseAndConvertAnthropicSSE } from '../utils/sse-handlers.js';
import { applyPathMappings, restorePaths } from '../../privacy/sanitizer.js';

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
}

function isSilentError(err: any): boolean {
  return (
    err?.name === 'AbortError' ||
    err?.code === 'ERR_INVALID_STATE' ||
    err?.message?.includes('Controller is already closed')
  );
}

export function handleStream(options: StreamHandlerOptions): Response {
  const { response, provider, model, actualModel, requestId, startTime, logEntry, rateLimiter, logger, detailLogger, c, privacySettings } = options;

  if (!response.body) {
    return c.json({ error: { message: 'No response body' } }, 500);
  }

  const providerFormat = provider.provider;
  const streamState: StreamConverterState | undefined =
    providerFormat === 'anthropic' ? createStreamConverterState() : undefined;

  const chunks: string[] = [];
  const rawChunks: string[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const privacyOn = privacySettings?.enabled && privacySettings.sanitizeFilePaths;
  const privacyBuffer: string[] = [];

  console.log(`   🔒 [隐私模式] privacyOn=${privacyOn}, privacySettings=${JSON.stringify(privacySettings || {})}`);

  const transformedStream = new ReadableStream({
    async start(controller) {
      try {
        let buffer = '';
        let finalUsage: any = null;

        const tryExtractUsage = (sseLine: string) => {
          try {
            const chunkJson = JSON.parse(sseLine.slice(5).trim());
            if (chunkJson.usage?.prompt_tokens_details?.cached_tokens) {
              logEntry.cachedTokens = chunkJson.usage.prompt_tokens_details.cached_tokens;
              finalUsage = chunkJson.usage;
            }
            if (chunkJson.usage?.cache_read_input_tokens) {
              logEntry.cachedTokens = chunkJson.usage.cache_read_input_tokens;
              finalUsage = chunkJson.usage;
            }
            if (chunkJson.usage && !finalUsage) {
              finalUsage = chunkJson.usage;
            }
          } catch {
            // ignore parse errors
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // OpenRouter: last chunk may not end with \n\n
            if (provider.baseUrl?.includes('openrouter') && buffer.trim()) {
              let sseLine = buffer;
              if (!sseLine.startsWith('data:')) {
                sseLine = `data: ${sseLine}`;
              }
              if (!sseLine.endsWith('\n\n')) {
                sseLine += '\n\n';
              }
              if (privacyOn) {
                tryExtractUsage(sseLine);
                privacyBuffer.push(sseLine);
              } else {
                chunks.push(sseLine);
                try {
                  controller.enqueue(new TextEncoder().encode(sseLine));
                } catch (err) {
                  if (isSilentError(err)) { /* ignore */ } else { throw err; }
                }
              }
            }

            detailLogger.logStreamResponse(requestId + '_raw', rawChunks);

            if (finalUsage) {
              logEntry.promptTokens = finalUsage.prompt_tokens || finalUsage.input_tokens;
              logEntry.completionTokens = finalUsage.completion_tokens || finalUsage.output_tokens;
              logEntry.totalTokens = finalUsage.total_tokens || (logEntry.promptTokens + logEntry.completionTokens);
            }

            // Privacy mode: flush remaining buffer and collect for logging
            if (privacyOn && privacyBuffer.length > 0) {
              const originalLengths = privacyBuffer.map(c => c.length);
              const combined = privacyBuffer.join('');
              const restored = applyPathMappings(combined, requestId);
              const split = splitByOriginalLengths(restored, originalLengths);

              for (const chunk of split) {
                chunks.push(chunk);
                try {
                  controller.enqueue(new TextEncoder().encode(chunk));
                } catch (err) {
                  if (isSilentError(err)) return;
                  throw err;
                }
              }
            }

            // Logging: always record stream response, privacy mode only does path restoration
            const fullResponse = buildFullOpenAIResponse(chunks);
            if (privacyOn) {
              restorePaths(fullResponse, requestId);
            }
            detailLogger.logStreamResponse(requestId, chunks);
            detailLogger.logConvertedResponse(requestId, fullResponse);

            if (finalUsage) {
              const finalChunk = `data: ${JSON.stringify({
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: {}, finish_reason: null }],
                usage: finalUsage,
              })}\n\n`;
              controller.enqueue(new TextEncoder().encode(finalChunk));
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

            // Skip OpenRouter comment lines
            if (provider.baseUrl?.includes('openrouter') && part.startsWith(':')) {
              continue;
            }

            if (providerFormat === 'anthropic') {
              const openAIChunks = parseAndConvertAnthropicSSE(part, requestId, model, streamState!);
              for (const openAIChunk of openAIChunks) {
                tryExtractUsage(openAIChunk);
                if (!privacyOn) {
                  chunks.push(openAIChunk);
                  try {
                    controller.enqueue(new TextEncoder().encode(openAIChunk));
                  } catch (err) {
                    if (!isSilentError(err)) throw err;
                  }
                } else {
                  privacyBuffer.push(openAIChunk);
                  while (privacyBuffer.length >= 3) {
                    flushPrivacyWindow(privacyBuffer, requestId, controller, chunks);
                  }
                }
              }
            } else {
              let sseLine = part;
              if (!sseLine.startsWith('data:')) {
                sseLine = `data: ${sseLine}`;
              }
              if (!sseLine.endsWith('\n\n')) {
                sseLine += '\n\n';
              }
              tryExtractUsage(sseLine);
              if (!privacyOn) {
                chunks.push(sseLine);
                try {
                  controller.enqueue(new TextEncoder().encode(sseLine));
                } catch (err) {
                  if (isSilentError(err)) return;
                  throw err;
                }
              } else {
                privacyBuffer.push(sseLine);
                while (privacyBuffer.length >= 3) {
                  flushPrivacyWindow(privacyBuffer, requestId, controller, chunks);
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

  return c.body(transformedStream);
}

/**
 * Flush the first 3 chunks from the privacy buffer as a sliding window.
 * Joins them, applies path mappings, splits proportionally, sends the first.
 */
function flushPrivacyWindow(
  buffer: string[],
  requestId: string,
  controller: ReadableStreamDefaultController,
  chunks: string[]
): void {
  if (buffer.length < 3) return;

  const windowChunks = buffer.slice(0, 3);
  const originalLengths = windowChunks.map(c => c.length);

  const combined = windowChunks.join('');
  const restored = applyPathMappings(combined, requestId);
  const split = splitByOriginalLengths(restored, originalLengths);

  // Add to chunks for logging
  chunks.push(split[0]);

  // Send the oldest chunk
  try {
    controller.enqueue(new TextEncoder().encode(split[0]));
  } catch (err) {
    if (isSilentError(err)) return;
    throw err;
  }

  // Replace the first 3 buffer entries with the remaining 2 restored chunks
  buffer.splice(0, 3, split[1], split[2]);
}

/**
 * Split a restored string proportionally based on original chunk lengths.
 * The last chunk takes all remaining characters to avoid rounding loss.
 */
function splitByOriginalLengths(restored: string, originalLengths: number[]): string[] {
  const totalLen = originalLengths.reduce((a, b) => a + b, 0);
  const result: string[] = [];
  let offset = 0;

  for (let i = 0; i < originalLengths.length; i++) {
    const ratio = originalLengths[i] / totalLen;
    const chunkLen = Math.round(restored.length * ratio);
    const actualLen = i === originalLengths.length - 1
      ? restored.length - offset
      : chunkLen;
    result.push(restored.slice(offset, offset + actualLen));
    offset += actualLen;
  }

  return result;
}
