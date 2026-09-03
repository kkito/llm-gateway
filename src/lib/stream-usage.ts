/**
 * 统一的流式 usage 提取逻辑
 * 处理 OpenAI 和 Anthropic 两种格式的 usage 字段
 */

import { SystemLogger, type SystemLogContext } from './system-logger.js';

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
    usage.input_tokens_details?.cached_tokens ??
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
    usage.input_tokens_details?.cached_tokens ??
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
  format: 'openai' | 'anthropic',
  context?: SystemLogContext
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
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      SystemLogger.getInstance()?.logError('usage_parse_error', errMsg, chunks[i], context);
    }
  }
  return null;
}

/**
 * 判断一个 OpenAI 兼容 SSE 流是否已经带有标准的"结束"标志。
 * 结束标志满足任一即可：
 *   - 出现 data: [DONE] 哨兵
 *   - 出现任一非 null 的 finish_reason（choices 内或 chunk 顶层）
 * 用于兜底补发：若流结束时既无 [DONE] 也无非 null finish_reason（如 muse-spark 这类
 * 只回选 finish_reason:null + usage/cost 的上游），网关需手动补一个标准终止 chunk，
 * 否则严格客户端会报 "Model stream ended without a finish reason"。
 */
export function hasStreamEnded(chunks: string[]): boolean {
  for (const chunkText of chunks) {
    const lines = chunkText.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (jsonStr === '[DONE]') return true;
      if (!jsonStr) continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const choices = parsed.choices;
        if (Array.isArray(choices)) {
          for (const choice of choices) {
            if (choice?.finish_reason) return true;
          }
        }
        if (parsed.finish_reason) return true;
      } catch {
        // 单块解析失败不影响整体判定
      }
    }
  }
  return false;
}
