import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadFullConfig, saveConfig, addApiKey, deleteApiKey, getApiKey, getApiKeyOptions, type ApiKey } from '../src/config.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('API Key management', () => {
  const testConfigPath = join(tmpdir(), 'test-api-keys-config.json');

  beforeEach(() => {
    const initialConfig = {
      models: [],
      apiKeys: []
    };
    writeFileSync(testConfigPath, JSON.stringify(initialConfig));
  });

  afterEach(() => {
    try {
      unlinkSync(testConfigPath);
    } catch {}
  });

  describe('loadFullConfig with apiKeys', () => {
    it('should load config with apiKeys', () => {
      const configWithKeys = {
        models: [],
        apiKeys: [
          {
            id: 'test-id',
            name: 'Test Key',
            key: 'sk-test',
            provider: 'openai' as const,
            createdAt: 1700000000000,
            updatedAt: 1700000000000
          }
        ]
      };
      writeFileSync(testConfigPath, JSON.stringify(configWithKeys));
      
      const config = loadFullConfig(testConfigPath);
      expect(config.apiKeys).toHaveLength(1);
      expect(config.apiKeys?.[0].name).toBe('Test Key');
    });

    it('should return empty array if apiKeys not present', () => {
      const config = loadFullConfig(testConfigPath);
      expect(config.apiKeys).toEqual([]);
    });
  });

  describe('saveConfig with apiKeys', () => {
    it('should save apiKeys to config file', () => {
      const apiKeys: ApiKey[] = [
        {
          id: 'new-id',
          name: 'New Key',
          key: 'sk-new',
          provider: 'anthropic',
          createdAt: 1700000000000,
          updatedAt: 1700000000000
        }
      ];
      
      saveConfig(testConfigPath, [], undefined, apiKeys);
      
      const config = loadFullConfig(testConfigPath);
      expect(config.apiKeys).toHaveLength(1);
      expect(config.apiKeys?.[0].name).toBe('New Key');
    });
  });
});