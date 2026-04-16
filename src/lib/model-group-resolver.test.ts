import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ModelGroupResolver } from './model-group-resolver.js';
import { ModelGroupExhaustedError } from './model-group-error.js';
import type { ModelGroup, ProviderConfig } from '../config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';

describe('ModelGroupResolver', () => {
  const resolver = new ModelGroupResolver();
  const tempLogDir = join(tmpdir(), 'llm-gateway-test-logs');

  beforeEach(() => {
    if (!existsSync(tempLogDir)) mkdirSync(tempLogDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempLogDir)) rmSync(tempLogDir, { recursive: true, force: true });
  });

  describe('resolveModelGroup', () => {
    const modelGroups: ModelGroup[] = [
      { name: 'pool1', models: ['model-a', 'model-b'] }
    ];

    it('should return model names from group', () => {
      const configs: ProviderConfig[] = [
        { customModel: 'model-a', realModel: 'gpt-4', apiKey: 'sk-a', baseUrl: 'https://api.openai.com', provider: 'openai' },
        { customModel: 'model-b', realModel: 'gpt-3.5-turbo', apiKey: 'sk-b', baseUrl: 'https://api.openai.com', provider: 'openai' }
      ];
      const result = resolver.resolveModelGroup(modelGroups, 'pool1', configs);
      expect(result).toEqual(['model-a', 'model-b']);
    });

    it('should throw when group not found', () => {
      expect(() => resolver.resolveModelGroup(modelGroups, 'nonexistent'))
        .toThrow('Model group "nonexistent" not found');
    });

    it('should throw when modelGroups is undefined', () => {
      expect(() => resolver.resolveModelGroup(undefined, 'pool1'))
        .toThrow('Model group "pool1" not found');
    });

    it('should resolve renamed models via alias lookup', () => {
      const configs: ProviderConfig[] = [
        { customModel: 'model-a', realModel: 'gpt-4', apiKey: 'sk-a', baseUrl: 'https://api.openai.com', provider: 'openai' },
        { customModel: 'model-b', realModel: 'gpt-3.5-turbo', apiKey: 'sk-b', baseUrl: 'https://api.openai.com', provider: 'openai' },
        { customModel: 'model-c-renamed', realModel: 'gemini-pro', apiKey: 'sk-c', baseUrl: 'https://api.openai.com', provider: 'openai' } // renamed from model-c
      ];
      const renamedGroups: ModelGroup[] = [
        { name: 'pool2', models: ['model-a', 'model-c-renamed'] } // using renamed alias
      ];
      const result = resolver.resolveModelGroup(renamedGroups, 'pool2', configs);
      expect(result).toEqual(['model-a', 'model-c-renamed']);
    });

    it('should throw when a model in group has no provider config', () => {
      const configs: ProviderConfig[] = [
        { customModel: 'model-a', realModel: 'gpt-4', apiKey: 'sk-a', baseUrl: 'https://api.openai.com', provider: 'openai' }
      ];
      const missingGroups: ModelGroup[] = [
        { name: 'pool3', models: ['model-a', 'model-missing'] }
      ];
      expect(() => resolver.resolveModelGroup(missingGroups, 'pool3', configs))
        .toThrow('Model "model-missing" in group "pool3" not found in provider configs. Available models: [model-a]');
    });
  });

  describe('findAvailableModel', () => {
    const config: ProviderConfig[] = [
      {
        customModel: 'model-a',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai',
        limits: []
      }
    ];

    it('should return first available model', async () => {
      const result = await resolver.findAvailableModel(['model-a'], config, tempLogDir);
      expect(result.model).toBe('model-a');
      expect(result.provider.customModel).toBe('model-a');
    });

    it('should handle missing model config', async () => {
      await expect(
        resolver.findAvailableModel(['nonexistent'], config, tempLogDir)
      ).rejects.toThrow(ModelGroupExhaustedError);
    });
  });
});