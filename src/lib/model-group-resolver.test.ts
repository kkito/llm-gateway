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
      const result = resolver.resolveModelGroup(modelGroups, 'pool1');
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
      const result = await resolver.findAvailableModel(
        ['model-a'],
        config,
        tempLogDir
      );
      expect(result.model).toBe('model-a');
      expect(result.provider.customModel).toBe('model-a');
    });

    it('should handle missing model config', async () => {
      try {
        await resolver.findAvailableModel(['nonexistent'], config, tempLogDir);
        expect.unreachable('Should have thrown ModelGroupExhaustedError');
      } catch (error) {
        if (error instanceof ModelGroupExhaustedError) {
          expect(error.triedModels[0].exceeded).toBe(false);
          expect(error.triedModels[0].message).toBe('Model config not found');
        } else {
          throw error;
        }
      }
    });

    it('should throw ModelGroupExhaustedError when all models exceeded', async () => {
      const configWithLimits: ProviderConfig[] = [
        {
          customModel: 'model-a',
          realModel: 'gpt-4',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com',
          provider: 'openai',
          limits: [
            {
              type: 'requests',
              period: 'day',
              max: 0  // 设置为 0 以便立即超过限制
            }
          ]
        }
      ];

      await expect(
        resolver.findAvailableModel(['model-a'], configWithLimits, tempLogDir)
      ).rejects.toThrow(ModelGroupExhaustedError);
    });

    it('should track all tried models before throwing', async () => {
      const configWithLimits: ProviderConfig[] = [
        {
          customModel: 'model-a',
          realModel: 'gpt-4',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com',
          provider: 'openai',
          limits: [
            {
              type: 'requests',
              period: 'day',
              max: 0
            }
          ]
        },
        {
          customModel: 'model-b',
          realModel: 'gpt-3.5',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com',
          provider: 'openai',
          limits: [
            {
              type: 'requests',
              period: 'day',
              max: 0
            }
          ]
        }
      ];

      try {
        await resolver.findAvailableModel(['model-a', 'model-b'], configWithLimits, tempLogDir);
        expect.unreachable('Should have thrown ModelGroupExhaustedError');
      } catch (error) {
        if (error instanceof ModelGroupExhaustedError) {
          expect(error.triedModels.length).toBe(2);
          expect(error.triedModels.map(m => m.model)).toEqual(['model-a', 'model-b']);
        } else {
          throw error;
        }
      }
    });
  });
});
