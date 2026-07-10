// src/converters/formats/responses/request.ts
import type { ChatRequest, ChatMessage, ChatTool } from '../../canonical/types.js';

interface ResponsesInputItem {
  role?: string;
  content?: any;
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  tool_call_id?: string;
}

/** Responses 请求 -> canonical chat 请求 */
export function responsesToChatRequest(body: any): ChatRequest {
  const messages: ChatMessage[] = [];

  if (body.instructions) {
    messages.push({ role: 'system', content: String(body.instructions) });
  }

  const input = normalizeInput(body.input);
  for (const item of input) {
    if (item.type === 'function_call') {
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: item.call_id || '',
          type: 'function',
          function: { name: item.name || '', arguments: item.arguments || '{}' },
        }],
      });
    } else if (item.type === 'function_call_output') {
      // Responses API 的 function_call_output 使用 `output` 字段
      const toolOutput = item.output ?? item.content;
      messages.push({
        role: 'tool',
        content: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput ?? ''),
        tool_call_id: item.call_id || '',
      });
    } else {
      const role = (item.role === 'system') ? 'system' : (item.role === 'user' ? 'user' : 'assistant');
      let content: string | null = '';
      if (typeof item.content === 'string') content = item.content;
      else if (Array.isArray(item.content)) content = item.content.map((c: any) => (typeof c === 'string' ? c : (c?.text ?? ''))).join('');
      else if (item.content == null) content = '';
      else content = JSON.stringify(item.content);
      messages.push({ role, content } as ChatMessage);
    }
  }

  const tools: ChatTool[] | undefined = body.tools?.map((t: any) => ({
    type: 'function',
    function: { name: t.name, description: t.description ?? '', parameters: t.parameters ?? {} },
  }));

  return {
    model: body.model,
    messages,
    tools,
    max_tokens: body.max_output_tokens,
    stream: body.stream,
    previousResponseId: body.previous_response_id,
    responseInstructions: body.instructions,
  };
}

/** canonical chat 请求 -> Responses 请求 */
export function chatToResponsesRequest(chat: ChatRequest): any {
  const input: any[] = [];
  let instructions: string | undefined;

  for (const m of chat.messages) {
    if (m.role === 'system') {
      instructions = typeof m.content === 'string' ? m.content : '';
      continue;
    }
    if (m.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: m.tool_call_id || '', output: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      for (const tc of m.tool_calls) {
        input.push({ type: 'function_call', call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
      }
      continue;
    }
    const content = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.map((c) => c.text ?? '').join('') : '');
    input.push({ role: m.role, content });
  }

  const result: any = { model: chat.model, input };
  if (instructions) result.instructions = instructions;
  if (chat.previousResponseId) result.previous_response_id = chat.previousResponseId;
  if (chat.tools) result.tools = chat.tools.map((t) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters }));
  if (chat.stream) result.stream = true;
  if (chat.max_tokens) result.max_output_tokens = chat.max_tokens;
  return result;
}

function normalizeInput(input: any): ResponsesInputItem[] {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  if (Array.isArray(input)) return input;
  return [];
}
