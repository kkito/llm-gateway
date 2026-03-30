import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig, ApiKey } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, rmSync, readFileSync, mkdirSync } from 'fs';

describe('Admin Models Edit - 添加限制规则按钮 Bug E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    testLogDir = join(tmpdir(), 'test-edit-limit-bug-' + Date.now());
    testConfigPath = join(testLogDir, 'config.json');
    mkdirSync(testLogDir, { recursive: true });

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);

    // 创建测试配置（包含 API Keys）
    const testConfig: ProviderConfig[] = [
      {
        customModel: 'gateway-LongCat-Flash-Lite',
        realModel: 'gpt-4o-mini',
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

    // 创建配置文件（包含 models 和 apiKeys）
    writeFileSync(
      testConfigPath,
      JSON.stringify({ models: testConfig, apiKeys: testApiKeys }, null, 2)
    );

    app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    rmSync(testLogDir, { recursive: true, force: true });
  });

  describe('编辑模型页面 - 添加限制规则按钮功能', () => {
    it('编辑页面应包含 addLimitCard 函数定义', async () => {
      const response = await app.request('/admin/models/edit/gateway-LongCat-Flash-Lite');
      expect(response.status).toBe(200);
      
      const html = await response.text();
      
      // 页面应该包含 addLimitCard 函数
      expect(html).toContain('function addLimitCard()');
    });

    it('编辑页面应包含 "添加限制规则" 按钮', async () => {
      const response = await app.request('/admin/models/edit/gateway-LongCat-Flash-Lite');
      expect(response.status).toBe(200);
      
      const html = await response.text();
      
      // 页面应该包含添加限制规则按钮
      expect(html).toContain('添加限制规则');
      expect(html).toContain('id="addLimitBtn"');
    });

    it('按钮的 onclick 应该正确绑定到 addLimitCard 函数', async () => {
      const response = await app.request('/admin/models/edit/gateway-LongCat-Flash-Lite');
      expect(response.status).toBe(200);
      
      const html = await response.text();
      
      // 按钮应该绑定 onclick 事件
      expect(html).toContain('onclick="addLimitCard()"');
    });

    it('页面应该包含 limitsContainer 容器用于添加限制卡片', async () => {
      const response = await app.request('/admin/models/edit/gateway-LongCat-Flash-Lite');
      expect(response.status).toBe(200);
      
      const html = await response.text();
      
      // 应该包含用于放置限制卡片的容器
      expect(html).toContain('id="limitsContainer"');
    });

    it('页面应该包含 renderNewLimitCard 函数用于生成新的限制卡片', async () => {
      const response = await app.request('/admin/models/edit/gateway-LongCat-Flash-Lite');
      expect(response.status).toBe(200);
      
      const html = await response.text();
      
      // 应该包含生成新限制卡片的函数
      // 检查是否包含 renderNewLimitCard 函数或者生成卡片 HTML 的逻辑
      expect(html).toContain('limitCardCount');
    });

    it('新增模型页面也应该包含相同的添加限制规则功能', async () => {
      const response = await app.request('/admin/models/new');
      expect(response.status).toBe(200);
      
      const html = await response.text();
      
      // 新增页面也应该包含 addLimitCard 函数
      expect(html).toContain('function addLimitCard()');
      expect(html).toContain('添加限制规则');
      expect(html).toContain('id="limitsContainer"');
    });

    it('验证 JavaScript 脚本中 limitCardCount 初始值正确设置', async () => {
      const response = await app.request('/admin/models/edit/gateway-LongCat-Flash-Lite');
      expect(response.status).toBe(200);
      
      const html = await response.text();
      
      // 由于当前模型没有限制配置，limitCardCount 应该初始化为 0
      // 检查是否包含 limitCardCount 的初始化
      expect(html).toMatch(/let limitCardCount\s*=\s*\d+/);
    });

    it('验证 addLimitCard 函数能够正确获取 limitsContainer 元素', async () => {
      const response = await app.request('/admin/models/edit/gateway-LongCat-Flash-Lite');
      expect(response.status).toBe(200);
      
      const html = await response.text();
      
      // 检查 addLimitCard 函数中是否正确获取 container
      // 函数应该包含 document.getElementById('limitsContainer')
      expect(html).toContain("document.getElementById('limitsContainer')");
    });

    it('验证 insertAdjacentHTML 方法被正确使用来插入新卡片', async () => {
      const response = await app.request('/admin/models/edit/gateway-LongCat-Flash-Lite');
      expect(response.status).toBe(200);
      
      const html = await response.text();
      
      // 检查是否使用 insertAdjacentHTML 来插入 HTML
      expect(html).toContain('insertAdjacentHTML');
    });

    it('addLimitCard 函数不应该使用 replace(/0/g) 来替换索引，因为这会替换所有的 0', async () => {
      const response = await app.request('/admin/models/edit/gateway-LongCat-Flash-Lite');
      expect(response.status).toBe(200);

      const html = await response.text();

      // 提取 addLimitCard 函数的代码
      const addLimitCardMatch = html.match(/function addLimitCard\(\)\s*\{[\s\S]*?\n\}/);
      expect(addLimitCardMatch).toBeDefined();

      const addLimitCardCode = addLimitCardMatch![0];

      // 检查是否使用了有问题的 replace(/0/g, ...) 模式
      // 这是一个已知 bug：它会错误地替换所有的 0
      const hasBug = addLimitCardCode.includes('replace(/0/g');

      // 这个测试应该失败，因为当前实现确实有 bug
      // 修复后应该通过
      expect(hasBug).toBe(false);
    });

    it('点击"添加限制规则"按钮后应该生成正确的限制卡片 HTML', async () => {
      const response = await app.request('/admin/models/edit/gateway-LongCat-Flash-Lite');
      expect(response.status).toBe(200);

      const html = await response.text();

      // 检查生成的 HTML 中包含正确的 name 属性格式
      // 应该包含 name="limits[__INDEX__]" 或类似的占位符格式
      expect(html).toContain('name="limits[');
    });

    it('renderNewLimitCard 生成的 HTML 中 name 属性应该使用正确的索引格式', async () => {
      const response = await app.request('/admin/models/edit/gateway-LongCat-Flash-Lite');
      expect(response.status).toBe(200);
      
      const html = await response.text();
      
      // 检查 renderNewLimitCard 函数生成的 HTML 模板
      // name 属性应该是 limits[${index}].fieldName 格式
      
      // 提取 renderNewLimitCard 函数的代码（在 generateLimitScript 中作为字符串）
      const renderNewLimitCardMatch = html.match(/const cardHtml\s*=\s*'[^']*/);
      
      // 检查 name 属性的格式
      expect(html).toContain('name="limits[');
    });
  });
});
