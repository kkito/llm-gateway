import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig, ApiKey, ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, rmSync, readFileSync } from 'fs';

describe('Admin Models Form E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    testLogDir = join(tmpdir(), 'test-models-form-' + Date.now());
    testConfigPath = join(testLogDir, 'config.json');

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);

    // 创建测试模型配置
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
      },
      {
        id: 'key-2',
        name: 'My Anthropic Key',
        key: 'sk-anthropic-456',
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

  describe('新增模型页面', () => {
    it('应显示已配置的 API Key 下拉选项', async () => {
      const response = await app.request('/admin/models/new');
      expect(response.status).toBe(200);
      const html = await response.text();

      // 应该包含两个 API Key 选项
      expect(html).toContain('My OpenAI Key');
      expect(html).toContain('My Anthropic Key');
    });

    it('API Key 下拉选项应只显示名称，不包含 provider', async () => {
      const response = await app.request('/admin/models/new');
      expect(response.status).toBe(200);
      const html = await response.text();

      // 选项文本中不应包含 provider 信息
      // 检查 <option> 标签内的文本，不应出现 (openai) 或 (anthropic)
      const optionRegex = /<option[^>]*>\s*([^<]+)\s*<\/option>/g;
      const matches = html.matchAll(optionRegex);
      for (const match of matches) {
        const optionText = match[1];
        // 排除 "手动输入..." 和 provider 选择框的选项
        if (optionText.includes('手动输入') ||
            optionText.includes('OpenAI') ||
            optionText.includes('Anthropic') ||
            optionText.includes('请选择')) {
          continue;
        }
        // API Key 选项不应包含 provider
        expect(optionText).not.toContain('(openai)');
        expect(optionText).not.toContain('(anthropic)');
      }
    });
  });

  describe('编辑模型页面', () => {
    it('应显示已配置的 API Key 下拉选项', async () => {
      const response = await app.request('/admin/models/edit/test-gpt4');
      expect(response.status).toBe(200);
      const html = await response.text();

      // 应该包含两个 API Key 选项
      expect(html).toContain('My OpenAI Key');
      expect(html).toContain('My Anthropic Key');
    });

    it('API Key 下拉选项应只显示名称，不包含 provider', async () => {
      const response = await app.request('/admin/models/edit/test-gpt4');
      expect(response.status).toBe(200);
      const html = await response.text();

      // 选项文本中不应包含 provider 信息
      const optionRegex = /<option[^>]*>\s*([^<]+)\s*<\/option>/g;
      const matches = html.matchAll(optionRegex);
      for (const match of matches) {
        const optionText = match[1];
        // 排除 "手动输入..." 和 provider 选择框的选项
        if (optionText.includes('手动输入') ||
            optionText.includes('OpenAI') ||
            optionText.includes('Anthropic') ||
            optionText.includes('请选择')) {
          continue;
        }
        // API Key 选项不应包含 provider
        expect(optionText).not.toContain('(openai)');
        expect(optionText).not.toContain('(anthropic)');
      }
    });
  });

  describe('新增模型表单提交', () => {
    it('应该允许通过下拉框选择 API Key 来创建模型', async () => {
      // 使用 apiKeySource 参数选择已保存的 API Key
      const formData = new FormData();
      formData.append('customModel', 'new-model');
      formData.append('realModel', 'gpt-4');
      formData.append('provider', 'openai');
      formData.append('baseUrl', 'https://api.openai.com/v1');
      formData.append('apiKeySource', 'key-1'); // 选择已保存的 API Key
      formData.append('desc', 'Test model');

      const response = await app.request('/admin/models', {
        method: 'POST',
        body: formData
      });

      // 应该成功创建并重定向
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/models');

      // 验证配置已保存
      const savedConfig = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      const newModel = savedConfig.models.find((m: any) => m.customModel === 'new-model');
      expect(newModel).toBeDefined();
      expect(newModel.apiKey).toBe('sk-openai-123'); // 应该使用选中的 API Key
    });

    it('应该允许手动输入 API Key 来创建模型', async () => {
      // 使用手动输入的 API Key
      const formData = new FormData();
      formData.append('customModel', 'manual-key-model');
      formData.append('realModel', 'gpt-3.5-turbo');
      formData.append('provider', 'openai');
      formData.append('baseUrl', 'https://api.openai.com/v1');
      formData.append('apiKeySource', 'manual'); // 手动输入模式
      formData.append('apiKey', 'sk-manual-key-123'); // 手动输入的 Key
      formData.append('desc', 'Manual key test');

      const response = await app.request('/admin/models', {
        method: 'POST',
        body: formData
      });

      // 应该成功创建并重定向
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/models');

      // 验证配置已保存
      const savedConfig = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      const newModel = savedConfig.models.find((m: any) => m.customModel === 'manual-key-model');
      expect(newModel).toBeDefined();
      expect(newModel.apiKey).toBe('sk-manual-key-123'); // 应该使用手动输入的 API Key
    });

    it('当选择手动输入但未提供 API Key 时应报错', async () => {
      const formData = new FormData();
      formData.append('customModel', 'error-model');
      formData.append('realModel', 'gpt-4');
      formData.append('provider', 'openai');
      formData.append('baseUrl', 'https://api.openai.com/v1');
      formData.append('apiKeySource', 'manual'); // 选择手动输入
      // 但没有提供 apiKey
      formData.append('desc', '');

      const response = await app.request('/admin/models', {
        method: 'POST',
        body: formData
      });

      // 应该返回错误页面
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('错误');
      expect(html).toContain('必填字段');
    });

    it('当未提供 apiKeySource 和 apiKey 时应报错', async () => {
      const formData = new FormData();
      formData.append('customModel', 'error-model-2');
      formData.append('realModel', 'gpt-4');
      formData.append('provider', 'openai');
      formData.append('baseUrl', 'https://api.openai.com/v1');
      // 没有提供 apiKeySource 和 apiKey
      formData.append('desc', '');

      const response = await app.request('/admin/models', {
        method: 'POST',
        body: formData
      });

      // 应该返回错误页面
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('错误');
      expect(html).toContain('必填字段');
    });

    it('当选择无效的 apiKeySource ID 时应报错', async () => {
      const formData = new FormData();
      formData.append('customModel', 'error-model-3');
      formData.append('realModel', 'gpt-4');
      formData.append('provider', 'openai');
      formData.append('baseUrl', 'https://api.openai.com/v1');
      formData.append('apiKeySource', 'invalid-key-id'); // 无效的 ID
      formData.append('desc', '');

      const response = await app.request('/admin/models', {
        method: 'POST',
        body: formData
      });

      // 应该返回错误页面
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('错误');
    });
  });

  describe('编辑模型表单提交', () => {
    it('应该允许通过下拉框选择 API Key 来更新模型', async () => {
      const formData = new FormData();
      formData.append('customModel', 'test-gpt4');
      formData.append('realModel', 'gpt-4-updated');
      formData.append('provider', 'openai');
      formData.append('baseUrl', 'https://api.openai.com/v1');
      formData.append('apiKeySource', 'key-1'); // 选择 key-1 (My OpenAI Key)
      formData.append('desc', 'Updated model');

      const response = await app.request('/admin/models/edit/test-gpt4', {
        method: 'POST',
        body: formData
      });

      // 应该成功更新并重定向
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/models');

      // 验证配置已更新
      const savedConfig = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      const updatedModel = savedConfig.models.find((m: any) => m.customModel === 'test-gpt4');
      expect(updatedModel).toBeDefined();
      expect(updatedModel.apiKey).toBe('sk-openai-123'); // 应该使用选中的 API Key
    });

    it('编辑时留空 apiKeySource 和 apiKey 应保持原值', async () => {
      const formData = new FormData();
      formData.append('customModel', 'test-gpt4');
      formData.append('realModel', 'gpt-4');
      formData.append('provider', 'openai');
      formData.append('baseUrl', 'https://api.openai.com/v1');
      // 不填写 apiKeySource 和 apiKey，保持原值
      formData.append('desc', 'Keep original key');

      const response = await app.request('/admin/models/edit/test-gpt4', {
        method: 'POST',
        body: formData
      });

      // 应该成功更新并重定向
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/models');

      // 验证配置已更新但 API Key 保持原值（上一个测试更新为 sk-openai-123）
      const savedConfig = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      const updatedModel = savedConfig.models.find((m: any) => m.customModel === 'test-gpt4');
      expect(updatedModel).toBeDefined();
      expect(updatedModel.apiKey).toBe('sk-openai-123'); // 保持上一次更新的值
    });
  });

  describe('新增模型表单的前端验证逻辑', () => {
    it('新增页面 API Key 输入框初始应有 required 属性', async () => {
      const response = await app.request('/admin/models/new');
      expect(response.status).toBe(200);
      const html = await response.text();

      // 检查 apiKey 输入框是否有 required 属性
      const apiKeyInputRegex = /<input[^>]*id="apiKeyManual"[^>]*>/;
      const match = html.match(apiKeyInputRegex);
      expect(match).toBeDefined();
      expect(match![0]).toContain('required');
    });

    it('新增页面应包含 onchange 处理程序来动态切换 required 属性', async () => {
      const response = await app.request('/admin/models/new');
      expect(response.status).toBe(200);
      const html = await response.text();

      // 检查是否包含 onchange 处理程序
      expect(html).toContain('onchange');
      // 检查处理程序中是否包含 required 属性的设置
      expect(html).toContain('manualInput.required = false');
      expect(html).toContain('manualInput.required = true');
    });

    it('编辑页面 API Key 输入框初始不应有 required 属性', async () => {
      const response = await app.request('/admin/models/edit/test-gpt4');
      expect(response.status).toBe(200);
      const html = await response.text();

      // 检查 apiKey 输入框是否没有 required 属性（编辑模式下 required={!isEdit} 应为 false）
      const apiKeyInputRegex = /<input[^>]*id="apiKeyManual"[^>]*>/;
      const match = html.match(apiKeyInputRegex);
      expect(match).toBeDefined();
      // 编辑模式下 required 属性应该为 required=false 或不包含 required
      expect(match![0]).not.toMatch(/required(?!\s*=\s*["']?false["']?)/);
    });
  });
});
