import type { ProviderConfig } from '../../config.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { Logger } from '../../logger.js';
import { createStreamConverterState, type StreamConverterState } from '../../converters/anthropic-to-openai.js';
import { buildFullOpenAIResponse, parseAndConvertAnthropicSSE } from '../utils/sse-handlers.js';
import { sanitizeSSEChunk, restorePaths } from '../../privacy/sanitizer.js';

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

  const transformedStream = new ReadableStream({
    async start(controller) {
      try {
        let buffer = '';
        let finalUsage: any = null;

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
              chunks.push(sseLine);
              try {
                controller.enqueue(new TextEncoder().encode(sseLine));
              } catch (err) {
                if (!isSilentError(err)) throw err;
              }
            }

            detailLogger.logStreamResponse(requestId + '_raw', rawChunks);

            // Extract usage from chunks (reverse order to find the last valid usage)
            for (let i = chunks.length - 1; i >= 0; i--) {
              try {
                const chunkJson = JSON.parse(chunks[i].slice(5).trim());
                if (chunkJson.usage?.prompt_tokens_details?.cached_tokens) {
                  logEntry.cachedTokens = chunkJson.usage.prompt_tokens_details.cached_tokens;
                  finalUsage = chunkJson.usage;
                  break;
                }
                if (chunkJson.usage?.cache_read_input_tokens) {
                  logEntry.cachedTokens = chunkJson.usage.cache_read_input_tokens;
                  finalUsage = chunkJson.usage;
                  break;
                }
                if (chunkJson.usage && !finalUsage) {
                  finalUsage = chunkJson.usage;
                }
              } catch {
                // ignore parse errors
              }
            }

            if (finalUsage) {
              logEntry.promptTokens = finalUsage.prompt_tokens || finalUsage.input_tokens;
              logEntry.completionTokens = finalUsage.completion_tokens || finalUsage.output_tokens;
              logEntry.totalTokens = finalUsage.total_tokens || (logEntry.promptTokens + logEntry.completionTokens);
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
              controller.enqueue(new TextEncoder().encode(finalChunk));
            }

            const fullResponse = buildFullOpenAIResponse(chunks);
            // Restore paths in stream response before logging and rate limiting
            if (privacySettings?.enabled && privacySettings.sanitizeFilePaths) {
              restorePaths(fullResponse, requestId);
            }
            detailLogger.logStreamResponse(requestId, chunks);
            detailLogger.logConvertedResponse(requestId, fullResponse);
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
                chunks.push(openAIChunk);
                let sanitizedChunk = openAIChunk;
                if (options.privacySettings?.enabled && options.privacySettings.sanitizeFilePaths) {
                  sanitizedChunk = sanitizeSSEChunk(sanitizedChunk, options.requestId);
                }
                controller.enqueue(new TextEncoder().encode(sanitizedChunk));
              }
            } else {
              let sseLine = part;
              if (!sseLine.startsWith('data:')) {
                sseLine = `data: ${sseLine}`;
              }
              if (!sseLine.endsWith('\n\n')) {
                sseLine += '\n\n';
              }
              chunks.push(sseLine);
              if (options.privacySettings?.enabled && options.privacySettings.sanitizeFilePaths) {
                sseLine = sanitizeSSEChunk(sseLine, options.requestId);
              }
              try {
                controller.enqueue(new TextEncoder().encode(sseLine));
              } catch (err) {
                if (isSilentError(err)) return;
                throw err;
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
