export {
  mapAnthropicToOpenAIFinishReason,
  mapOpenAIToAnthropicFinishReason,
} from './finish-reason.js';

export {
  createStreamConverterState,
  createOpenAIToAnthropicStreamState,
} from './types.js';

export type {
  AnthropicStreamEvent,
  OpenAIStreamChunk,
  StreamConverterState,
  OpenAIToAnthropicStreamState,
  SSEParseResult,
} from './types.js';
