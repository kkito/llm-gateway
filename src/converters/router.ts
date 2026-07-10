// src/converters/router.ts
import type { FormatAdapter, FormatName } from './format-adapter.js';
import { chatAdapter } from './formats/chat/index.js';
import { anthropicAdapter } from './formats/anthropic/index.js';
import { responsesAdapter } from './formats/responses/index.js';

const REGISTRY: Record<string, FormatAdapter> = {
  chat: chatAdapter,
  openai: chatAdapter,
  anthropic: anthropicAdapter,
  responses: responsesAdapter,
  'response-api': responsesAdapter,
};

export interface ChainPlan {
  passthrough: boolean;
  source: FormatName;
  provider: FormatName;
  sourceAdapter: FormatAdapter;
  providerAdapter: FormatAdapter;
}

export function resolveConverterChain(source: FormatName, provider: FormatName): ChainPlan {
  const sourceAdapter = REGISTRY[source];
  const providerAdapter = REGISTRY[provider];
  if (!sourceAdapter || !providerAdapter) {
    throw new Error(`unknown format: source=${source} provider=${provider}`);
  }
  return {
    passthrough: source === provider,
    source,
    provider,
    sourceAdapter,
    providerAdapter,
  };
}
