/**
 * SSE 处理工具 - Messages (Anthropic → OpenAI → Anthropic)
 */

import {
  convertOpenAIStreamChunkToAnthropic,
  formatAnthropicEventToSSE,
  parseOpenAISSEData,
  type OpenAIToAnthropicStreamState
} from '../../converters/openai-to-anthropic.js';

/**
 * 解析 OpenAI SSE 块并转换为 Anthropic 格式
 */
export function parseAndConvertOpenAISSE(
  sseBlock: string,
  state: OpenAIToAnthropicStreamState
): string[] {
  const anthropicChunks: string[] = [];
  const lines = sseBlock.split('\n');

  for (const line of lines) {
    const parsed = parseOpenAISSEData(line);
    if (!parsed?.data) continue;

    // 将 OpenAI chunk 转换为 Anthropic 事件
    const anthropicEvents = convertOpenAIStreamChunkToAnthropic(parsed.data, state);

    for (const event of anthropicEvents) {
      anthropicChunks.push(formatAnthropicEventToSSE(event));
    }
  }

  return anthropicChunks;
}