import type { FormatAdapter } from './adapters/adapter.interface.js';
import { openAIChatAdapter } from './adapters/openai-chat.js';
import { anthropicMessagesAdapter } from './adapters/anthropic-messages.js';

// ── Built-in adapters ────────────────────────────────────────

const adapters = new Map<string, FormatAdapter>([
  ['openai-chat', openAIChatAdapter],
  ['anthropic-messages', anthropicMessagesAdapter],
]);

/**
 * Register a custom format adapter (e.g., for future Responses API).
 */
export function registerAdapter(format: string, adapter: FormatAdapter): void {
  adapters.set(format, adapter);
}

/**
 * Get a format adapter by its format name.
 */
export function getAdapter(format: string): FormatAdapter {
  const adapter = adapters.get(format);
  if (!adapter) {
    throw new Error(`Unknown format: ${format}. Available: ${[...adapters.keys()].join(', ')}`);
  }
  return adapter;
}

// ── Re-export everything ──────────────────────────────────────

export type { FormatAdapter } from './adapters/adapter.interface.js';
export { openAIChatAdapter } from './adapters/openai-chat.js';
export { anthropicMessagesAdapter } from './adapters/anthropic-messages.js';
