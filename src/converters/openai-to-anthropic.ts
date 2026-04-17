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
