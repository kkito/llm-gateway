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

/** chat id（chatcmpl_xxx / 任意）规范化为 Responses 的 resp_ 前缀 */
function toResponseId(id: string | undefined): string {
  if (!id) return `resp_${Date.now()}`;
  if (id.startsWith('resp_')) return id;
  if (id.startsWith('chatcmpl_')) return `resp_${id.slice('chatcmpl_'.length)}`;
  return `resp_${id}`;
}

/** canonical chat 响应 -> Responses 响应 */
export function chatToResponsesResponse(chat: ChatResponse): any {
  const choice = chat.choices?.[0];
  const msg = choice?.message;
  const output: any[] = [];

  if (msg?.reasoning) {
    output.push({ id: `rs_${toResponseId(chat.id)}`, type: 'reasoning', summary: [{ type: 'summary_text', text: msg.reasoning }] });
  }

  if (msg?.tool_calls?.length) {
    for (const tc of msg.tool_calls) {
      output.push({ type: 'function_call', call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments, status: 'completed' });
    }
  } else {
    output.push({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: msg?.content ?? '' }] });
  }

  const incomplete = choice?.finish_reason === 'length';
  const result: any = {
    id: toResponseId(chat.id),
    object: 'response',
    created_at: chat.created ?? Math.floor(Date.now() / 1000),
    status: incomplete ? 'incomplete' : 'completed',
    error: null,
    incomplete_details: incomplete ? { reason: 'max_output_tokens' } : null,
    model: chat.model,
    output,
  };
  if (chat.usage) {
    const u: any = chat.usage;
    const inDetails = u.prompt_tokens_details ?? u.input_tokens_details;
    const cached = inDetails?.cached_tokens ?? 0;
    const cacheWrite = inDetails?.cache_write_tokens ?? u.cache_creation_input_tokens ?? 0;
    const outDetails = u.completion_tokens_details ?? u.output_tokens_details;
    const result2: any = {
      input_tokens: u.prompt_tokens,
      input_tokens_details: cacheWrite > 0
        ? { cached_tokens: cached, cache_write_tokens: cacheWrite }
        : { cached_tokens: cached },
      output_tokens: u.completion_tokens,
      total_tokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
    };
    if (outDetails && typeof outDetails === 'object' && Object.keys(outDetails).length > 0) {
      result2.output_tokens_details = { ...outDetails };
      if (result2.output_tokens_details.reasoning_tokens == null) result2.output_tokens_details.reasoning_tokens = 0;
    } else {
      result2.output_tokens_details = { reasoning_tokens: 0 };
    }
    result.usage = result2;
  }
  if ((chat as any).responsesEncryptedContent) result.encrypted_content = (chat as any).responsesEncryptedContent;
  return result;
}
