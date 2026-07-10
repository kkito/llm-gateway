// src/converters/formats/anthropic/response.ts
import { convertAnthropicResponseToOpenAI } from './openai-to-anthropic.js';
import { convertOpenAIResponseToAnthropic } from './anthropic-to-openai.js';
import type { ChatResponse } from '../../canonical/types.js';

/** anthropic 响应 -> canonical chat 响应 */
export function anthropicToChatResponse(resp: any): ChatResponse {
  return convertAnthropicResponseToOpenAI(resp) as unknown as ChatResponse;
}

/** canonical chat 响应 -> anthropic 响应 */
export function chatToAnthropicResponse(chat: ChatResponse): any {
  return convertOpenAIResponseToAnthropic(chat as any);
}
