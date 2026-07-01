import type { ProviderConfig } from '../../config.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { Logger } from '../../logger.js';
import { createStreamConverterState, type StreamConverterState } from '../../converters/anthropic-to-openai.js';
import { parseSSEBlock, convertAnthropicStreamEventToOpenAI } from '../../converters/anthropic-to-openai.js';
import { createOpenAIToAnthropicStreamState, type OpenAIToAnthropicStreamState } from '../../converters/openai-to-anthropic.js';
import { parseAndConvertOpenAISSE } from '../utils/sse-handlers-messages.js';
import { sanitizeSSEChunk } from '../../privacy/sanitizer.js';
import { findFinalUsageFromChunks } from '../../lib/stream-usage.js';
import { buildFullOpenAIResponse } from '../utils/sse-handlers.js';
import type { RequestLogger } from '../../lib/request-logger.js';
import type { OutputFormat } from './non-stream-handler.js';

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
  outputFormat: OutputFormat;
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
  const { response, provider, model, actualModel, requestId, logEntry, rateLimiter, logger, detailLogger, c, requestLogger, currentUser, outputFormat } = options;

  if (!response.body) {
    return c.json({ error: { message: 'No response body' } }, 500);
  }

  const providerFormat = provider.provider;

  // Initialize stream conversion state based on conversion direction
  const needsAnthropicToOpenAI = providerFormat === 'anthropic' && outputFormat === 'openai';
  const needsOpenAIToAnthropic = providerFormat === 'openai' && outputFormat === 'anthropic';

  const anthropicToOpenAIState: StreamConverterState | undefined =
    needsAnthropicToOpenAI ? createStreamConverterState() : undefined;

  const openAIToAnthropicState: OpenAIToAnthropicStreamState | undefined =
    needsOpenAIToAnthropic ? createOpenAIToAnthropicStreamState() : undefined;

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

            // Handle remaining buffer data for OpenAI→Anthropic conversion
            if (needsOpenAIToAnthropic && buffer.trim()) {
              const part = buffer.trim();
              const anthropicChunks = parseAndConvertOpenAISSE(part, openAIToAnthropicState!, { requestId, provider: provider.provider });
              for (const anthropicChunk of anthropicChunks) {
                chunks.push(anthropicChunk);
                controller.enqueue(new TextEncoder().encode(anthropicChunk));
              }
            }

            detailLogger.logStreamResponse(requestId + '_raw', rawChunks);

            // Extract usage using unified function
            const streamUsage = findFinalUsageFromChunks(chunks, outputFormat, { requestId, provider: provider.provider });
            if (streamUsage) {
              logEntry.promptTokens = streamUsage.promptTokens;
              logEntry.completionTokens = streamUsage.completionTokens;
              logEntry.totalTokens = streamUsage.totalTokens;
              if (streamUsage.cachedTokens) {
                logEntry.cachedTokens = streamUsage.cachedTokens;
              }
            }

            // For OpenAI output, append final usage chunk
            if (outputFormat === 'openai') {
              const finalUsage = streamUsage
                ? {
                    prompt_tokens: streamUsage.promptTokens,
                    completion_tokens: streamUsage.completionTokens,
                    total_tokens: streamUsage.totalTokens,
                  }
                : null;
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
            }

            detailLogger.logStreamResponse(requestId, chunks);
            if (outputFormat === 'openai') {
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
                errorMessage: logEntry.error?.message,
                errorType: logEntry.error?.type,
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

            // Skip SSE comment lines (e.g., ": ping" keepalive)
            if (part.startsWith(':')) {
              continue;
            }

            // Direction 1: Anthropic upstream → OpenAI output
            if (needsAnthropicToOpenAI) {
              const openAIChunks = parseSSEBlock(part);
              for (const parsed of openAIChunks) {
                const openAIChunk = convertAnthropicStreamEventToOpenAI(parsed.data, requestId, model, anthropicToOpenAIState!);
                if (openAIChunk) {
                  let sseLine = `data: ${JSON.stringify(openAIChunk)}\n\n`;
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
            // Direction 2: OpenAI upstream → Anthropic output
            else if (needsOpenAIToAnthropic) {
              const anthropicChunks = parseAndConvertOpenAISSE(part, openAIToAnthropicState!, { requestId, provider: provider.provider });
              for (const anthropicChunk of anthropicChunks) {
                chunks.push(anthropicChunk);
                let chunk = anthropicChunk;
                if (options.privacySettings?.enabled && options.privacySettings.sanitizeFilePaths) {
                  chunk = sanitizeSSEChunk(chunk, options.requestId);
                }
                controller.enqueue(new TextEncoder().encode(chunk));
              }
            }
            // No conversion needed: pass through
            else {
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
