// src/converters/formats/anthropic/index.ts
import type { FormatAdapter } from '../../format-adapter.js';
import { anthropicToChatRequest, chatToAnthropicRequest } from './request.js';
import { anthropicToChatResponse, chatToAnthropicResponse } from './response.js';
import { AnthropicUpstreamStream, AnthropicDownstreamStream } from './stream.js';

export const anthropicAdapter: FormatAdapter = {
  name: 'anthropic',
  toChatRequest: anthropicToChatRequest,
  fromChatRequest: chatToAnthropicRequest,
  toChatResponse: anthropicToChatResponse,
  fromChatResponse: chatToAnthropicResponse,
  createUpstreamStream: () => new AnthropicUpstreamStream(),
  createDownstreamStream: () => new AnthropicDownstreamStream(),
};
