import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig, ModelGroup, ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, rmSync, mkdirSync } from 'fs';

describe('User Home Page E2E', () => {
  let testLogDir: string;
  let testConfigPath: string;

  describe('Model Group 展示', () => {
    it('有 modelGroups 时应该显示模型组选择器', async () => {
      testLogDir = join(tmpdir(), 'test-home-model-group-' + Date.now());
      testConfigPath = join(testLogDir, 'config.json');
      mkdirSync(testLogDir, { recursive: true });

      const testModels: ProviderConfig[] = [
        {
          customModel: 'gpt-4o',
          realModel: 'gpt-4o',
          apiKey: 'sk-test-key',
          baseUrl: 'https://api.openai.com/v1',
          provider: 'openai'
        },
        {
          customModel: 'claude-3-5-sonnet',
          realModel: 'claude-3-5-sonnet-20241022',
          apiKey: 'sk-ant-key',
          baseUrl: 'https://api.anthropic.com',
          provider: 'anthropic'
        },
        {
          customModel: 'gpt-4o-mini',
          realModel: 'gpt-4o-mini',
          apiKey: 'sk-test-mini',
          baseUrl: 'https://api.openai.com/v1',
          provider: 'openai'
        }
      ];

      const testModelGroups: ModelGroup[] = [
        {
          name: 'best-models',
          models: ['gpt-4o', 'claude-3-5-sonnet'],
          desc: '最佳模型组合'
        },
        {
          name: 'cheap-models',
          models: ['gpt-4o-mini'],
          desc: '低成本模型'
        }
      ];

      const testConfig: ProxyConfig = {
        models: testModels,
        modelGroups: testModelGroups
      };

      writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const logger = new Logger(testLogDir);
      const detailLogger = new DetailLogger(testLogDir);
      const app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);

      try {
        const response = await app.request('/user/main');
        expect(response.status).toBe(200);

        const html = await response.text();

        // 应该显示模型数量和模型组数量
        expect(html).toContain('2 个模型');
        expect(html).toContain('2 个模型组');

        // 应该显示模型选择器
        expect(html).toContain('id="model-select"');
        expect(html).toContain('<option value="gpt-4o">');
        expect(html).toContain('<option value="claude-3-5-sonnet">');

        // 应该显示模型组选择器
        expect(html).toContain('id="model-group-select"');
        expect(html).toContain('<option value="best-models">');
        expect(html).toContain('<option value="cheap-models">');

        // 应该显示切换选项
        expect(html).toContain('id="toggle-model"');
        expect(html).toContain('id="toggle-group"');
        expect(html).toContain('模型');
        expect(html).toContain('模型组');

        // 应该显示模型组描述
        expect(html).toContain('最佳模型组合');
      } finally {
        rmSync(testLogDir, { recursive: true, force: true });
      }
    });

    it('模型组选择器不应该包含默认空选项', async () => {
      testLogDir = join(tmpdir(), 'test-home-model-group-no-default-' + Date.now());
      testConfigPath = join(testLogDir, 'config.json');
      mkdirSync(testLogDir, { recursive: true });

      const testModels: ProviderConfig[] = [
        {
          customModel: 'gpt-4o',
          realModel: 'gpt-4o',
          apiKey: 'sk-test-key',
          baseUrl: 'https://api.openai.com/v1',
          provider: 'openai'
        }
      ];

      const testModelGroups: ModelGroup[] = [
        {
          name: 'best-models',
          models: ['gpt-4o'],
          desc: '最佳模型组合'
        }
      ];

      const testConfig: ProxyConfig = {
        models: testModels,
        modelGroups: testModelGroups
      };

      writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const logger = new Logger(testLogDir);
      const detailLogger = new DetailLogger(testLogDir);
      const app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);

      try {
        const response = await app.request('/user/main');
        expect(response.status).toBe(200);

        const html = await response.text();

        // 应该有模型组选择器
        expect(html).toContain('id="model-group-select"');

        // 提取模型组选择器的内容
        const groupSelectRegex = /<select[^>]*id="model-group-select"[^>]*>[\s\S]*?<\/select>/;
        const groupSelectMatch = html.match(groupSelectRegex);
        expect(groupSelectMatch).not.toBeNull();

        const groupSelectHtml = groupSelectMatch[0];

        // 不应该包含默认空选项
        expect(groupSelectHtml).not.toContain('<option value="">');
        expect(groupSelectHtml).not.toContain('选择模型组');

        // 应该直接包含模型组选项
        expect(groupSelectHtml).toContain('<option');
        expect(groupSelectHtml).toContain('value="best-models"');
      } finally {
        rmSync(testLogDir, { recursive: true, force: true });
      }
    });

    it('有 modelGroups 时模型选择器应该默认可用', async () => {
      testLogDir = join(tmpdir(), 'test-home-model-enabled-' + Date.now());
      testConfigPath = join(testLogDir, 'config.json');
      mkdirSync(testLogDir, { recursive: true });

      const testModels: ProviderConfig[] = [
        {
          customModel: 'gpt-4o',
          realModel: 'gpt-4o',
          apiKey: 'sk-test-key',
          baseUrl: 'https://api.openai.com/v1',
          provider: 'openai'
        }
      ];

      const testModelGroups: ModelGroup[] = [
        {
          name: 'best-models',
          models: ['gpt-4o'],
          desc: '最佳模型组合'
        }
      ];

      const testConfig: ProxyConfig = {
        models: testModels,
        modelGroups: testModelGroups
      };

      writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const logger = new Logger(testLogDir);
      const detailLogger = new DetailLogger(testLogDir);
      const app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);

      try {
        const response = await app.request('/user/main');
        expect(response.status).toBe(200);

        const html = await response.text();

        // 有 modelGroups 时，模型组应该默认选中（模型选择器默认禁用）
        const modelSelectRegex = /<select[^>]*id="model-select"[^>]*>/;
        const modelSelectMatch = html.match(modelSelectRegex);
        expect(modelSelectMatch).not.toBeNull();

        const modelSelectHtml = modelSelectMatch[0];
        expect(modelSelectHtml).toContain('class="input-value"');
        expect(modelSelectHtml).toContain('disabled');

        // 模型组选择器应该默认可用（不应该是 disabled）
        const groupSelectRegex = /<select[^>]*id="model-group-select"[^>]*>/;
        const groupSelectMatch = html.match(groupSelectRegex);
        expect(groupSelectMatch).not.toBeNull();

        const groupSelectHtml = groupSelectMatch[0];
        expect(groupSelectHtml).not.toContain('disabled');
      } finally {
        rmSync(testLogDir, { recursive: true, force: true });
      }
    });

    it('没有 modelGroups 时应该只显示模型选择器', async () => {
      testLogDir = join(tmpdir(), 'test-home-no-model-group-' + Date.now());
      testConfigPath = join(testLogDir, 'config.json');
      mkdirSync(testLogDir, { recursive: true });

      const testModels: ProviderConfig[] = [
        {
          customModel: 'gpt-4o',
          realModel: 'gpt-4o',
          apiKey: 'sk-test-key',
          baseUrl: 'https://api.openai.com/v1',
          provider: 'openai'
        }
      ];

      const testConfig: ProxyConfig = {
        models: testModels
        // 没有 modelGroups
      };

      writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const logger = new Logger(testLogDir);
      const detailLogger = new DetailLogger(testLogDir);
      const app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);

      try {
        const response = await app.request('/user/main');
        expect(response.status).toBe(200);

        const html = await response.text();

        // 应该显示模型数量
        expect(html).toContain('1 个可选');

        // 应该显示模型选择器
        expect(html).toContain('id="model-select"');
        expect(html).toContain('<option value="gpt-4o">');

        // 不应该显示模型组选择器（检查特定的 HTML 结构）
        expect(html).not.toContain('id="model-group-select"');
        expect(html).not.toContain('name="model-toggle"');
        expect(html).not.toContain('for="toggle-group"');
      } finally {
        rmSync(testLogDir, { recursive: true, force: true });
      }
    });

    it('modelGroups 为空数组时应该只显示模型选择器', async () => {
      testLogDir = join(tmpdir(), 'test-home-empty-model-group-' + Date.now());
      testConfigPath = join(testLogDir, 'config.json');
      mkdirSync(testLogDir, { recursive: true });

      const testModels: ProviderConfig[] = [
        {
          customModel: 'gpt-4o',
          realModel: 'gpt-4o',
          apiKey: 'sk-test-key',
          baseUrl: 'https://api.openai.com/v1',
          provider: 'openai'
        }
      ];

      const testConfig: ProxyConfig = {
        models: testModels,
        modelGroups: []  // 空数组
      };

      writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const logger = new Logger(testLogDir);
      const detailLogger = new DetailLogger(testLogDir);
      const app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);

      try {
        const response = await app.request('/user/main');
        expect(response.status).toBe(200);

        const html = await response.text();

        // 应该显示模型数量
        expect(html).toContain('1 个可选');

        // 应该显示模型选择器
        expect(html).toContain('id="model-select"');

        // 不应该显示模型组选择器（检查特定的 HTML结构）
        expect(html).not.toContain('id="model-group-select"');
        expect(html).not.toContain('name="model-toggle"');
      } finally {
        rmSync(testLogDir, { recursive: true, force: true });
      }
    });
  });
});