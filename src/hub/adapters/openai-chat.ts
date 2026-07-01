import type { FormatAdapter } from './adapter.interface.js';
import { extractUsageFromOpenAIChunk } from '../../lib/stream-usage.js';

/**
 * OpenAI Chat Completions format adapter.
 *
 * For the /v1/chat/completions endpoint targeting OpenAI providers,
 * this adapter acts as a passthrough — the hub format IS the Chat
 * Completions format, so no conversion is needed.
 */
export const openAIChatAdapter: FormatAdapter = {
  formatName: 'openai-chat',

  isNativeProvider(providerType: string): boolean {
    return providerType === 'openai';
  },

  async toHubRequest(body: any): Promise<any> {
    return JSON.parse(JSON.stringify(body));
  },

  fromHubResponse(body: any, _model: string): any {
    return body;
  },

  toStreamHubRequest(body: any): any {
    if (body.stream) {
      return { ...body, stream_options: { include_usage: true } };
    }
    return body;
  },

  fromStreamHubResponse(sseChunk: string, _state?: any): string[] {
    return [sseChunk];
  },

  extractStreamUsage(chunks: string[]): ReturnType<FormatAdapter['extractStreamUsage']> {
    for (let i = chunks.length - 1; i >= 0; i--) {
      try {
        const chunkText = chunks[i];
        const lines = chunkText.split('\n');
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const jsonStr = line.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            const parsed = JSON.parse(jsonStr);
            const usage = extractUsageFromOpenAIChunk(parsed);
            if (usage) return usage;
          }
        }
      } catch {
        // skip parse errors
      }
    }
    return null;
  },
};
