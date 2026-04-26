/**
 * SSE 处理工具 - Chat Completions (OpenAI → Anthropic → OpenAI)
 */

import {
  parseSSEBlock,
  convertAnthropicStreamEventToOpenAI,
  type StreamConverterState
} from '../../converters/anthropic-to-openai.js';

/**
 * 从 SSE chunks 构建完整的 OpenAI 响应
 */
export function buildFullOpenAIResponse(chunks: string[]): any {
  const choices: any[] = [];
  let usage: any = null;
  let model = '';
  let id = '';
  let created = 0;

  for (const chunk of chunks) {
    if (!chunk.startsWith('data:') || chunk === 'data: [DONE]') continue;
    const data = chunk.slice(5).trim();
    if (!data || data === '[DONE]') continue;

    try {
      const json = JSON.parse(data);
      id = json.id || id;
      model = json.model || model;
      created = json.created || created;

      if (json.choices) {
        for (const choice of json.choices) {
          if (!choices[choice.index]) {
            choices[choice.index] = { index: choice.index, message: { role: '', content: '', reasoning_content: '' }, finish_reason: '' };
          }
          if (choice.delta?.content) {
            choices[choice.index].message.content += choice.delta.content;
          }
          if (choice.delta?.reasoning_content) {
            choices[choice.index].message.reasoning_content += choice.delta.reasoning_content;
          }
          if (choice.delta?.reasoning) {
            choices[choice.index].message.reasoning_content += choice.delta.reasoning;
          }
          if (choice.delta?.role) {
            choices[choice.index].message.role = choice.delta.role;
          }
          if (choice.delta?.tool_calls) {
            if (!choices[choice.index].message.tool_calls) {
              choices[choice.index].message.tool_calls = [];
            }
            for (const tc of choice.delta.tool_calls) {
              if (tc.index !== undefined) {
                if (!choices[choice.index].message.tool_calls[tc.index]) {
                  choices[choice.index].message.tool_calls[tc.index] = {
                    id: tc.id || '',
                    type: tc.type || 'function',
                    function: { name: '', arguments: '' }
                  };
                }
                const existing = choices[choice.index].message.tool_calls[tc.index];
                if (tc.id) existing.id = tc.id;
                if (tc.type) existing.type = tc.type;
                if (tc.function?.name) existing.function.name += tc.function.name;
                if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
              }
            }
          }
          if (choice.finish_reason) {
            choices[choice.index].finish_reason = choice.finish_reason;
          }
        }
      }

      if (json.usage) {
        usage = json.usage;
      }
    } catch {
      // 忽略解析错误
    }
  }

  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: choices.filter(Boolean),
    usage
  };
}

/**
 * 解析 Anthropic SSE 块并转换为 OpenAI 格式
 */
export function parseAndConvertAnthropicSSE(
  sseBlock: string,
  requestId: string,
  model: string,
  state: StreamConverterState
): string[] {
  const openAIChunks: string[] = [];
  const events = parseSSEBlock(sseBlock);

  for (const { event, data } of events) {
    if (!data) continue;

    // 将 Anthropic 事件转换为 OpenAI chunk
    const openAIChunk = convertAnthropicStreamEventToOpenAI(data, requestId, model, state);

    if (openAIChunk) {
      openAIChunks.push(`data: ${JSON.stringify(openAIChunk)}\n\n`);
    }
  }

  return openAIChunks;
}