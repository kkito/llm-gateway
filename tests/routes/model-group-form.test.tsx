import { describe, it, expect } from 'vitest';
import type { ProviderConfig } from '../../src/config.js';
import { getVisibleModels } from '../../src/admin/routes/model-group-form.js';

describe('getVisibleModels', () => {
  it('should return all models when no hidden field is set', () => {
    const models: ProviderConfig[] = [
      { customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'url', provider: 'openai' },
      { customModel: 'model-b', realModel: 'real-b', apiKey: 'key', baseUrl: 'url', provider: 'openai' },
    ];
    const result = getVisibleModels({ models });
    expect(result).toHaveLength(2);
    expect(result.map(m => m.customModel)).toEqual(['model-a', 'model-b']);
  });

  it('should filter out models with hidden: true', () => {
    const models: ProviderConfig[] = [
      { customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'url', provider: 'openai' },
      { customModel: 'model-b', realModel: 'real-b', apiKey: 'key', baseUrl: 'url', provider: 'openai', hidden: true },
      { customModel: 'model-c', realModel: 'real-c', apiKey: 'key', baseUrl: 'url', provider: 'openai' },
    ];
    const result = getVisibleModels({ models });
    expect(result).toHaveLength(2);
    expect(result.map(m => m.customModel)).toEqual(['model-a', 'model-c']);
  });

  it('should keep models with hidden: false', () => {
    const models: ProviderConfig[] = [
      { customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'url', provider: 'openai', hidden: false },
      { customModel: 'model-b', realModel: 'real-b', apiKey: 'key', baseUrl: 'url', provider: 'openai', hidden: true },
    ];
    const result = getVisibleModels({ models });
    expect(result).toHaveLength(1);
    expect(result[0].customModel).toBe('model-a');
  });

  it('should return empty array when all models are hidden', () => {
    const models: ProviderConfig[] = [
      { customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'url', provider: 'openai', hidden: true },
    ];
    const result = getVisibleModels({ models });
    expect(result).toHaveLength(0);
  });

  it('should return empty array when models is empty', () => {
    const result = getVisibleModels({ models: [] });
    expect(result).toHaveLength(0);
  });
});
