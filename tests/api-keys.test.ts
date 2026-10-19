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

  describe('API Keys Route - keyHint 脱敏展示', () => {
    const mount = () => {
      const app = new Hono();
      app.route('/', createApiKeysRoute({ configPath: testConfigPath, onConfigChange: () => {} }));
      return app;
    };
    const postForm = (app: Hono, path: string, params: Record<string, string>) =>
      app.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString()
      });

    it('列表页应显示脱敏 hint 且不泄露明文', async () => {
      const app = mount();
      await postForm(app, '/admin/api-keys', { name: 'Hint Key', key: 'sk-live-abcdef123456' });

      const response = await app.request('/admin/api-keys');
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('*****3456');
      expect(html).not.toContain('sk-live-abcdef123456');
    });

    it('编辑页密码框为空，仅上方展示 hint；留空提交不修改原密钥', async () => {
      const app = mount();
      await postForm(app, '/admin/api-keys', { name: 'Edit Key', key: 'sk-live-abcdef123456' });
      const config = loadFullConfig(testConfigPath);
      const id = config.apiKeys?.[0].id as string;

      const editPage = await app.request(`/admin/api-keys/edit/${id}`);
      const editHtml = await editPage.text();
      // hint 仅展示，不回填进输入框 value
      expect(editHtml).toContain('当前密钥：*****3456');
      expect(editHtml).not.toMatch(/id="key"[^>]*value=/);

      // 留空提交：名称更新、密钥保持不变
      await postForm(app, `/admin/api-keys/edit/${id}`, { name: 'Edit Key Renamed', key: '' });
      const after = loadFullConfig(testConfigPath);
      expect(after.apiKeys?.[0].name).toBe('Edit Key Renamed');
      expect(after.apiKeys?.[0].key).toBe('sk-live-abcdef123456');
    });

    it('编辑页输入新值时应替换密钥', async () => {
      const app = mount();
      await postForm(app, '/admin/api-keys', { name: 'Replace Key', key: 'sk-old-1111' });
      const config = loadFullConfig(testConfigPath);
      const id = config.apiKeys?.[0].id as string;

      await postForm(app, `/admin/api-keys/edit/${id}`, { name: 'Replace Key', key: 'sk-new-9999' });
      const after = loadFullConfig(testConfigPath);
      expect(after.apiKeys?.[0].key).toBe('sk-new-9999');
    });
  });

  describe('API Keys Route - POST without provider', () => {
    it('should accept POST request without provider field', async () => {
      // 创建测试路由
      const app = new Hono();
      // 路由注册在 / 路径，因为路由文件内部已经定义了 /admin/api-keys
      app.route('/', createApiKeysRoute({ configPath: testConfigPath, onConfigChange: () => {} }));

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