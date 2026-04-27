/**
 * 统一的流式 usage 提取逻辑
 * 处理 OpenAI 和 Anthropic 两种格式的 usage 字段
 */

export interface StreamUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

/**
 * 从 OpenAI 格式的 SSE chunk 中提取 usage
 */
export function extractUsageFromOpenAIChunk(chunk: any): StreamUsage | null {
  const usage = chunk.usage;
  if (!usage) return null;

  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;

  const result: StreamUsage = {
    promptTokens,
    completionTokens,
    totalTokens: usage.total_tokens ?? promptTokens + completionTokens,
  };

  // 缓存 token 信息
  const cachedTokens =
    usage.prompt_tokens_details?.cached_tokens ??
    usage.cache_read_input_tokens ??
    usage.cache_creation_input_tokens;

  if (cachedTokens) {
    result.cachedTokens = cachedTokens;
  }

  return result;
}

/**
 * 从 Anthropic 格式的 SSE chunk 中提取 usage
 */
export function extractUsageFromAnthropicChunk(chunk: any): StreamUsage | null {
  const usage = chunk.usage;
  if (!usage) return null;

  const promptTokens = usage.input_tokens ?? 0;
  const completionTokens = usage.output_tokens ?? 0;

  const result: StreamUsage = {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };

  // 缓存 token 信息
  const cachedTokens =
    usage.cache_read_input_tokens ??
    usage.cache_creation_input_tokens ??
    usage.prompt_tokens_details?.cached_tokens;

  if (cachedTokens) {
    result.cachedTokens = cachedTokens;
  }

  return result;
}

/**
 * 从 SSE chunks 数组中反向查找最后一条含 usage 的记录
 */
export function findFinalUsageFromChunks(
  chunks: string[],
  format: 'openai' | 'anthropic'
): StreamUsage | null {
  const extract = format === 'openai' ? extractUsageFromOpenAIChunk : extractUsageFromAnthropicChunk;

  for (let i = chunks.length - 1; i >= 0; i--) {
    try {
      const chunkText = chunks[i];
      // 处理 SSE 格式（可能有 event:/data: 前缀）
      const lines = chunkText.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          const jsonStr = line.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;
          const parsed = JSON.parse(jsonStr);
          const usage = extract(parsed);
          if (usage) return usage;
        }
      }
    } catch {
      // ignore parse errors
    }
  }
  return null;
}
