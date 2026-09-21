// src/converters/formats/responses/request.ts
import type { ChatRequest, ChatMessage, ChatTool, ChatToolCall } from '../../canonical/types.js';
import { DEFAULT_TOOL_PARAMETERS, ensureToolParameters } from '../../canonical/tools.js';

interface ResponsesInputItem {
  role?: string;
  content?: any;
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  tool_call_id?: string;
  output?: any;
  /** 思考模型（DeepSeek thinking 等）在 function_call/message item 上回传的思考过程 */
  reasoning_content?: string;
}

/** Responses 请求 -> canonical chat 请求 */
export function responsesToChatRequest(body: any): ChatRequest {
  const messages: ChatMessage[] = [];

  if (body.instructions) {
    messages.push({ role: 'system', content: String(body.instructions) });
  }

  const input = normalizeInput(body.input);
  // 连续的 function_call 先累积，合并为一个 assistant 消息（并行工具调用），
  // 严格上游（DeepSeek 等）要求 tool_calls 与随后的 tool 消息相邻。
  const pendingToolCalls: ChatToolCall[] = [];
  let pendingReasoning = '';
  const flushToolCalls = () => {
    if (pendingToolCalls.length === 0) return;
    const msg: ChatMessage = { role: 'assistant', content: null, tool_calls: [...pendingToolCalls] };
    // 思考模型（DeepSeek thinking）要求 function_call 上的 reasoning_content 随 assistant 消息回传
    if (pendingReasoning) msg.reasoning = pendingReasoning;
    messages.push(msg);
    pendingToolCalls.length = 0;
    pendingReasoning = '';
  };

  for (const item of input) {
    if (item.type === 'function_call') {
      pendingToolCalls.push({
        id: item.call_id || '',
        type: 'function',
        function: { name: item.name || '', arguments: item.arguments || '{}' },
      });
      if (item.reasoning_content && !pendingReasoning) pendingReasoning = item.reasoning_content;
    } else if (item.type === 'function_call_output') {
      // Responses API 的 function_call_output 使用 `output` 字段
      flushToolCalls();
      const toolOutput = item.output ?? item.content;
      messages.push({
        role: 'tool',
        content: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput ?? ''),
        tool_call_id: item.call_id || '',
      });
    } else {
      flushToolCalls();
      const role = (item.role === 'system' || item.role === 'developer') ? 'system' : (item.role === 'user' ? 'user' : 'assistant');
      const msg: ChatMessage = { role, content: convertResponsesContentToChat(item.content) } as ChatMessage;
      if (item.reasoning_content && role === 'assistant') msg.reasoning = item.reasoning_content;
      messages.push(msg);
    }
  }
  flushToolCalls();

  // Codex 会在 assistant(tool_calls) 与 tool 消息之间注入系统消息（审批通知等），
  // 严格上游要求 tool 消息紧跟 assistant，这里把注入的 system 消息前移。
  const ordered = reorderToolMessages(messages);

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
        function: { name: fn.name, description: fn.description ?? '', parameters: fn.parameters ?? fn.input_schema ?? { ...DEFAULT_TOOL_PARAMETERS } },
      };
    });

  const req: ChatRequest = {
    model: body.model,
    messages: ordered,
    tools,
    tool_choice: body.tool_choice ? mapToolChoiceToChat(body.tool_choice) : undefined,
    max_tokens: body.max_output_tokens,
    stream: body.stream,
    temperature: body.temperature,
    previousResponseId: body.previous_response_id,
    responseInstructions: body.instructions,
  };
  if (body.top_p !== undefined) req.top_p = body.top_p;
  if (body.parallel_tool_calls !== undefined) req.parallel_tool_calls = body.parallel_tool_calls;
  if (body.text?.format) req.response_format = body.text.format;
  return req;
}

/** 把 assistant(tool_calls) 与其 tool 消息之间插入的 system 消息前移到 assistant 之前 */
function reorderToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const reordered: ChatMessage[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const expectedIds = new Set(msg.tool_calls.map((tc) => tc.id));
      const toolMsgs: ChatMessage[] = [];
      const movedSystem: ChatMessage[] = [];
      let j = i + 1;
      while (j < messages.length && expectedIds.size > 0) {
        const nxt = messages[j];
        if (nxt.role === 'tool' && nxt.tool_call_id && expectedIds.has(nxt.tool_call_id)) {
          expectedIds.delete(nxt.tool_call_id);
          toolMsgs.push(nxt);
        } else if (nxt.role === 'system') {
          movedSystem.push(nxt);
        } else {
          break;
        }
        j++;
      }
      reordered.push(...movedSystem, msg, ...toolMsgs);
      i = j;
    } else {
      reordered.push(msg);
      i++;
    }
  }
  return reordered;
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
    input.push({ role: m.role, content: convertChatContentToResponses(m.content) });
  }

  const result: any = { model: chat.model, input };
  if (instructions) result.instructions = instructions;
  if (chat.previousResponseId) result.previous_response_id = chat.previousResponseId;
  if (chat.tools) result.tools = ensureToolParameters(chat.tools.map((t) => ({ type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters })));
  if (chat.tool_choice) {
    const toolChoice = sanitizeToolChoiceForResponses(chat.tool_choice, chat.tools);
    if (toolChoice !== undefined) result.tool_choice = toolChoice;
  }
  if (chat.stream) result.stream = true;
  if (chat.temperature !== undefined) result.temperature = chat.temperature;
  if (chat.max_tokens) result.max_output_tokens = chat.max_tokens;
  if (chat.top_p !== undefined) result.top_p = chat.top_p;
  if (chat.parallel_tool_calls !== undefined) result.parallel_tool_calls = chat.parallel_tool_calls;
  if (chat.response_format) result.text = { format: chat.response_format };
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

/**
 * 发往 Responses 上游前清洗 tool_choice：
 * - 无 tools 时丢弃，避免悬空 tool_choice 被上游 400；
 * - 字符串只保留 "auto"，其余（"required"/"none" 等）降级为 "auto"
 *  （opencode zen 等上游只支持 "auto"）；
 * - 对象型指向不存在的函数名时降级为 "auto"。
 */
function sanitizeToolChoiceForResponses(toolChoice: any, tools?: ChatTool[]): any {
  if (!tools || tools.length === 0) return undefined;
  if (typeof toolChoice === 'string') {
    return toolChoice === 'auto' ? toolChoice : 'auto';
  }
  const mapped = mapChatToolChoiceToResponses(toolChoice);
  if (mapped && mapped.type === 'function') {
    const names = new Set(tools.map((t) => t.function?.name));
    if (!mapped.name || !names.has(mapped.name)) return 'auto';
  }
  return mapped;
}

function normalizeInput(input: any): ResponsesInputItem[] {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  if (Array.isArray(input)) return input;
  return [];
}

/**
 * Responses content part -> canonical chat part。
 * input_text/output_text 合并为 text；image 转 image_url；
 * input_audio 按原样透传；input_file 转 file。默认上游具备对应能力。
 */
function convertResponsesContentToChat(content: any): ChatMessage['content'] {
  if (typeof content === 'string' || content == null) return (content ?? '') as string;
  if (!Array.isArray(content)) return JSON.stringify(content);
  const parts: any[] = [];
  let textBuf = '';
  const flushText = () => {
    if (textBuf) {
      parts.push({ type: 'text', text: textBuf });
      textBuf = '';
    }
  };
  for (const c of content) {
    if (typeof c === 'string') { textBuf += c; continue; }
    if (c?.type === 'input_text' || c?.type === 'output_text' || c?.type === 'text') {
      textBuf += (c.text ?? '');
    } else if (c?.type === 'input_image' || c?.type === 'image_url') {
      flushText();
      const url = typeof c.image_url === 'string' ? c.image_url : (c.image_url?.url ?? '');
      parts.push({ type: 'image_url', image_url: { url } });
    } else if (c?.type === 'input_audio') {
      flushText();
      parts.push({ type: 'input_audio', input_audio: c.input_audio ?? { data: c.data ?? '', format: c.format ?? 'mp3' } });
    } else if (c?.type === 'input_file') {
      flushText();
      parts.push({ type: 'file', file: { filename: c.filename, file_data: c.file_data, file_id: c.file_id } });
    } else {
      textBuf += (c?.text ?? '');
    }
  }
  flushText();
  if (parts.length === 0) return textBuf;
  return parts as ChatMessage['content'];
}

/** canonical chat content -> Responses content part 数组（纯文本退化为字符串） */
function convertChatContentToResponses(content: ChatMessage['content']): any {
  if (typeof content === 'string' || content == null) return (content ?? '') as string;
  if (!Array.isArray(content)) return content;
  const parts: any[] = [];
  for (const c of content as any[]) {
    if (c?.type === 'text') parts.push({ type: 'input_text', text: c.text ?? '' });
    else if (c?.type === 'image_url') parts.push({ type: 'input_image', image_url: c.image_url?.url ?? '' });
    else if (c?.type === 'input_audio') parts.push({ type: 'input_audio', input_audio: c.input_audio });
    else if (c?.type === 'file') parts.push({ type: 'input_file', ...c.file });
  }
  if (parts.length === 1 && parts[0].type === 'input_text') return parts[0].text;
  return parts;
}
