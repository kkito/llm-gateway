/**
 * SSE 处理工具 - Messages (Anthropic → OpenAI → Anthropic)
 */

import {
  convertOpenAIStreamChunkToAnthropic,
  formatAnthropicEventToSSE,
  type OpenAIToAnthropicStreamState
} from '../../converters/openai-to-anthropic.js';

/**
 * 解析 OpenAI SSE 数据行
 * OpenAI SSE 格式：data: {"id":"...","choices":[...]}\n\n
 */
function parseOpenAISSELine(line: string): any | null {
  const trimmedLine = line.trim();
  
  // 跳过空行和 event 行
  if (!trimmedLine || trimmedLine.startsWith('event:')) {
    return null;
  }

  // 处理 data 行
  if (!trimmedLine.startsWith('data:')) {
    return null;
  }

  const data = trimmedLine.slice(5).trim();
  if (!data || data === '[DONE]') {
    return null;
  }

  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * 解析 OpenAI SSE 块并转换为 Anthropic 格式
 *
 * OpenAI SSE 格式示例：
 * data: {"id":"chatcmpl-xxx","choices":[{"delta":{"role":"assistant"},"index":0}]}
 *
 * data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"Hello"},"index":0}]}
 *
 * 注意：传入的 sseBlock 已经是按 \n\n 分割后的单个块
 * 但某些情况下，一个块内可能包含多行 data:（虽然少见）
 */
export function parseAndConvertOpenAISSE(
  sseBlock: string,
  state: OpenAIToAnthropicStreamState
): string[] {
  const anthropicChunks: string[] = [];

  // 按行分割，处理每一行 data:
  const lines = sseBlock.split('\n');
  let parsedDataCount = 0;
  let emptyChoicesCount = 0;

  for (const line of lines) {
    const parsedData = parseOpenAISSELine(line);
    if (!parsedData) continue;

    parsedDataCount++;

    // 检查是否是只有 usage 的 chunk（choices 为空）
    if (!parsedData.choices || parsedData.choices.length === 0) {
      // 这是正常的，通常出现在流结束时携带 usage 信息
      emptyChoicesCount++;
      continue;
    }

    // 将 OpenAI chunk 转换为 Anthropic 事件
    const anthropicEvents = convertOpenAIStreamChunkToAnthropic(parsedData, state);

    for (const event of anthropicEvents) {
      const sseLine = formatAnthropicEventToSSE(event);
      anthropicChunks.push(sseLine);
    }
  }

  // 只在有数据但无法解析时记录警告（空 choices 是正常的）
  if (parsedDataCount > 0 && emptyChoicesCount === parsedDataCount && sseBlock.trim()) {
    // 所有 chunk 都只有 usage，没有 choices，这是正常的
  } else if (parsedDataCount === 0 && sseBlock.trim() && !sseBlock.includes('[DONE]')) {
    // 只有非 [DONE] 的情况下才记录警告
    console.log(`   ⚠️  [SSE 解析] 未能从 SSE 块中解析出任何 data 行`);
    console.log(`      SSE 块内容：${sseBlock.substring(0, 300)}${sseBlock.length > 300 ? '...' : ''}`);
  }

  return anthropicChunks;
}