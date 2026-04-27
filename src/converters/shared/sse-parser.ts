import type { SSEParseResult } from './types.js';

/**
 * 解析 SSE 数据行（支持 event 和 data 前缀）
 * 统一版本，带错误日志
 */
export function parseSSEData(
  line: string,
  context?: { requestId?: string; provider?: string }
): SSEParseResult | null {
  const trimmedLine = line.trim();

  // 跳过 SSE 注释行
  if (trimmedLine.startsWith(':')) {
    return null;
  }

  // 处理 event 行
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
  } catch (err) {
    const ctx = context ? `[${context.requestId ?? ''}${context.provider ? '/' + context.provider : ''}]` : '';
    // Note: In production, the caller (stream-handler) logs parse errors via detailLogger.
    // This console.warn is a fallback for development/testing.
    console.warn(`${ctx} SSE parse error: ${err instanceof Error ? err.message : String(err)} | data: ${data.slice(0, 100)}`);
    return null;
  }
}

/**
 * 解析完整的 SSE 块（可能包含多行）
 * 使用队列管理 SSE 事件，确保 event 和 data 正确配对
 */
export function parseSSEBlock(
  sseBlock: string,
  context?: { requestId?: string; provider?: string }
): SSEParseResult[] {
  const results: SSEParseResult[] = [];
  const lines = sseBlock.split('\n');
  let currentEvent: string | undefined;
  let currentData: string | undefined;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // 跳过空行，触发之前累积的事件
    if (!trimmedLine) {
      if (currentData) {
        const parsed = parseSSEData(`data: ${currentData}`, context);
        if (parsed) {
          results.push({
            event: currentEvent,
            data: parsed.data,
          });
        }
        currentEvent = undefined;
        currentData = undefined;
      }
      continue;
    }

    // 跳过注释行
    if (trimmedLine.startsWith(':')) {
      continue;
    }

    // 处理 event 行
    if (trimmedLine.startsWith('event:')) {
      currentEvent = trimmedLine.slice(6).trim();
    }
    // 处理 data 行
    else if (trimmedLine.startsWith('data:')) {
      const dataValue = trimmedLine.slice(5).trim();
      if (dataValue === '[DONE]') {
        continue;
      }
      currentData = dataValue;
    }
  }

  // 处理最后一个未完成的事件
  if (currentData) {
    const parsed = parseSSEData(`data: ${currentData}`, context);
    if (parsed) {
      results.push({ event: currentEvent, data: parsed.data });
    }
  }

  return results;
}
