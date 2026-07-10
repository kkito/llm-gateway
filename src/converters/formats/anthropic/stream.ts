// src/converters/formats/anthropic/stream.ts
import { convertAnthropicStreamEventToOpenAI, parseSSEBlock } from './anthropic-to-openai.js';
import {
  convertOpenAIStreamChunkToAnthropic, createOpenAIToAnthropicStreamState,
  formatAnthropicEventToSSE, parseOpenAISSEData,
} from './openai-to-anthropic.js';
import type { StreamConverter } from '../../format-adapter.js';
import type { ChatStreamChunk } from '../../canonical/types.js';

/** 上游 anthropic SSE -> canonical chat chunk[]（有状态） */
export class AnthropicUpstreamStream implements StreamConverter {
  private requestId = `req_${Date.now()}`;
  private model = 'model';
  transform(sseBlock: string): any[] {
    const events = parseSSEBlock(sseBlock);
    const out: ChatStreamChunk[] = [];
    for (const ev of events) {
      const chunk = ev.data ? convertAnthropicStreamEventToOpenAI(ev.data, this.requestId, this.model) : null;
      if (chunk) out.push(chunk as ChatStreamChunk);
    }
    return out;
  }
  flush(): any[] { return []; }
}

/** canonical chat chunk[] -> 客户端 anthropic SSE（有状态） */
export class AnthropicDownstreamStream implements StreamConverter {
  private state = createOpenAIToAnthropicStreamState();
  transform(chunk: ChatStreamChunk): string[] {
    const events = convertOpenAIStreamChunkToAnthropic(chunk as any, this.state);
    return events.map((e) => formatAnthropicEventToSSE(e));
  }
  flush(): string[] { return []; }
}

/** 解析一条 openai SSE chunk 文本为 ChatStreamChunk（供 router 上游链路使用） */
export function parseOpenAISSEChunkToChat(line: string): ChatStreamChunk | null {
  const parsed = parseOpenAISSEData(line);
  return (parsed?.data ?? null) as ChatStreamChunk | null;
}
