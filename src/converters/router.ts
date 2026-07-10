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

/** openai 与 chat 是同一 canonical 格式的不同命名，归一化后再比较 */
function normalizeFormat(format: FormatName): FormatName {
  return format === 'openai' ? 'chat' : format;
}

export interface ChainPlan {
  passthrough: boolean;
  source: FormatName;
  provider: FormatName;
  sourceAdapter: FormatAdapter;
  providerAdapter: FormatAdapter;
}

export function resolveConverterChain(source: FormatName, provider: FormatName): ChainPlan {
  const normalizedSource = normalizeFormat(source);
  const normalizedProvider = normalizeFormat(provider);
  const sourceAdapter = REGISTRY[source];
  const providerAdapter = REGISTRY[provider];
  if (!sourceAdapter || !providerAdapter) {
    throw new Error(`unknown format: source=${source} provider=${provider}`);
  }
  return {
    passthrough: normalizedSource === normalizedProvider,
    source,
    provider,
    sourceAdapter,
    providerAdapter,
  };
}
