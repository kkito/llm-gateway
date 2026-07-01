import type { FormatAdapter } from './adapter.interface.js';
import {
  convertAnthropicRequestToOpenAI,
  convertOpenAIResponseToAnthropic,
} from '../../converters/anthropic-to-openai.js';
import {
  convertOpenAIStreamChunkToAnthropic,
  formatAnthropicEventToSSE,
  parseOpenAISSEData,
  createOpenAIToAnthropicStreamState,
  type OpenAIToAnthropicStreamState,
} from '../../converters/openai-to-anthropic.js';
import { extractUsageFromAnthropicChunk } from '../../lib/stream-usage.js';

/**
 * Anthropic Messages format adapter.
 *
 * Converts between Anthropic Messages format (client-facing) and
 * OpenAI Chat Completions (hub/internal).
 */
export const anthropicMessagesAdapter: FormatAdapter = {
  formatName: 'anthropic-messages',

  isNativeProvider(providerType: string): boolean {
    return providerType === 'anthropic';
  },

  async toHubRequest(body: any): Promise<any> {
    return await convertAnthropicRequestToOpenAI(body);
  },

  fromHubResponse(body: any, model: string): any {
    return convertOpenAIResponseToAnthropic(body, model);
  },

  toStreamHubRequest(body: any): any {
    return body;
  },

  fromStreamHubResponse(
    sseChunk: string,
    state?: OpenAIToAnthropicStreamState
  ): string[] {
    if (!state) {
      state = createOpenAIToAnthropicStreamState();
    }

    const events: string[] = [];
    const lines = sseChunk.split('\n');

    for (const line of lines) {
      const parsed = parseOpenAISSEData(line);
      if (!parsed?.data) continue;

      const anthropicEvents = convertOpenAIStreamChunkToAnthropic(parsed.data, state);
      for (const event of anthropicEvents) {
        events.push(formatAnthropicEventToSSE(event));
      }
    }

    return events;
  },

  extractStreamUsage(chunks: string[]): ReturnType<FormatAdapter['extractStreamUsage']> {
    for (let i = chunks.length - 1; i >= 0; i--) {
      try {
        const chunkText = chunks[i];
        const lines = chunkText.split('\n');
        for (const line of lines) {
          if (line.startsWith('event:')) continue;
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;
          const parsed = JSON.parse(jsonStr);
          const usage = extractUsageFromAnthropicChunk(parsed);
          if (usage) return usage;
        }
      } catch {
        // skip parse errors
      }
    }
    return null;
  },

  createStreamState(): OpenAIToAnthropicStreamState {
    return createOpenAIToAnthropicStreamState();
  },
};
