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

  return {
    model: anthropicRequest.model,
    messages,
    tools: convertAnthropicToolsToOpenAI(anthropicRequest.tools),
    max_tokens: anthropicRequest.max_tokens,
    stream: anthropicRequest.stream,
    temperature: anthropicRequest.temperature
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
