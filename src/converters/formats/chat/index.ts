// src/converters/formats/chat/index.ts
import type { FormatAdapter, StreamConverter } from '../../format-adapter.js';
import type { ChatRequest, ChatResponse, ChatStreamChunk } from '../../canonical/types.js';

/**
 * chat 即 canonical，但流式链路在 ChatStreamChunk 层级交换，
 * 因此上游/下游流负责把 OpenAI SSE 文本 <-> ChatStreamChunk 解析/序列化
 * （content 不变，仅做边界切分与 JSON 解析）。
 */
class OpenAISSEStream implements StreamConverter {
  private buffer = '';
  transform(raw: string): ChatStreamChunk[] {
    this.buffer += raw;
    const parts = this.buffer.split('\n\n');
    this.buffer = parts.pop() ?? '';
    const out: ChatStreamChunk[] = [];
    for (const part of parts) {
      const dataLine = part.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const data = dataLine.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try { out.push(JSON.parse(data) as ChatStreamChunk); } catch { /* skip */ }
    }
    return out;
  }
  flush(): ChatStreamChunk[] { return []; }
}

class ChatDownstreamSSE implements StreamConverter {
  transform(chunk: ChatStreamChunk): string[] {
    return [`data: ${JSON.stringify(chunk)}\n\n`];
  }
  flush(): string[] { return []; }
}

export const chatAdapter: FormatAdapter = {
  name: 'chat',
  toChatRequest(req: ChatRequest): ChatRequest {
    return req;
  },
  fromChatRequest(chat: ChatRequest): ChatRequest {
    return chat;
  },
  toChatResponse(resp: ChatResponse): ChatResponse {
    return resp;
  },
  fromChatResponse(chat: ChatResponse): ChatResponse {
    return chat;
  },
  createUpstreamStream(): StreamConverter {
    return new OpenAISSEStream();
  },
  createDownstreamStream(): StreamConverter {
    return new ChatDownstreamSSE();
  },
};
