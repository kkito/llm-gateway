import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import type { ProxyConfig } from '../../src/config.js';

describe('Admin Model Management E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let originalFetch: typeof globalThis.fetch;

  const testConfig: ProxyConfig = {
    models: [
      { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key1', baseUrl: 'https://api.openai.com', provider: 'openai' },
      { customModel: 'claude', realModel: 'claude-3', apiKey: 'key2', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
    ],
    adminPassword: undefined,
    apiKeys: [],
  };

  beforeAll(() => {
    originalFetch = globalThis.fetch;
    testLogDir = join(tmpdir(), 'test-model-mgmt-' + Date.now());
    testConfigPath = join(testLogDir, 'config.json');
    mkdirSync(testLogDir, { recursive: true });
    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);
    app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    rmSync(testLogDir, { recursive: true, force: true });
  });

  describe('Model Copy', () => {
    it('should copy a model and redirect to edit page', async () => {
      const response = await app.request('/admin/models/copy/gpt-4', { method: 'POST' });
      expect(response.status).toBe(302);

      const location = response.headers.get('Location');
      expect(location).toContain('/admin/models/edit/gpt-4-');

      // 验证配置文件中模型数量变为 3
      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      expect(config.models.length).toBe(3);
      expect(config.models[0].customModel).toMatch(/^gpt-4-\d{13}$/);
      expect(config.models[0].hidden).toBe(false);
    });
  });

  describe('Model Hidden/Toggle', () => {
    it('should hide a model and move it to the end', async () => {
      const response = await app.request('/admin/models/toggle-hidden/gpt-4', { method: 'POST' });
      expect(response.status).toBe(302);

      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      const lastModel = config.models[config.models.length - 1];
      expect(lastModel.customModel).toBe('gpt-4');
      expect(lastModel.hidden).toBe(true);
    });

    it('should unhide a model and move it to first', async () => {
      const response = await app.request('/admin/models/toggle-hidden/gpt-4', { method: 'POST' });
      expect(response.status).toBe(302);

      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      const firstModel = config.models[0];
      expect(firstModel.customModel).toBe('gpt-4');
      expect(firstModel.hidden).toBe(false);
    });
  });

  describe('Model List Page', () => {
    it('should render hide/show button with full text for visible model', async () => {
      const response = await app.request('/admin/models');
      expect(response.status).toBe(200);

      const html = await response.text();
      // 可见模型的隐藏按钮应该显示完整文字「隐藏」
      expect(html).toContain('title="隐藏"');
      // 按钮文字也应该是完整的「隐藏」
      expect(html).toMatch(/>隐藏<\/button>/);
    });

    it('should render hide/show button with full text for hidden model', async () => {
      // 先隐藏一个模型
      await app.request('/admin/models/toggle-hidden/gpt-4', { method: 'POST' });

      const response = await app.request('/admin/models');
      expect(response.status).toBe(200);

      const html = await response.text();
      // 隐藏模型的显示按钮应该显示完整文字「显示」
      expect(html).toContain('title="显示"');
      // 按钮文字也应该是完整的「显示」
      expect(html).toMatch(/>显示<\/button>/);
    });

    it('should render move up/down buttons with correct titles', async () => {
      const response = await app.request('/admin/models');
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('title="上移"');
      expect(html).toContain('title="下移"');
    });

    it('should render copy button with correct title', async () => {
      const response = await app.request('/admin/models');
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('title="复制"');
    });

    it('should render edit link for each model', async () => {
      const response = await app.request('/admin/models');
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('/admin/models/edit/gpt-4');
      expect(html).toContain('/admin/models/edit/claude');
    });

    it('should render delete button with correct title', async () => {
      const response = await app.request('/admin/models');
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('title="删除"');
    });

    it('should have correct data attributes on all action buttons', async () => {
      const response = await app.request('/admin/models');
      expect(response.status).toBe(200);

      const html = await response.text();

      // 验证上移按钮
      expect(html).toMatch(/data-move-url="\/admin\/models\/move\/[^"]+" data-direction="up"/);
      // 验证下移按钮
      expect(html).toMatch(/data-move-url="\/admin\/models\/move\/[^"]+" data-direction="down"/);
      // 验证隐藏/显示按钮
      expect(html).toMatch(/data-toggle-url="\/admin\/models\/toggle-hidden\/[^"]+"/);
      // 验证复制按钮
      expect(html).toMatch(/data-copy-url="\/admin\/models\/copy\/[^"]+"/);
      // 验证删除按钮
      expect(html).toMatch(/data-delete-url="\/admin\/models\/delete\/[^"]+"/);
      // 验证编辑链接
      expect(html).toMatch(/href="\/admin\/models\/edit\/[^"]+"/);
      // 验证限制链接
      expect(html).toMatch(/href="\/admin\/models\/[^"]+\/limits"/);
    });

    it('should have valid JavaScript in script tag (no broken escape sequences)', async () => {
      const response = await app.request('/admin/models');
      expect(response.status).toBe(200);

      const html = await response.text();
      const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      expect(scriptMatch).not.toBeNull();

      const scriptContent = scriptMatch![1];

      // 验证脚本中没有未转义的实际换行符出现在字符串字面量中
      // 如果 confirm/alert 中的 \n 被错误解析为实际换行，会导致语法错误
      expect(() => {
        new Function(scriptContent);
      }).not.toThrow();
    });
  });
});
