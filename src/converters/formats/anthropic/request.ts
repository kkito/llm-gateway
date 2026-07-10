// src/converters/formats/anthropic/request.ts
import { convertAnthropicRequestToOpenAI } from './anthropic-to-openai.js';
import { convertOpenAIRequestToAnthropic } from './openai-to-anthropic.js';
import type { ChatRequest } from '../../canonical/types.js';

/** anthropic 请求 -> canonical chat 请求 */
export function anthropicToChatRequest(req: any): ChatRequest {
  return convertAnthropicRequestToOpenAI(req) as unknown as ChatRequest;
}

/** canonical chat 请求 -> anthropic 请求 */
export function chatToAnthropicRequest(chat: ChatRequest): any {
  return convertOpenAIRequestToAnthropic(chat as any);
}
