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
  output?: any;
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

  // OpenAI Responses 的 tools 可能是多种类型：
  // - function（扁平 {type,name,...} 或嵌套 {type,function:{name,...}}）→ 转 openai function tool
  // - namespace / web_search / 其他内置工具 → openai chat 端点不支持，直接丢弃
  // 只转发 function 工具，避免生成缺 name 的畸形 tool 导致上游 400。
  const tools: ChatTool[] | undefined = body.tools
    ?.filter((t: any) => t?.type === 'function')
    .map((t: any) => {
      const fn = t.function ?? t;
      return {
        type: 'function',
        function: { name: fn.name, description: fn.description ?? '', parameters: fn.parameters ?? {} },
      };
    });

  return {
    model: body.model,
    messages,
    tools,
    tool_choice: body.tool_choice ? mapToolChoiceToChat(body.tool_choice) : undefined,
    max_tokens: body.max_output_tokens,
    stream: body.stream,
    temperature: body.temperature,
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
  if (chat.tools) result.tools = chat.tools.map((t) => ({ type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters }));
  if (chat.tool_choice) result.tool_choice = mapChatToolChoiceToResponses(chat.tool_choice);
  if (chat.stream) result.stream = true;
  if (chat.temperature !== undefined) result.temperature = chat.temperature;
  if (chat.max_tokens) result.max_output_tokens = chat.max_tokens;
  return result;
}

/** Responses tool_choice ({type:"function", name}) -> chat tool_choice ({type:"function", function:{name}}) */
function mapToolChoiceToChat(toolChoice: any): any {
  if (typeof toolChoice === 'string') return toolChoice;
  if (toolChoice && toolChoice.type === 'function') {
    return { type: 'function', function: { name: toolChoice.name } };
  }
  return toolChoice;
}

/** chat tool_choice ({type:"function", function:{name}}) -> Responses tool_choice ({type:"function", name}) */
function mapChatToolChoiceToResponses(toolChoice: any): any {
  if (typeof toolChoice === 'string') return toolChoice;
  if (toolChoice && toolChoice.type === 'function') {
    return { type: 'function', name: toolChoice.function?.name };
  }
  return toolChoice;
}

function normalizeInput(input: any): ResponsesInputItem[] {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  if (Array.isArray(input)) return input;
  return [];
}
