import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadFullConfig, saveConfig, type ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';

describe('ModelGroup Config Validation', () => {
  const tempConfigPath = join(tmpdir(), 'llm-gateway-test-config.json');

  afterEach(() => {
    if (existsSync(tempConfigPath)) {
      unlinkSync(tempConfigPath);
    }
  });

  it('should validate duplicate group names', () => {
    const config: ProxyConfig = {
      models: [
        { customModel: 'model-a', realModel: 'gpt-4', apiKey: 'sk', baseUrl: 'https://api.openai.com', provider: 'openai' },
        { customModel: 'model-b', realModel: 'gpt-4', apiKey: 'sk', baseUrl: 'https://api.openai.com', provider: 'openai' }
      ],
      modelGroups: [
        { name: 'pool1', models: ['model-a'] },
        { name: 'pool1', models: ['model-b'] }
      ]
    };
    saveConfig(config, tempConfigPath);
    expect(() => loadFullConfig(tempConfigPath)).toThrow('Duplicate model group name');
  });

  it('should validate model references exist', () => {
    const config: ProxyConfig = {
      models: [{
        customModel: 'model-a',
        realModel: 'gpt-4',
        apiKey: 'sk',
        baseUrl: 'https://api.openai.com',
        provider: 'openai'
      }],
      modelGroups: [
        { name: 'pool1', models: ['model-a', 'model-b'] }
      ]
    };
    saveConfig(config, tempConfigPath);
    expect(() => loadFullConfig(tempConfigPath)).toThrow('Model "model-b" in group "pool1" not found');
  });

  it('should validate non-empty models array', () => {
    const config: ProxyConfig = {
      models: [],
      modelGroups: [
        { name: 'pool1', models: [] }
      ]
    };
    saveConfig(config, tempConfigPath);
    expect(() => loadFullConfig(tempConfigPath)).toThrow('models array cannot be empty');
  });

  it('should allow missing modelGroups field', () => {
    const config: ProxyConfig = {
      models: [{
        customModel: 'model-a',
        realModel: 'gpt-4',
        apiKey: 'sk',
        baseUrl: 'https://api.openai.com',
        provider: 'openai'
      }]
    };
    saveConfig(config, tempConfigPath);
    expect(() => loadFullConfig(tempConfigPath)).not.toThrow();
  });
});
