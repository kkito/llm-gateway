// src/converters/format-adapter.ts
import type { ChatRequest, ChatResponse, ChatStreamChunk } from './canonical/types.js';

export type FormatName = 'chat' | 'anthropic' | 'responses' | 'response-api';

/** 有状态流式转换器：一条上游 chunk -> 0..n 条下游 chunk；flush 收尾 */
export interface StreamConverter {
  transform(chunk: any): any[];
  flush(): any[];
}

/** 每种格式实现此适配器，仅与 canonical(chat) 互转 */
export interface FormatAdapter {
  name: FormatName;
  toChatRequest(req: any): ChatRequest;
  fromChatRequest(chat: ChatRequest): any;
  toChatResponse(resp: any): ChatResponse;
  fromChatResponse(chat: ChatResponse): any;
  createUpstreamStream(): StreamConverter;   // 上游格式 chunk -> ChatStreamChunk[]
  createDownstreamStream(): StreamConverter; // ChatStreamChunk[] -> 客户端格式 SSE
}
