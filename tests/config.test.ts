import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, findProvider, getProxyDir, ProviderConfig, hashPassword, verifyPassword, ApiKey, addApiKey, getApiKey, updateApiKey, deleteApiKey, getApiKeyOptions, UserApiKey, ProxyConfig } from '../src/config.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('config', () => {
  const testConfigPath = join(tmpdir(), 'test-proxy-config.json');
  
  const testConfig: ProviderConfig[] = [
    {
      customModel: 'my-gpt4',
      realModel: 'gpt-4',
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.openai.com',
      provider: 'openai'
    },
    {
      customModel: 'my-claude',
      realModel: 'claude-3-5-sonnet-20241022',
      apiKey: 'sk-ant-test-key',
      baseUrl: 'https://api.anthropic.com',
      provider: 'anthropic'
    }
  ];

  beforeEach(() => {
    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));
  });

  afterEach(() => {
    try {
      unlinkSync(testConfigPath);
    } catch {}
  });

  describe('loadConfig', () => {
    it('should load valid config from file', () => {
      const config = loadConfig(testConfigPath);
      expect(config).toHaveLength(2);
      expect(config[0].customModel).toBe('my-gpt4');
    });

    it('should throw error for invalid JSON', () => {
      // 先删除文件再重新创建，避免 beforeEach 的影响
      unlinkSync(testConfigPath);
      writeFileSync(testConfigPath, 'invalid json');
      expect(() => loadConfig(testConfigPath)).toThrow('Invalid JSON');
    });

    it('should throw error for missing required fields', () => {
      unlinkSync(testConfigPath);
      writeFileSync(testConfigPath, JSON.stringify([{ customModel: 'test' }]));
      expect(() => loadConfig(testConfigPath)).toThrow('Missing required field');
    });

    it('should throw error for non-array config', () => {
      unlinkSync(testConfigPath);
      writeFileSync(testConfigPath, JSON.stringify({ customModel: 'test' }));
      expect(() => loadConfig(testConfigPath)).toThrow('Config must have a "models" array');
    });

    it('should throw error for file not found', () => {
      expect(() => loadConfig('/nonexistent/path/config.json')).toThrow('Config file not found');
    });

    it('should load new format config with models array', () => {
      unlinkSync(testConfigPath);
      const newFormatConfig = {
        models: [
          {
            customModel: 'my-gpt4',
            realModel: 'gpt-4',
            apiKey: 'sk-test-key',
            baseUrl: 'https://api.openai.com',
            provider: 'openai' as const
          }
        ]
      };
      writeFileSync(testConfigPath, JSON.stringify(newFormatConfig));
      const config = loadConfig(testConfigPath);
      expect(config).toHaveLength(1);
      expect(config[0].customModel).toBe('my-gpt4');
    });

    it('should maintain backward compatibility with array format', () => {
      unlinkSync(testConfigPath);
      const arrayConfig = [
        {
          customModel: 'my-gpt4',
          realModel: 'gpt-4',
          apiKey: 'sk-test-key',
          baseUrl: 'https://api.openai.com',
          provider: 'openai' as const
        }
      ];
      writeFileSync(testConfigPath, JSON.stringify(arrayConfig));
      const config = loadConfig(testConfigPath);
      expect(config).toHaveLength(1);
      expect(config[0].customModel).toBe('my-gpt4');
    });
  });

  describe('findProvider', () => {
    it('should find provider by customModel', () => {
      const provider = findProvider(testConfig, 'my-gpt4');
      expect(provider).toBeDefined();
      expect(provider?.realModel).toBe('gpt-4');
    });

    it('should return null for unknown model', () => {
      const provider = findProvider(testConfig, 'unknown-model');
      expect(provider).toBeNull();
    });
  });

  describe('getProxyDir', () => {
    it('should return default proxy directory in home', () => {
      const proxyDir = getProxyDir();
      expect(proxyDir).toContain('.llm-gateway');
    });
  });

  describe('hashPassword', () => {
    it('should return SHA256 hash of password', () => {
      const password = 'test123';
      const hash = hashPassword(password);
      expect(hash).toBeDefined();
      expect(hash).toHaveLength(64); // SHA256 hex length
    });

    it('should return same hash for same password', () => {
      const password = 'mySecretPassword';
      const hash1 = hashPassword(password);
      const hash2 = hashPassword(password);
      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different passwords', () => {
      const hash1 = hashPassword('password1');
      const hash2 = hashPassword('password2');
      expect(hash1).not.toBe(hash2);
    });

    it('should include salt in hash', async () => {
      const password = 'test';
      const hash = hashPassword(password);
      // Hash should be different from plain SHA256
      const crypto = await import('crypto');
      const plainHash = crypto.createHash('sha256').update(password).digest('hex');
      expect(hash).not.toBe(plainHash);
    });
  });

  describe('verifyPassword', () => {
    it('should return true for correct password', () => {
      const password = 'correctPassword123';
      const hash = hashPassword(password);
      expect(verifyPassword(password, hash)).toBe(true);
    });

    it('should return false for incorrect password', () => {
      const password = 'correctPassword123';
      const hash = hashPassword(password);
      expect(verifyPassword('wrongPassword', hash)).toBe(false);
    });

    it('should return false for empty password', () => {
      const password = 'somePassword';
      const hash = hashPassword(password);
      expect(verifyPassword('', hash)).toBe(false);
    });

    it('should handle special characters in password', () => {
      const password = 'p@$$w0rd!#$%^&*()';
      const hash = hashPassword(password);
      expect(verifyPassword(password, hash)).toBe(true);
      expect(verifyPassword('wrong password', hash)).toBe(false);
    });
  });

  describe('ApiKey operations', () => {
    const testApiKeys: ApiKey[] = [
      {
        id: 'test-uuid-1',
        name: 'My OpenAI Key',
        key: 'sk-test-openai',
        provider: 'openai',
        createdAt: 1700000000000,
        updatedAt: 1700000000000
      },
      {
        id: 'test-uuid-2',
        name: 'My Anthropic Key',
        key: 'sk-ant-test-anthropic',
        provider: 'anthropic',
        createdAt: 1700000000000,
        updatedAt: 1700000000000
      }
    ];

    describe('addApiKey', () => {
      it('should add a new API key', () => {
        const result = addApiKey([], 'Test Key', 'sk-test');
        expect(result).toBeDefined();
        expect(result.name).toBe('Test Key');
        expect(result.key).toBe('sk-test');
        expect(result.id).toBeDefined();
        expect(result.createdAt).toBeDefined();
      });
    });

    describe('getApiKey', () => {
      it('should find API key by id', () => {
        const result = getApiKey(testApiKeys, 'test-uuid-1');
        expect(result).toBeDefined();
        expect(result?.name).toBe('My OpenAI Key');
      });

      it('should return null for unknown id', () => {
        const result = getApiKey(testApiKeys, 'unknown-id');
        expect(result).toBeNull();
      });
    });

    describe('updateApiKey', () => {
      it('should update API key', () => {
        const result = updateApiKey(testApiKeys, 'test-uuid-1', { name: 'Updated Key' });
        expect(result[0].name).toBe('Updated Key');
      });

      it('should throw error for unknown id', () => {
        expect(() => updateApiKey(testApiKeys, 'unknown', { name: 'Test' })).toThrow('API Key not found');
      });
    });

    describe('deleteApiKey', () => {
      it('should delete API key', () => {
        const result = deleteApiKey(testApiKeys, 'test-uuid-1');
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('test-uuid-2');
      });

      it('should throw error for unknown id', () => {
        expect(() => deleteApiKey(testApiKeys, 'unknown')).toThrow('API Key not found');
      });
    });

    describe('getApiKeyOptions', () => {
      it('should return options without key field', () => {
        const result = getApiKeyOptions(testApiKeys);
        expect(result[0]).not.toHaveProperty('key');
        expect(result[0]).toHaveProperty('id');
        expect(result[0]).toHaveProperty('name');
        expect(result[0]).toHaveProperty('provider');
      });
    });
  });

  describe('UserApiKey config', () => {
    it('should accept valid userApiKeys config', () => {
      const config: ProxyConfig = {
        models: [],
        userApiKeys: [
          { name: '用户 A', apikey: 'sk-lg-abc123def456', desc: '测试用' },
          { name: '用户 B', apikey: 'sk-lg-xyz789uvw012' }
        ]
      };
      expect(config.userApiKeys).toHaveLength(2);
    });

    it('should accept empty userApiKeys array', () => {
      const config: ProxyConfig = {
        models: [],
        userApiKeys: []
      };
      expect(config.userApiKeys).toHaveLength(0);
    });

    it('should accept undefined userApiKeys', () => {
      const config: ProxyConfig = {
        models: []
      };
      expect(config.userApiKeys).toBeUndefined();
    });
  });
});
