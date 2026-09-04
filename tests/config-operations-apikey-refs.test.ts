import { describe, it, expect } from 'vitest';
import { renameApiKeyRefInConfig, removeApiKeyRefFromConfig } from '../src/config-operations.js';
import type { ProxyConfig } from '../src/config.js';

describe('renameApiKeyRefInConfig', () => {
  it('updates $$oldName$$ to $$newName$$ in all models', () => {
    const config: ProxyConfig = {
      models: [
        { customModel: 'm1', realModel: 'gpt-4', apiKey: '$$old-name$$', baseUrl: 'https://api.openai.com', provider: 'openai' },
        { customModel: 'm2', realModel: 'gpt-3.5', apiKey: 'sk-literal', baseUrl: 'https://api.openai.com', provider: 'openai' },
        { customModel: 'm3', realModel: 'claude-3', apiKey: '$$old-name$$', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
      ],
    };
    const result = renameApiKeyRefInConfig(config, 'old-name', 'new-name');
    expect(result.models[0].apiKey).toBe('$$new-name$$');
    expect(result.models[1].apiKey).toBe('sk-literal');
    expect(result.models[2].apiKey).toBe('$$new-name$$');
  });

  it('is idempotent when oldName === newName', () => {
    const config: ProxyConfig = {
      models: [
        { customModel: 'm1', realModel: 'gpt-4', apiKey: '$$same$$', baseUrl: 'https://api.openai.com', provider: 'openai' },
      ],
    };
    const result = renameApiKeyRefInConfig(config, 'same', 'same');
    expect(result.models[0].apiKey).toBe('$$same$$');
  });

  it('does not modify unrelated $$name$$ refs', () => {
    const config: ProxyConfig = {
      models: [
        { customModel: 'm1', realModel: 'gpt-4', apiKey: '$$other-key$$', baseUrl: 'https://api.openai.com', provider: 'openai' },
      ],
    };
    const result = renameApiKeyRefInConfig(config, 'unrelated', 'new-name');
    expect(result.models[0].apiKey).toBe('$$other-key$$');
  });
});

describe('removeApiKeyRefFromConfig', () => {
  it('leaves $$name$$ refs intact so they produce clear errors at request time', () => {
    const config: ProxyConfig = {
      models: [
        { customModel: 'm1', realModel: 'gpt-4', apiKey: '$$to-delete$$', baseUrl: 'https://api.openai.com', provider: 'openai' },
        { customModel: 'm2', realModel: 'gpt-3.5', apiKey: 'sk-keep', baseUrl: 'https://api.openai.com', provider: 'openai' },
      ],
    };
    const result = removeApiKeyRefFromConfig(config, 'to-delete');
    expect(result.models[0].apiKey).toBe('$$to-delete$$');
    expect(result.models[1].apiKey).toBe('sk-keep');
  });

  it('returns the same config instance (no-op)', () => {
    const config: ProxyConfig = {
      models: [
        { customModel: 'm1', realModel: 'gpt-4', apiKey: '$$other$$', baseUrl: 'https://api.openai.com', provider: 'openai' },
      ],
    };
    const result = removeApiKeyRefFromConfig(config, 'non-existent');
    expect(result).toBe(config);
  });
});
