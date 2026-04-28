/**
 * OpenAI → Anthropic 格式转换
 *
 * 用于将 OpenAI 格式的请求/响应转换为 Anthropic 格式
 * 参考 LiteLLM 实现：refproj/litellm/litellm/llms/anthropic/experimental_pass_through/adapters/
 */

import {
  type AnthropicContentBlock,
  type AnthropicMessage,
  type AnthropicTool,
  type AnthropicRequest,
  type AnthropicResponse,
  type OpenAIMessage,
  type OpenAIRequest,
  type OpenAIResponse
} from './types.js';

import type { OpenAIStreamChunk, AnthropicStreamEvent, OpenAIToAnthropicStreamState } from './shared/types.js';
import { mapOpenAIToAnthropicFinishReason } from './shared/finish-reason.js';
import { createOpenAIToAnthropicStreamState } from './shared/types.js';
export { createOpenAIToAnthropicStreamState, type OpenAIToAnthropicStreamState } from './shared/types.js';

// ==================== 请求转换：OpenAI → Anthropic ====================

/**
 * 解析图片 URL 为 base64
 */
async function parseImageUrl(url: string): Promise<{ data: string; mediaType: string }> {
  if (url.startsWith('data:')) {
    // 已经是 base64 格式
    const matches = url.match(/^data:([^;]+);base64,(.+)$/);
    if (matches) {
      return { data: matches[2], mediaType: matches[1] };
    }
  }

  // 远程 URL，需要 fetch
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const mediaType = response.headers.get('content-type') || 'image/jpeg';

  return { data: base64, mediaType };
}

/**
 * 转换 OpenAI 消息内容为 Anthropic 格式
 */
async function convertOpenAIContent(
  content: OpenAIMessage['content']
): Promise<AnthropicContentBlock[]> {
  if (typeof content === 'string' || content === null) {
    return [{ type: 'text', text: content || '' }];
  }

  const blocks: AnthropicContentBlock[] = [];

  for (const part of content) {
    if (part.type === 'text') {
      blocks.push({
        type: 'text',
        text: part.text || ''
      });
    } else if (part.type === 'image_url' && part.image_url) {
      const { data, mediaType } = await parseImageUrl(part.image_url.url);
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data
        }
      });
    }
  }

  return blocks;
}

/**
 * 转换 tool_calls 为 tool_use
 */
function convertToolCallsToToolUse(toolCalls: OpenAIMessage['tool_calls']): AnthropicContentBlock[] {
  if (!toolCalls) return [];

  return toolCalls.map(call => ({
    type: 'tool_use',
    id: call.id,
    name: call.function.name,
    input: JSON.parse(call.function.arguments)
  }));
}

/**
 * 转换 OpenAI tools 定义为 Anthropic 格式
 */
function convertOpenAIToolsToAnthropic(
  tools: OpenAIRequest['tools']
): AnthropicTool[] | undefined {
  if (!tools) return undefined;

  return tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters
  }));
}

/**
 * 将 finish_reason 映射为 stop_reason
 */
function mapFinishReason(finishReason: string | null): AnthropicResponse['stop_reason'] {
  switch (finishReason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
      return 'tool_use';
    case 'content_filter':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}

/**
 * 主转换函数：OpenAI Request → Anthropic Request
 *
 * 注意：api.longcat.chat 不支持 system 字段，会将 system 内容合并到第一条 user 消息中
 * 注意：api.longcat.chat 的 max_tokens 限制为 [1, 8192]
 */
export async function convertOpenAIRequestToAnthropic(
  openaiRequest: OpenAIRequest
): Promise<AnthropicRequest> {
  const messages: AnthropicMessage[] = [];
  let systemContent: string | undefined;

  // api.longcat.chat 的 max_tokens 限制为 [1, 8192]
  let maxTokens = openaiRequest.max_tokens || 4096;
  maxTokens = Math.max(1, Math.min(8192, maxTokens));

  for (const msg of openaiRequest.messages) {
    // 处理 system 消息（api.longcat.chat 不支持 system 字段，需要合并到第一条 user 消息）
    if (msg.role === 'system') {
      systemContent = typeof msg.content === 'string' ? msg.content :
               msg.content?.map(c => c.type === 'text' ? c.text : '').join(' ') || '';
      continue;
    }

    // 处理 tool 消息（转换为 tool_result）
    if (msg.role === 'tool') {
      const toolResultContent = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);

      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id || '',
          content: toolResultContent || 'No output'
        }]
      });
      continue;
    }

    // 处理 assistant 消息
    if (msg.role === 'assistant') {
      const contentBlocks: AnthropicContentBlock[] = [];

      // 文本内容
      if (typeof msg.content === 'string' && msg.content) {
        contentBlocks.push({ type: 'text', text: msg.content });
      } else if (Array.isArray(msg.content)) {
        const converted = await convertOpenAIContent(msg.content);
        contentBlocks.push(...converted);
      }

      // tool_calls
      if (msg.tool_calls) {
        contentBlocks.push(...convertToolCallsToToolUse(msg.tool_calls));
      }

      // api.longcat.chat 要求：
      // 1. assistant 消息不支持带 content 的历史消息
      // 2. 如果只有纯文本内容，省略 content 字段
      // 3. 如果有 tool_calls，保留数组格式
      if (contentBlocks.length === 0) {
        // 没有任何内容，省略 content 字段
        messages.push({
          role: 'assistant'
        });
      } else if (contentBlocks.every(block => block.type === 'text')) {
        // 只有纯文本内容，省略 content 字段
        messages.push({
          role: 'assistant'
        });
      } else {
        // 包含 tool_use 等内容，使用数组格式
        messages.push({
          role: 'assistant',
          content: contentBlocks
        });
      }
      continue;
    }

    // 处理 user 消息
    if (msg.role === 'user') {
      const content = await convertOpenAIContent(msg.content);

      // 如果有 system 内容，将其合并到第一条 user 消息的开头
      if (systemContent && messages.length === 0) {
        content.unshift({ type: 'text', text: systemContent + '\n\n' });
        systemContent = undefined; // 只合并一次
      }

      messages.push({
        role: 'user',
        content
      });
    }
  }

  return {
    model: openaiRequest.model,
    messages,
    tools: convertOpenAIToolsToAnthropic(openaiRequest.tools),
    max_tokens: maxTokens,
    stream: openaiRequest.stream,
    temperature: openaiRequest.temperature
  };
}

// ==================== 响应转换：Anthropic → OpenAI ====================

/**
 * 主转换函数：Anthropic Response → OpenAI Response
 */
export function convertAnthropicResponseToOpenAI(
  anthropicResponse: AnthropicResponse,
  model?: string
): OpenAIResponse {
  const contentBlocks = anthropicResponse.content || [];

  // 提取文本内容
  const textContent = contentBlocks
    .filter(block => block.type === 'text')
    .map(block => block.text || '')
    .join('');

  // 提取 tool_calls
  const toolCalls = contentBlocks
    .filter(block => block.type === 'tool_use')
    .map(block => ({
      id: block.id || '',
      type: 'function' as const,
      function: {
        name: block.name || '',
        arguments: JSON.stringify(block.input || {})
      }
    }));

  // 确定 finish_reason
  let finishReason: string | null = null;
  switch (anthropicResponse.stop_reason) {
    case 'end_turn':
      finishReason = 'stop';
      break;
    case 'tool_use':
      finishReason = 'tool_calls';
      break;
    case 'max_tokens':
      finishReason = 'length';
      break;
    case 'stop_sequence':
      finishReason = 'stop';
      break;
  }

  return {
    id: anthropicResponse.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || anthropicResponse.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: textContent || null,
          ...(toolCalls.length > 0 && { tool_calls: toolCalls })
        },
        finish_reason: finishReason
      }
    ],
    usage: {
      prompt_tokens: anthropicResponse.usage.input_tokens,
      completion_tokens: anthropicResponse.usage.output_tokens,
      total_tokens: anthropicResponse.usage.input_tokens + anthropicResponse.usage.output_tokens
    }
  };
}

// ==================== 流式响应转换：OpenAI SSE → Anthropic SSE ====================

/**
 * 判断是否应该开始新的 content block
 *
 * 参考 LiteLLM 实现：litellm/llms/anthropic/experimental_pass_through/adapters/streaming_iterator.py
 *
 * 开始新 block 的场景：
 * 1. 从 text 切换到 tool_use
 * 2. 从 tool_use 切换到 text
 * 3. 从 text 切换到 thinking
 * 4. 检测到新的 tool call（有 id 或 name，表示 parallel tool calls）
 *
 * 注意：content 和 thinking 可以同时存在，所以 thinking 不应该阻止 text 的处理
 */
function shouldStartNewContentBlock(
  chunk: OpenAIStreamChunk,
  state: OpenAIToAnthropicStreamState
): boolean {
  const choice = chunk.choices?.[0];
  const delta = choice?.delta;
  const finishReason = choice?.finish_reason;

  // finish_reason 不为空时不开始新 block（即将结束）
  if (finishReason) {
    return false;
  }

  // 检查 tool_calls - 新的 tool call 开始
  if (delta?.tool_calls && delta.tool_calls.length > 0) {
    const toolCall = delta.tool_calls[0];

    // 如果是新的 tool call（有 id 或 name，表示新的 parallel tool call）
    if (toolCall.id || toolCall.function?.name) {
      // 当前不是 tool_use 类型，需要开始新 block
      if (state.currentContentBlockType !== 'tool_use') {
        return true;
      }
      // 当前是 tool_use，但是新的 tool call（parallel calls）
      if (state.currentToolId && toolCall.id && state.currentToolId !== toolCall.id) {
        return true;
      }
    }
  }

  // 检查文本内容
  if (delta?.content !== undefined && delta.content !== null && delta.content !== '') {
    // 当前不是 text 类型，需要开始新 block
    if (state.currentContentBlockType !== 'text') {
      return true;
    }
  }

  // 检查 reasoning_content（thinking）
  if (delta?.reasoning_content !== undefined && delta.reasoning_content !== null && delta.reasoning_content !== '') {
    if (state.currentContentBlockType !== 'thinking') {
      return true;
    }
  }

  // 检查 reasoning 字段（OpenRouter 格式）
  if (delta?.reasoning !== undefined && delta.reasoning !== null && delta.reasoning !== '') {
    if (state.currentContentBlockType !== 'thinking') {
      return true;
    }
  }

  // 检查 reasoning_details 字段（OpenAI o1 格式）
  if (delta?.reasoning_details && delta.reasoning_details.length > 0 && delta.reasoning_details[0]?.text) {
    if (state.currentContentBlockType !== 'thinking') {
      return true;
    }
  }

  return false;
}

/**
 * 处理 thinking delta（reasoning_content, reasoning, reasoning_details）
 * 提取为独立函数，避免代码重复
 */
function handleThinkingDelta(
  events: AnthropicStreamEvent[],
  state: OpenAIToAnthropicStreamState,
  thinkingText: string
): void {
  if (state.currentContentBlockType !== 'thinking' || !state.sentContentBlockStart) {
    // 结束之前的 text 或 tool_use block（如果有）
    if ((state.currentContentBlockType === 'text' || state.currentContentBlockType === 'tool_use') && state.sentContentBlockStart && !state.sentContentBlockFinish) {
      events.push({
        type: 'content_block_stop',
        index: state.currentContentBlockIndex
      });
      state.sentContentBlockFinish = true;
      state.currentContentBlockIndex++;
    }

    state.currentContentBlockType = 'thinking';
    state.sentContentBlockStart = false;
    state.sentContentBlockFinish = false;
  }

  if (!state.sentContentBlockStart) {
    state.sentContentBlockStart = true;
    events.push({
      type: 'content_block_start',
      index: state.currentContentBlockIndex,
      content_block: {
        type: 'thinking',
        text: ''
      }
    });
  }

  if (thinkingText) {
    events.push({
      type: 'content_block_delta',
      index: state.currentContentBlockIndex,
      delta: {
        type: 'thinking_delta',
        thinking: thinkingText
      }
    });
  }
}

/**
 * 转换单个 OpenAI 流式 chunk 为 Anthropic 流式事件（带状态管理）
 *
 * 参考 LiteLLM 实现：
 * - litellm/llms/anthropic/experimental_pass_through/adapters/streaming_iterator.py
 * - litellm/llms/anthropic/experimental_pass_through/adapters/transformation.py
 *
 * 返回事件数组，因为一个 OpenAI chunk 可能需要多个 Anthropic 事件
 */
export function convertOpenAIStreamChunkToAnthropic(
  chunk: OpenAIStreamChunk,
  state?: OpenAIToAnthropicStreamState
): AnthropicStreamEvent[] {
  const events: AnthropicStreamEvent[] = [];

  // 初始化状态（如果未提供）
  const s: OpenAIToAnthropicStreamState = state ?? createOpenAIToAnthropicStreamState();

  const choice = chunk.choices?.[0];
  const delta = choice?.delta;
  const finishReason = choice?.finish_reason;

  // 1. 第一次 chunk：发送 message_start
  if (!s.sentMessageStart) {
    s.sentMessageStart = true;
    events.push({
      type: 'message_start',
      message: {
        id: s.messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: chunk.model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0
        }
      }
    });
  }

  // 2. 检查是否需要开始新的 content block（参考 LiteLLM 的 _should_start_new_content_block）
  const shouldStartNewBlock = shouldStartNewContentBlock(chunk, s);

  if (shouldStartNewBlock && s.sentContentBlockStart && !s.sentContentBlockFinish) {
    // 结束当前的 content block
    events.push({
      type: 'content_block_stop',
      index: s.currentContentBlockIndex
    });
    s.sentContentBlockFinish = true;
    s.currentContentBlockIndex++;
    s.sentContentBlockStart = false;
  }

  // 3. 处理 tool_calls（支持 parallel tool calls）
  if (delta?.tool_calls && delta.tool_calls.length > 0) {
    for (const toolCall of delta.tool_calls) {
      const toolIndex = toolCall.index ?? 0;

      // 检查是否是新的 tool call（parallel calls）
      const isNewToolCall = toolCall.id && s.currentToolId && toolCall.id !== s.currentToolId;
      const needsNewBlock = s.currentContentBlockType !== 'tool_use' || !s.sentContentBlockStart || isNewToolCall;

      if (needsNewBlock) {
        // 结束当前的 block
        if (s.sentContentBlockStart && !s.sentContentBlockFinish) {
          events.push({ type: 'content_block_stop', index: s.currentContentBlockIndex });
          s.sentContentBlockFinish = true;
          s.currentContentBlockIndex++;
        }

        s.currentContentBlockType = 'tool_use';
        s.sentContentBlockStart = false;
        s.sentContentBlockFinish = false;

        if (toolCall.id) s.currentToolId = toolCall.id;
        if (toolCall.function?.name) s.currentToolName = toolCall.function.name;
      }

      // 发送 content_block_start（如果是第一次）
      if (!s.sentContentBlockStart) {
        s.sentContentBlockStart = true;
        events.push({
          type: 'content_block_start',
          index: s.currentContentBlockIndex,
          content_block: {
            type: 'tool_use',
            id: s.currentToolId || `toolu_${Date.now()}_${toolIndex}`,
            name: s.currentToolName || '',
            input: {}
          }
        });
      }

      // 发送 input_json_delta
      if (toolCall.function?.arguments) {
        events.push({
          type: 'content_block_delta',
          index: s.currentContentBlockIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: toolCall.function.arguments
          }
        });
      }
    }
  }
  // 4. 处理文本内容
  if (delta?.content !== undefined && delta.content !== null) {
    // 检查是否需要开始新的 content block（text）
    if (s.currentContentBlockType !== 'text' || !s.sentContentBlockStart) {
      // 结束之前的 thinking block（如果有）
      if ((s.currentContentBlockType === 'thinking' || s.currentContentBlockType === 'tool_use') && s.sentContentBlockStart && !s.sentContentBlockFinish) {
        events.push({
          type: 'content_block_stop',
          index: s.currentContentBlockIndex
        });
        s.sentContentBlockFinish = true;
        s.currentContentBlockIndex++;
      }

      // 开始新的 text block
      s.currentContentBlockType = 'text';
      s.sentContentBlockStart = false;
      s.sentContentBlockFinish = false;
    }

    // 发送 content_block_start（如果是第一次）
    if (!s.sentContentBlockStart) {
      s.sentContentBlockStart = true;
      events.push({
        type: 'content_block_start',
        index: s.currentContentBlockIndex,
        content_block: {
          type: 'text',
          text: ''
        }
      });
    }

    // 发送 text_delta
    if (delta.content) {
      events.push({
        type: 'content_block_delta',
        index: s.currentContentBlockIndex,
        delta: {
          type: 'text_delta',
          text: delta.content
        }
      });
    }
  }

  // 5. 处理 reasoning_content（thinking）- Qwen 格式
  // 注意：使用独立 if 而非 else if，因为某些模型（如 MiniMax）同时返回 content 和 reasoning_content
  if (delta?.reasoning_content !== undefined && delta.reasoning_content !== null && delta.reasoning_content !== '') {
    handleThinkingDelta(events, s, delta.reasoning_content);
  }
  // 6. 处理 reasoning 字段（thinking）- OpenRouter 格式
  else if (delta?.reasoning !== undefined && delta.reasoning !== null && delta.reasoning !== '') {
    handleThinkingDelta(events, s, delta.reasoning);
  }
  // 7. 处理 reasoning_details 字段（thinking）- OpenAI o1 格式
  else if (delta?.reasoning_details && delta.reasoning_details.length > 0) {
    for (const detail of delta.reasoning_details) {
      const reasoningText = detail?.text || '';
      if (reasoningText) {
        handleThinkingDelta(events, s, reasoningText);
      }
    }
  }

  // 5b. 处理 refusal 字段（OpenAI 安全过滤）
  if (delta?.refusal !== undefined && delta.refusal !== null && delta.refusal !== '') {
    if (s.currentContentBlockType !== 'text' || !s.sentContentBlockStart) {
      if (s.sentContentBlockStart && !s.sentContentBlockFinish) {
        events.push({ type: 'content_block_stop', index: s.currentContentBlockIndex });
        s.sentContentBlockFinish = true;
        s.currentContentBlockIndex++;
      }
      s.currentContentBlockType = 'text';
      s.sentContentBlockStart = false;
      s.sentContentBlockFinish = false;
    }
    if (!s.sentContentBlockStart) {
      s.sentContentBlockStart = true;
      events.push({
        type: 'content_block_start',
        index: s.currentContentBlockIndex,
        content_block: { type: 'text', text: '' }
      });
    }
    events.push({
      type: 'content_block_delta',
      index: s.currentContentBlockIndex,
      delta: { type: 'text_delta', text: delta.refusal }
    });
  }

  // 8. 处理 finish_reason（结束消息）
  if (finishReason) {
    // 结束当前 content block
    if (s.sentContentBlockStart && !s.sentContentBlockFinish) {
      events.push({
        type: 'content_block_stop',
        index: s.currentContentBlockIndex
      });
      s.sentContentBlockFinish = true;
    }
    
    // 发送 message_delta（包含 stop_reason 和 usage）
    const anthropicStopReason = mapOpenAIToAnthropicFinishReason(finishReason);

    const messageDeltaEvent: AnthropicStreamEvent = {
      type: 'message_delta',
      delta: {
        stop_reason: anthropicStopReason,
        stop_sequence: null
      }
    };
    
    // 添加 usage 信息
    if (chunk.usage) {
      const inputTokens = chunk.usage.prompt_tokens || 0;
      const outputTokens = chunk.usage.completion_tokens || 0;
      const cacheTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0;
      
      messageDeltaEvent.usage = {
        input_tokens: inputTokens,
        output_tokens: outputTokens
      };
      
      if (cacheTokens > 0) {
        messageDeltaEvent.usage.cache_creation_input_tokens = cacheTokens;
      }
    }
    
    events.push(messageDeltaEvent);
    
    // 发送 message_stop
    events.push({
      type: 'message_stop'
    });
  }
  
  return events;
}

/**
 * 将 Anthropic 流式事件格式化为 SSE 格式
 */
export function formatAnthropicEventToSSE(event: AnthropicStreamEvent): string {
  const eventType = event.type;
  const eventData = JSON.stringify(event);
  return `event: ${eventType}\ndata: ${eventData}\n\n`;
}

/**
 * 解析 SSE 数据行（支持 event 和 data 前缀）
 */
export function parseOpenAISSEData(line: string): { event?: string; data: any } | null {
  const trimmedLine = line.trim();
  
  // OpenAI SSE 通常只有 data 行，但也要处理 event 行
  if (trimmedLine.startsWith('event:')) {
    const eventType = trimmedLine.slice(6).trim();
    return { event: eventType, data: null };
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
    const parsed = JSON.parse(data);
    return { data: parsed };
  } catch {
    return null;
  }
}
