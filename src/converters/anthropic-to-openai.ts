/**
 * Anthropic → OpenAI 格式转换
 *
 * 用于将 Anthropic 格式的请求/响应转换为 OpenAI 格式
 * 参考 LiteLLM 实现：refproj/litellm/litellm/llms/anthropic/experimental_pass_through/adapters/
 */

import {
  type AnthropicContentBlock,
  type AnthropicMessage,
  type AnthropicRequest,
  type AnthropicTool,
  type AnthropicResponse,
  type OpenAIMessage,
  type OpenAITool,
  type OpenAIRequest,
  type OpenAIResponse
} from './types.js';

import type { OpenAIStreamChunk, AnthropicStreamEvent } from './shared/types.js';
import { mapAnthropicToOpenAIFinishReason, createStreamConverterState } from './shared/index.js';
export { createStreamConverterState } from './shared/types.js';

// ==================== 请求转换：Anthropic → OpenAI ====================

/**
 * 转换 Anthropic system 字段
 */
function convertSystem(
  system: AnthropicRequest['system']
): string | undefined {
  if (!system) return undefined;

  if (typeof system === 'string') {
    return system;
  }

  return system.map(block => block.text).join(' ');
}

/**
 * 转换 Anthropic 图片为 OpenAI 格式
 */
function convertImageBlock(block: AnthropicContentBlock): {
  type: 'image_url';
  image_url: { url: string };
} {
  if (!block.source) {
    return { type: 'image_url', image_url: { url: '' } };
  }

  const url = block.source.type === 'base64'
    ? `data:${block.source.media_type};base64,${block.source.data}`
    : block.source.data;

  return {
    type: 'image_url',
    image_url: { url }
  };
}

/**
 * 转换 Anthropic tool_use 为 OpenAI tool_calls
 */
function convertToolUseToToolCalls(
  contentBlocks: AnthropicContentBlock[]
): OpenAIMessage['tool_calls'] {
  const toolUseBlocks = contentBlocks.filter(block => block.type === 'tool_use');

  if (toolUseBlocks.length === 0) return undefined;

  return toolUseBlocks.map(block => ({
    id: block.id || '',
    type: 'function' as const,
    function: {
      name: block.name || '',
      arguments: JSON.stringify(block.input || {})
    }
  }));
}

/**
 * 转换 Anthropic tools 定义为 OpenAI 格式
 */
function convertAnthropicToolsToOpenAI(
  tools: AnthropicRequest['tools']
): OpenAITool[] | undefined {
  if (!tools) return undefined;

  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema
    }
  }));
}

/**
 * 主转换函数：Anthropic Request → OpenAI Request
 */
export function convertAnthropicRequestToOpenAI(
  anthropicRequest: AnthropicRequest
): OpenAIRequest {
  const messages: OpenAIMessage[] = [];

  // 处理 system 字段（放在 messages 开头）
  const systemContent = convertSystem(anthropicRequest.system);
  if (systemContent) {
    messages.push({
      role: 'system',
      content: systemContent
    });
  }

  // 处理 messages
  for (const msg of anthropicRequest.messages) {
    // 处理 assistant 消息
    if (msg.role === 'assistant') {
      const openaiMessage: OpenAIMessage = {
        role: 'assistant',
        content: ''
      };

      if (typeof msg.content === 'string') {
        openaiMessage.content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // 提取文本
        const textParts = msg.content
          .filter(block => block.type === 'text')
          .map(block => block.text || '')
          .join('');

        openaiMessage.content = textParts || '';

        // 转换 tool_use 为 tool_calls
        const toolCalls = convertToolUseToToolCalls(msg.content);
        if (toolCalls) {
          openaiMessage.tool_calls = toolCalls;
          // 当有 tool_calls 时，content 应该为 null（OpenAI 规范）
          if (!textParts) {
            openaiMessage.content = null;
          }
        }
      }

      messages.push(openaiMessage);
      continue;
    }

    // 处理 user 消息
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        messages.push({
          role: 'user',
          content: msg.content
        });
      } else if (Array.isArray(msg.content)) {
        // 检查是否有 tool_result
        const toolResultBlocks = msg.content.filter(block => block.type === 'tool_result');

        if (toolResultBlocks.length > 0) {
          // 按 tool_use_id 分组，避免重复
          const toolResultsMap = new Map<string, typeof toolResultBlocks>();
          for (const block of toolResultBlocks) {
            const toolUseId = block.tool_use_id || '';
            if (!toolResultsMap.has(toolUseId)) {
              toolResultsMap.set(toolUseId, []);
            }
            toolResultsMap.get(toolUseId)!.push(block);
          }

          // 为每个唯一 tool_use_id 创建 tool 消息
          for (const [toolUseId, blocks] of toolResultsMap) {
            const combinedContent = blocks
              .map(block =>
                typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content)
              )
              .join('\n');

            messages.push({
              role: 'tool',
              content: combinedContent || 'No output',
              tool_call_id: toolUseId
            });
          }

          // 处理剩余的 text 内容作为 user 消息
          const textContent = msg.content
            .filter(block => block.type === 'text')
            .map(block => block.text || '')
            .join('');

          if (textContent) {
            messages.push({
              role: 'user',
              content: textContent
            });
          }
        } else {
          // 普通内容（文本 + 图片）
          // 检查是否只有文本
          const hasOnlyText = msg.content.every(block => block.type === 'text');

          if (hasOnlyText) {
            // 纯文本：扁平化为字符串
            const textContent = msg.content
              .filter(block => block.type === 'text')
              .map(block => block.text || '')
              .join('');

            messages.push({
              role: 'user',
              content: textContent
            });
          } else {
            // 多模态：转换每个 block
            const contentParts: Array<{
              type: 'text' | 'image_url';
              text?: string;
              image_url?: { url: string };
            }> = msg.content.map(block => {
              if (block.type === 'text' && block.text) {
                return { type: 'text' as const, text: block.text };
              }
              if (block.type === 'image' && block.source) {
                return convertImageBlock(block);
              }
              // 跳过其他类型的 block（如 tool_use, tool_result）
              return { type: 'text' as const, text: '' };
            });

            messages.push({
              role: 'user',
              content: contentParts
            });
          }
        }
      }
    }
  }

  // 转换 thinking 参数：Anthropic thinking -> OpenAI stream_options
  const streamOptions = anthropicRequest.thinking?.type === 'enabled'
    ? { include_reasoning: true }
    : undefined;

  return {
    model: anthropicRequest.model,
    messages,
    tools: convertAnthropicToolsToOpenAI(anthropicRequest.tools),
    max_tokens: anthropicRequest.max_tokens,
    stream: anthropicRequest.stream,
    temperature: anthropicRequest.temperature,
    ...(streamOptions && { stream_options: streamOptions })
  };
}

// ==================== 响应转换：OpenAI → Anthropic ====================

/**
 * 将 finish_reason 映射为 stop_reason
 */
function mapFinishReason(
  finishReason: string | null
): AnthropicResponse['stop_reason'] {
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
 * 主转换函数：OpenAI Response → Anthropic Response
 */
export function convertOpenAIResponseToAnthropic(
  openaiResponse: OpenAIResponse,
  model?: string
): AnthropicResponse {
  const choice = openaiResponse.choices?.[0];
  const message = choice?.message;

  const content: AnthropicResponse['content'] = [];

  // 转换文本内容
  if (message?.content) {
    content.push({
      type: 'text',
      text: message.content
    });
  }

  // 转换 tool_calls 为 tool_use
  if (message?.tool_calls) {
    for (const toolCall of message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.function.name,
        input: JSON.parse(toolCall.function.arguments)
      });
    }
  }

  return {
    id: openaiResponse.id,
    type: 'message',
    role: 'assistant',
    model: model || openaiResponse.model,
    content,
    stop_reason: mapFinishReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: openaiResponse.usage?.prompt_tokens ?? 0,
      output_tokens: openaiResponse.usage?.completion_tokens ?? 0
    }
  };
}

// ==================== 流式响应转换：Anthropic SSE → OpenAI SSE ====================

/**
 * 转换单个 Anthropic 流式事件为 OpenAI 流式 chunk（带状态管理）
 * 
 * 参考 LiteLLM 实现：
 * - litellm/llms/anthropic/experimental_pass_through/adapters/streaming_iterator.py
 * - litellm/llms/anthropic/experimental_pass_through/adapters/transformation.py
 */
export function convertAnthropicStreamEventToOpenAI(
  event: AnthropicStreamEvent,
  requestId: string,
  model: string,
  state?: StreamConverterState
): OpenAIStreamChunk | null {
  const created = Math.floor(Date.now() / 1000);
  
  // 初始化状态（如果未提供）
  if (!state) {
    state = createStreamConverterState();
  }

  switch (event.type) {
    case 'message_start': {
      // message_start -> 返回 role 和初始 usage（tokens 初始化为 0，表示支持缓存）
      // 参考 LiteLLM: _create_initial_usage_delta()
      return {
        id: event.message?.id || requestId,
        object: 'chat.completion.chunk' as const,
        created,
        model,
        choices: [{
          index: 0,
          delta: {
            role: 'assistant'
          },
          finish_reason: null
        }],
        usage: event.message?.usage ? {
          prompt_tokens: event.message.usage.input_tokens || 0,
          completion_tokens: event.message.usage.output_tokens || 0,
          total_tokens: (event.message.usage.input_tokens || 0) + (event.message.usage.output_tokens || 0),
          prompt_tokens_details: {
            cached_tokens: 0 // 初始化为 0，表示支持缓存
          }
        } : undefined
      };
    }

    case 'content_block_start': {
      // content_block_start -> 根据类型处理
      const blockType = event.content_block?.type;
      const index = event.index ?? 0;
      
      if (blockType === 'tool_use') {
        // tool_use 开始：记录 tool 信息
        const toolId = event.content_block?.id || `toolu_${Date.now()}_${index}`;
        const toolName = event.content_block?.name || '';
        
        state.toolIdMap.set(index, toolId);
        state.toolNameMap.set(index, toolName);
        state.toolInputBuffers.set(index, '');
        state.hasSentToolCallStart.set(index, false);
        
        // 返回 tool_calls 的起始 chunk（包含 id 和 name，arguments 为空）
        return {
          id: requestId,
          object: 'chat.completion.chunk' as const,
          created,
          model,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index,
                id: toolId,
                type: 'function' as const,
                function: {
                  name: toolName,
                  arguments: ''
                }
              }]
            },
            finish_reason: null
          }]
        };
      } else if (blockType === 'text') {
        // text 开始：返回空 content 以开始文本块
        return {
          id: requestId,
          object: 'chat.completion.chunk' as const,
          created,
          model,
          choices: [{
            index: 0,
            delta: {
              content: ''
            },
            finish_reason: null
          }]
        };
      } else if (blockType === 'thinking') {
        // thinking 开始：返回空的 reasoning_content
        return {
          id: requestId,
          object: 'chat.completion.chunk' as const,
          created,
          model,
          choices: [{
            index: 0,
            delta: {
              reasoning_content: ''
            },
            finish_reason: null
          }]
        };
      }
      
      // 未知类型，返回空 chunk
      return {
        id: requestId,
        object: 'chat.completion.chunk' as const,
        created,
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: null
        }]
      };
    }

    case 'content_block_delta': {
      // content_block_delta -> 根据 delta 类型处理
      const deltaType = event.delta?.type;
      const index = event.index ?? 0;
      
      if (deltaType === 'text_delta') {
        // 文本增量
        const text = event.delta?.text || '';
        return {
          id: requestId,
          object: 'chat.completion.chunk' as const,
          created,
          model,
          choices: [{
            index: 0,
            delta: {
              content: text
            },
            finish_reason: null
          }]
        };
      } else if (deltaType === 'input_json_delta') {
        // tool_use 的 JSON 参数增量
        const partialJson = event.delta?.partial_json || '';
        
        // 累积 JSON
        const currentBuffer = state.toolInputBuffers.get(index) || '';
        state.toolInputBuffers.set(index, currentBuffer + partialJson);
        
        // 检查是否第一次发送此 tool 的 arguments
        const hasSentStart = state.hasSentToolCallStart.get(index) || false;
        
        if (!hasSentStart) {
          state.hasSentToolCallStart.set(index, true);
        }
        
        // 返回 tool_calls 的 arguments 增量
        return {
          id: requestId,
          object: 'chat.completion.chunk' as const,
          created,
          model,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index,
                id: state.toolIdMap.get(index) || '',
                type: 'function' as const,
                function: {
                  name: state.toolNameMap.get(index) || '',
                  arguments: partialJson
                }
              }]
            },
            finish_reason: null
          }]
        };
      } else if (deltaType === 'thinking_delta') {
        // thinking 内容增量
        const thinking = event.delta?.thinking || '';
        return {
          id: requestId,
          object: 'chat.completion.chunk' as const,
          created,
          model,
          choices: [{
            index: 0,
            delta: {
              reasoning_content: thinking
            },
            finish_reason: null
          }]
        };
      } else if (deltaType === 'signature_delta') {
        // thinking signature 增量（某些模型如 Claude 3.7+ 支持）
        // OpenAI 格式没有直接对应的字段，可以忽略或放入 reasoning_content
        return {
          id: requestId,
          object: 'chat.completion.chunk' as const,
          created,
          model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: null
          }]
        };
      }
      
      // 未知类型，返回空 chunk
      return {
        id: requestId,
        object: 'chat.completion.chunk' as const,
        created,
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: null
        }]
      };
    }

    case 'content_block_stop': {
      // content_block_stop -> 空 chunk（某些客户端需要）
      return {
        id: requestId,
        object: 'chat.completion.chunk' as const,
        created,
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: null
        }]
      };
    }

    case 'message_delta': {
      // message_delta -> finish_reason 和最终 usage
      const stopReason = mapAnthropicToOpenAIFinishReason(event.delta?.stop_reason);
      
      // 计算 usage，包含缓存 token
      let usage: OpenAIStreamChunk['usage'] = undefined;
      if (event.usage) {
        const inputTokens = event.usage.input_tokens || 0;
        const outputTokens = event.usage.output_tokens || 0;
        const cacheCreationTokens = event.usage.cache_creation_input_tokens || 0;
        const cacheReadTokens = event.usage.cache_read_input_tokens || 0;
        
        usage = {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens
        };
        
        // 如果有缓存 token，添加详细信息
        if (cacheCreationTokens > 0 || cacheReadTokens > 0) {
          usage.prompt_tokens_details = {
            cached_tokens: cacheCreationTokens + cacheReadTokens
          };
        }
      }
      
      return {
        id: requestId,
        object: 'chat.completion.chunk' as const,
        created,
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: stopReason
        }],
        usage
      };
    }

    case 'message_stop': {
      // message_stop -> 不需要额外 chunk（某些实现返回 null）
      return null;
    }

    case 'ping':
      // Ignore ping events, do not forward downstream
      return null;

    case 'error':
      // Return error chunk so downstream client is notified
      return {
        id: requestId,
        object: 'chat.completion.chunk' as const,
        created,
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'error' as any,
        }],
      };

    default:
      return null;
  }
}

/**
 * 解析完整的 SSE 块（可能包含多行）
 * 
 * 参考 LiteLLM 实现：litellm/llms/anthropic/experimental_pass_through/adapters/streaming_iterator.py
 * 使用队列管理 SSE 事件，确保 event 和 data 正确配对
 */
export function parseSSEBlock(sseBlock: string): Array<{ event?: string; data: any }> {
  const results: Array<{ event?: string; data: any }> = [];
  const lines = sseBlock.split('\n');
  let currentEvent: string | undefined;
  let currentData: string | undefined;

  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 跳过空行
    if (!trimmedLine) {
      // 空行表示一个完整的 SSE 块结束
      if (currentData) {
        // 处理之前累积的 data
        try {
          const parsed = JSON.parse(currentData);
          results.push({
            event: currentEvent,
            data: parsed
          });
          currentEvent = undefined;
          currentData = undefined;
        } catch {
          // 忽略解析错误
        }
      }
      continue;
    }

    // 处理 event 行
    if (trimmedLine.startsWith('event:')) {
      currentEvent = trimmedLine.slice(6).trim();
    } 
    // 处理 data 行
    else if (trimmedLine.startsWith('data:')) {
      const dataValue = trimmedLine.slice(5).trim();
      
      // 跳过 [DONE] 标记
      if (dataValue === '[DONE]') {
        continue;
      }
      
      // 累积 data（某些 SSE 可能有多行 data）
      currentData = dataValue;
    }
  }

  // 处理最后一个未完成的 SSE 块
  if (currentData) {
    try {
      const parsed = JSON.parse(currentData);
      results.push({
        event: currentEvent,
        data: parsed
      });
    } catch {
      // 忽略解析错误
    }
  }

  return results;
}
