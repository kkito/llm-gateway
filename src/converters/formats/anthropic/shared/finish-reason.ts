/**
 * 统一的 finish_reason / stop_reason 映射
 * 避免在两个转换器中重复定义
 */

/**
 * Anthropic stop_reason → OpenAI finish_reason（流式）
 */
export function mapAnthropicToOpenAIFinishReason(
  stopReason: string | null | undefined
): string | null {
  if (!stopReason) return null;

  switch (stopReason) {
    case 'end_turn':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
      return 'length';
    case 'stop_sequence':
      return 'stop';
    default:
      return 'stop';
  }
}

/**
 * OpenAI finish_reason → Anthropic stop_reason
 */
export function mapOpenAIToAnthropicFinishReason(
  finishReason: string | null
): string | null {
  if (!finishReason) return null;

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
