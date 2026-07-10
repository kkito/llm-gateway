// src/converters/formats/responses/response.ts
import type { ChatResponse, ChatMessage, ChatToolCall } from '../../canonical/types.js';

/** Responses 响应 -> canonical chat 响应 */
export function responsesToChatResponse(body: any): ChatResponse {
  const outputs = Array.isArray(body.output) ? body.output : [];
  let content = '';
  const toolCalls: ChatToolCall[] = [];

  for (const item of outputs) {
    if (item.type === 'message') {
      const parts = Array.isArray(item.content) ? item.content : [];
      for (const p of parts) {
        if (p.type === 'output_text' || p.type === 'text') content += (p.text ?? '');
        if (p.type === 'refusal') content += (p.text ?? '');
      }
    } else if (item.type === 'function_call') {
      toolCalls.push({
        id: item.call_id || '',
        type: 'function',
        function: { name: item.name || '', arguments: item.arguments || '{}' },
      });
    }
  }

  let finishReason: string | null = 'stop';
  if (toolCalls.length > 0) finishReason = 'tool_calls';
  else if (body.status === 'incomplete') finishReason = 'length';

  const usage = body.usage
    ? { prompt_tokens: body.usage.input_tokens ?? 0, completion_tokens: body.usage.output_tokens ?? 0, total_tokens: (body.usage.input_tokens ?? 0) + (body.usage.output_tokens ?? 0) }
    : undefined;

  const message: any = { role: 'assistant', content: content || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  const resp: ChatResponse = {
    id: body.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage,
  };
  if (body.encrypted_content) (resp as any).responsesEncryptedContent = body.encrypted_content;
  return resp;
}

/** canonical chat 响应 -> Responses 响应 */
export function chatToResponsesResponse(chat: ChatResponse): any {
  const choice = chat.choices?.[0];
  const msg = choice?.message;
  const output: any[] = [];

  if (msg?.tool_calls?.length) {
    for (const tc of msg.tool_calls) {
      output.push({ type: 'function_call', call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
    }
  } else {
    output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: msg?.content ?? '' }] });
  }

  const result: any = {
    id: chat.id,
    model: chat.model,
    status: choice?.finish_reason === 'tool_calls' ? 'completed' : 'completed',
    output,
  };
  if (chat.usage) result.usage = { input_tokens: chat.usage.prompt_tokens, output_tokens: chat.usage.completion_tokens };
  if ((chat as any).responsesEncryptedContent) result.encrypted_content = (chat as any).responsesEncryptedContent;
  return result;
}
