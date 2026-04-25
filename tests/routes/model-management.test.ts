import { describe, it, expect } from 'vitest';
import type { ProviderConfig } from '../../src/config.js';

describe('Model Copy Logic', () => {
  function copyModel(models: ProviderConfig[], modelName: string, timestamp: string): ProviderConfig[] {
    const source = models.find(m => m.customModel === modelName);
    if (!source) throw new Error(`Model not found: ${modelName}`);

    const newModelName = `${modelName}-${timestamp}`;
    const copied: ProviderConfig = {
      ...source,
      customModel: newModelName,
      hidden: false,
    };

    return [copied, ...models];
  }

  it('should copy model with timestamp suffix and place it first', () => {
    const models: ProviderConfig[] = [
      { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key1', baseUrl: 'https://api.openai.com', provider: 'openai' },
      { customModel: 'claude', realModel: 'claude-3', apiKey: 'key2', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
    ];

    const result = copyModel(models, 'gpt-4', Date.now().toString());

    expect(result[0].customModel).toMatch(/^gpt-4-\d{13}$/);
    expect(result[0].realModel).toBe('gpt-4');
    expect(result[0].hidden).toBe(false);
    expect(result.length).toBe(3);
    expect(result[1].customModel).toBe('gpt-4');
    expect(result[2].customModel).toBe('claude');
  });

  it('should copy all config fields including limits and prices', () => {
    const models: ProviderConfig[] = [
      {
        customModel: 'gpt-4',
        realModel: 'gpt-4',
        apiKey: 'key1',
        baseUrl: 'https://api.openai.com',
        provider: 'openai',
        desc: '测试模型',
        inputPricePer1M: 10,
        outputPricePer1M: 30,
        cachedPricePer1M: 1,
        limits: [{ type: 'requests', period: 'day', max: 100 }],
      },
    ];

    const result = copyModel(models, 'gpt-4', '20260425143022');

    expect(result[0].desc).toBe('测试模型');
    expect(result[0].inputPricePer1M).toBe(10);
    expect(result[0].outputPricePer1M).toBe(30);
    expect(result[0].cachedPricePer1M).toBe(1);
    expect(result[0].limits).toHaveLength(1);
    expect(result[0].hidden).toBe(false);
  });

  it('should throw if model not found', () => {
    const models: ProviderConfig[] = [];
    expect(() => copyModel(models, 'nonexistent', '20260425143022')).toThrow('Model not found: nonexistent');
  });
});
