import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { loadFullConfig, saveConfig, addApiKey, deleteApiKey, getApiKey, getApiKeyOptions, type ApiKey } from '../src/config.js';
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApiKeysRoute } from '../src/admin/routes/api-keys.js';

describe('API Key management', () => {
  const testConfigPath = join(tmpdir(), 'test-api-keys-config.json');
  const testLogDir = join(tmpdir(), 'test-api-keys-logs-' + Date.now());

  beforeEach(() => {
    mkdirSync(testLogDir, { recursive: true });
    const initialConfig = {
      models: [],
      apiKeys: []
    };
    writeFileSync(testConfigPath, JSON.stringify(initialConfig));
  });

  afterEach(() => {
    try {
      unlinkSync(testConfigPath);
      rmSync(testLogDir, { recursive: true, force: true });
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

      saveConfig({ models: [], apiKeys }, testConfigPath);

      const config = loadFullConfig(testConfigPath);
      expect(config.apiKeys).toHaveLength(1);
      expect(config.apiKeys?.[0].name).toBe('New Key');
    });
  });

  describe('API Keys Route - POST without provider', () => {
    it('should accept POST request without provider field', async () => {
      // 创建测试路由
      const app = new Hono();
      // 路由注册在 / 路径，因为路由文件内部已经定义了 /admin/api-keys
      app.route('/', createApiKeysRoute({ configPath: testConfigPath }));

      // 模拟表单提交，不包含 provider 字段
      const formData = new URLSearchParams();
      formData.append('name', 'Test Key Without Provider');
      formData.append('key', 'sk-test-no-provider');
      // 故意不添加 provider 字段

      const response = await app.request('/admin/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData.toString()
      });

      // 应该成功，不应该提示"请填写所有必填字段"
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).not.toContain('请填写所有必填字段');
      expect(html).toContain('API Key 添加成功');
    });
  });
});