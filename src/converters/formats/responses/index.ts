// src/converters/formats/responses/index.ts
import type { FormatAdapter } from '../../format-adapter.js';
import { responsesToChatRequest, chatToResponsesRequest } from './request.js';
import { responsesToChatResponse, chatToResponsesResponse } from './response.js';
import { ResponsesUpstreamStream, ResponsesDownstreamStream } from './stream.js';

export const responsesAdapter: FormatAdapter = {
  name: 'responses',
  toChatRequest: responsesToChatRequest,
  fromChatRequest: chatToResponsesRequest,
  toChatResponse: responsesToChatResponse,
  fromChatResponse: chatToResponsesResponse,
  createUpstreamStream: () => new ResponsesUpstreamStream(),
  createDownstreamStream: () => new ResponsesDownstreamStream(),
};
