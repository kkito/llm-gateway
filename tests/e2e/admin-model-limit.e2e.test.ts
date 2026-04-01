import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig, ApiKey, ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, rmSync, readFileSync, mkdirSync } from 'fs';

describe('Admin Model Limit Management E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    testLogDir = join(tmpdir(), 'test-limit-mgmt-' + Date.now());
    testConfigPath = join(testLogDir, 'config.json');
    mkdirSync(testLogDir, { recursive: true });

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);

    // 创建测试配置（包含 API Keys）
    const testModels: ProviderConfig[] = [
      {
        customModel: 'test-gpt4',
        realModel: 'gpt-4',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai'
      }
    ];

    // 创建测试 API Keys
    const testApiKeys: ApiKey[] = [
      {
        id: 'key-1',
        name: 'My OpenAI Key',
        key: 'sk-openai-123',
        createdAt: 1700000000000,
        updatedAt: 1700000000000
      }
    ];

    // 创建测试 ProxyConfig 对象
    const testConfig: ProxyConfig = {
      models: testModels,
      apiKeys: testApiKeys
    };

    // 创建配置文件（包含 models 和 apiKeys）
    writeFileSync(
      testConfigPath,
      JSON.stringify(testConfig, null, 2)
    );

    app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    rmSync(testLogDir, { recursive: true, force: true });
  });

  // 辅助函数：读取配置
  const readConfig = () => JSON.parse(readFileSync(testConfigPath, 'utf-8'));

  // 辅助函数：查找模型
  const findModel = (customModel: string) => {
    const config = readConfig();
    return config.models.find((m: any) => m.customModel === customModel);
  };

  describe('1. 创建模型 - 无限制', () => {
    it('不添加任何限制，验证模型创建成功', async () => {
      const formData = new FormData();
      formData.append('customModel', 'free-model');
      formData.append('realModel', 'gpt-3.5-turbo');
      formData.append('provider', 'openai');
      formData.append('baseUrl', 'https://api.openai.com/v1');
      formData.append('apiKeySource', 'manual');
      formData.append('apiKey', 'sk-manual-key');
      formData.append('desc', 'Free model without limits');

      const response = await app.request('/admin/models', { method: 'POST', body: formData });

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/models');

      // 验证配置
      const model = findModel('free-model');
      expect(model).toBeDefined();
      expect(model.limits).toBeUndefined();
    });
  });

  describe('2. 在限制管理页面添加限制', () => {
    it('为模型添加按天限制规则', async () => {
      // 先创建模型
      const createFormData = new FormData();
      createFormData.append('customModel', 'limited-model');
      createFormData.append('realModel', 'gpt-4');
      createFormData.append('provider', 'openai');
      createFormData.append('baseUrl', 'https://api.openai.com/v1');
      createFormData.append('apiKeySource', 'manual');
      createFormData.append('apiKey', 'sk-test-key');

      await app.request('/admin/models', { method: 'POST', body: createFormData });

      // 通过限制管理页面添加限制
      const limitFormData = new URLSearchParams();
      limitFormData.append('type', 'requests');
      limitFormData.append('period', 'day');
      limitFormData.append('max', '100');

      const response = await app.request(
        '/admin/models/limited-model/limits/add',
        { method: 'POST', body: limitFormData }
      );

      expect(response.status).toBe(302);

      // 验证限制已添加
      const model = findModel('limited-model');
      expect(model.limits).toHaveLength(1);
      expect(model.limits[0].type).toBe('requests');
      expect(model.limits[0].period).toBe('day');
      expect(model.limits[0].max).toBe(100);
    });

    it('为模型添加按小时限制规则', async () => {
      const limitFormData = new URLSearchParams();
      limitFormData.append('type', 'requests');
      limitFormData.append('period', 'hours');
      limitFormData.append('periodValue', '4');
      limitFormData.append('max', '10');

      const response = await app.request(
        '/admin/models/limited-model/limits/add',
        { method: 'POST', body: limitFormData }
      );

      expect(response.status).toBe(302);

      // 验证限制已添加
      const model = findModel('limited-model');
      expect(model.limits).toHaveLength(2);
      expect(model.limits[1].type).toBe('requests');
      expect(model.limits[1].period).toBe('hours');
      expect(model.limits[1].periodValue).toBe(4);
      expect(model.limits[1].max).toBe(10);
    });
  });

  describe('3. 删除限制规则', () => {
    it('删除第一条限制规则', async () => {
      const model = findModel('limited-model');
      expect(model.limits).toHaveLength(2);

      // 删除索引为 0 的限制
      const response = await app.request(
        '/admin/models/limited-model/limits/delete/0',
        { method: 'POST' }
      );

      expect(response.status).toBe(302);

      // 验证剩余限制
      const updatedModel = findModel('limited-model');
      expect(updatedModel.limits).toHaveLength(1);
      expect(updatedModel.limits[0].period).toBe('hours');
    });

    it('删除所有限制后验证模型恢复为 Free', async () => {
      // 删除最后一条限制
      const response = await app.request(
        '/admin/models/limited-model/limits/delete/0',
        { method: 'POST' }
      );

      expect(response.status).toBe(302);

      // 验证限制已清空
      const updatedModel = findModel('limited-model');
      expect(updatedModel.limits).toBeUndefined();
    });
  });

  describe('4. 限制管理页面功能', () => {
    it('限制管理页面应该正常加载', async () => {
      // 先添加一些限制
      const limitFormData = new URLSearchParams();
      limitFormData.append('type', 'requests');
      limitFormData.append('period', 'day');
      limitFormData.append('max', '50');

      await app.request(
        '/admin/models/test-gpt4/limits/add',
        { method: 'POST', body: limitFormData }
      );

      // 访问限制管理页面
      const response = await app.request('/admin/models/test-gpt4/limits');
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('限制规则管理');
      expect(html).toContain('test-gpt4');
      expect(html).toContain('添加规则');
    });

    it('模型列表页应该包含管理限制按钮', async () => {
      const response = await app.request('/admin/models');
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('管理限制');
      expect(html).toContain('/admin/models/test-gpt4/limits');
    });

    it('编辑模型页应该包含管理限制规则链接', async () => {
      const response = await app.request('/admin/models/edit/test-gpt4');
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('管理限制规则');
      expect(html).toContain('/admin/models/test-gpt4/limits');
    });

    it('编辑模型页不应该包含内联限制配置', async () => {
      const response = await app.request('/admin/models/edit/test-gpt4');
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).not.toContain('id="limitsContainer"');
      expect(html).not.toContain('function addLimitCard()');
    });
  });

  describe('5. 按金额限制', () => {
    it('添加按金额限制规则', async () => {
      const limitFormData = new URLSearchParams();
      limitFormData.append('type', 'cost');
      limitFormData.append('max', '10');

      const response = await app.request(
        '/admin/models/test-gpt4/limits/add',
        { method: 'POST', body: limitFormData }
      );

      expect(response.status).toBe(302);

      // 验证限制已添加
      const model = findModel('test-gpt4');
      expect(model.limits).toHaveLength(2);
      expect(model.limits[1].type).toBe('cost');
      expect(model.limits[1].max).toBe(10);
    });
  });

  describe('6. 编辑模型时保留限制配置', () => {
    it('编辑模型基本信息时保留限制配置', async () => {
      const model = findModel('test-gpt4');
      const originalLimits = model.limits;
      expect(originalLimits).toHaveLength(2);

      // 编辑模型基本信息
      const editFormData = new FormData();
      editFormData.append('customModel', 'test-gpt4');
      editFormData.append('realModel', 'gpt-4-updated');
      editFormData.append('provider', 'openai');
      editFormData.append('baseUrl', 'https://api.openai.com/v1');
      editFormData.append('apiKeySource', 'manual');
      editFormData.append('apiKey', 'sk-test-key-updated');
      editFormData.append('desc', 'Updated description');

      const response = await app.request('/admin/models/edit/test-gpt4', {
        method: 'POST',
        body: editFormData
      });

      expect(response.status).toBe(302);

      // 验证限制配置保留
      const updatedModel = findModel('test-gpt4');
      expect(updatedModel.limits).toHaveLength(2);
      expect(updatedModel.limits[0].type).toBe('requests');
      expect(updatedModel.limits[1].type).toBe('cost');
    });
  });
});
