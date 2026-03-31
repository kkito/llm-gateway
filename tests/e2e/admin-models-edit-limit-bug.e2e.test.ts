import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import { UsageTracker } from '../../src/lib/usage-tracker.js';
import type { ProviderConfig, ApiKey } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, rmSync, mkdirSync } from 'fs';

describe('Admin Models Edit - 限制管理独立页面 E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    // 重置单例状态
    UsageTracker.resetInstance();
    testLogDir = join(tmpdir(), 'test-limit-page-' + Date.now());
    testConfigPath = join(testLogDir, 'config.json');
    mkdirSync(testLogDir, { recursive: true });

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);

    // 创建测试配置（包含 API Keys 和有限制的模型）
    const testConfig: ProviderConfig[] = [
      {
        customModel: 'gateway-LongCat-Flash-Lite',
        realModel: 'gpt-4o-mini',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai',
        limits: [
          {
            type: 'requests',
            period: 'hours',
            periodValue: 4,
            max: 4
          },
          {
            type: 'requests',
            period: 'day',
            max: 400
          }
        ]
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

    // 创建配置文件（包含 models 和 apiKeys）
    writeFileSync(
      testConfigPath,
      JSON.stringify({ models: testConfig, apiKeys: testApiKeys }, null, 2)
    );

    app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    // 重置单例状态
    UsageTracker.resetInstance();
    globalThis.fetch = originalFetch;
    rmSync(testLogDir, { recursive: true, force: true });
  });

  describe('编辑模型页面 - 限制管理入口', () => {
    it('编辑页面应该包含"管理限制规则"链接', async () => {
      const response = await app.request('/admin/models/edit/gateway-LongCat-Flash-Lite');
      expect(response.status).toBe(200);

      const html = await response.text();

      // 页面应该包含管理限制规则的链接
      expect(html).toContain('管理限制规则');
      expect(html).toContain('/admin/models/gateway-LongCat-Flash-Lite/limits');
    });

    it('编辑页面不应该包含内联的限制配置表单', async () => {
      const response = await app.request('/admin/models/edit/gateway-LongCat-Flash-Lite');
      expect(response.status).toBe(200);

      const html = await response.text();

      // 页面不应该包含旧的内联限制配置元素
      expect(html).not.toContain('id="limitsContainer"');
      expect(html).not.toContain('function addLimitCard()');
      expect(html).not.toContain('添加限制规则');
    });
  });

  describe('限制管理页面功能', () => {
    it('限制管理页面应该正常加载并显示现有规则', async () => {
      const response = await app.request('/admin/models/gateway-LongCat-Flash-Lite/limits');
      expect(response.status).toBe(200);

      const html = await response.text();

      // 页面应该包含模型名称
      expect(html).toContain('gateway-LongCat-Flash-Lite');

      // 页面应该包含现有的限制规则
      expect(html).toContain('按请求次数');
      expect(html).toContain('4 小时');
      expect(html).toContain('400');
    });

    it('限制管理页面应该包含添加规则表单', async () => {
      const response = await app.request('/admin/models/gateway-LongCat-Flash-Lite/limits');
      expect(response.status).toBe(200);

      const html = await response.text();

      // 页面应该包含添加规则表单
      expect(html).toContain('添加规则');
      expect(html).toContain('限制类型');
      expect(html).toContain('action="/admin/models/gateway-LongCat-Flash-Lite/limits/add"');
    });

    it('限制管理页面应该包含删除按钮', async () => {
      const response = await app.request('/admin/models/gateway-LongCat-Flash-Lite/limits');
      expect(response.status).toBe(200);

      const html = await response.text();

      // 页面应该包含删除按钮
      expect(html).toContain('删除');
      expect(html).toContain('data-delete-url');
    });

    it('限制管理页面应该包含返回列表链接', async () => {
      const response = await app.request('/admin/models/gateway-LongCat-Flash-Lite/limits');
      expect(response.status).toBe(200);

      const html = await response.text();

      // 页面应该包含返回模型列表的链接
      expect(html).toContain('返回模型列表');
      expect(html).toContain('/admin/models');
    });
  });

  describe('添加限制规则', () => {
    it('添加按请求次数限制规则', async () => {
      const formData = new URLSearchParams();
      formData.append('type', 'requests');
      formData.append('period', 'day');
      formData.append('max', '100');

      const response = await app.request(
        '/admin/models/gateway-LongCat-Flash-Lite/limits/add',
        {
          method: 'POST',
          body: formData
        }
      );

      expect(response.status).toBe(302); // 重定向

      // 验证添加后的配置
      const configResponse = await app.request('/admin/models/gateway-LongCat-Flash-Lite/limits');
      const html = await configResponse.text();
      expect(html).toContain('100');
    });

    it('添加按小时限制规则', async () => {
      const formData = new URLSearchParams();
      formData.append('type', 'requests');
      formData.append('period', 'hours');
      formData.append('periodValue', '2');
      formData.append('max', '10');

      const response = await app.request(
        '/admin/models/gateway-LongCat-Flash-Lite/limits/add',
        {
          method: 'POST',
          body: formData
        }
      );

      expect(response.status).toBe(302);

      // 验证添加后的配置
      const configResponse = await app.request('/admin/models/gateway-LongCat-Flash-Lite/limits');
      const html = await configResponse.text();
      expect(html).toContain('2 小时');
      expect(html).toContain('10');
    });
  });

  describe('删除限制规则', () => {
    it('删除第一条限制规则', async () => {
      // 先获取当前规则列表
      const response = await app.request('/admin/models/gateway-LongCat-Flash-Lite/limits');
      expect(response.status).toBe(200);

      // 删除索引为 0 的规则
      const deleteResponse = await app.request(
        '/admin/models/gateway-LongCat-Flash-Lite/limits/delete/0',
        {
          method: 'POST'
        }
      );

      expect(deleteResponse.status).toBe(302);

      // 验证删除后的配置
      const configResponse = await app.request('/admin/models/gateway-LongCat-Flash-Lite/limits');
      const html = await configResponse.text();
      expect(configResponse.status).toBe(200);
    });
  });

  describe('模型列表页面', () => {
    it('模型列表应该包含"管理限制"按钮', async () => {
      const response = await app.request('/admin/models');
      expect(response.status).toBe(200);

      const html = await response.text();

      // 应该包含管理限制按钮
      expect(html).toContain('管理限制');
      expect(html).toContain('/admin/models/gateway-LongCat-Flash-Lite/limits');
    });
  });
});
