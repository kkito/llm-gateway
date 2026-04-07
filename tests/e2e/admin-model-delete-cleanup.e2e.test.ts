import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig, ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, rmSync, readFileSync, mkdirSync, existsSync } from 'fs';

describe('Admin Model Delete Cleanup E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let tempDir: string;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    tempDir = join(tmpdir(), 'test-model-delete-cleanup-' + Date.now());
    testLogDir = join(tempDir, 'logs');
    testConfigPath = join(tempDir, 'config.json');
    mkdirSync(testLogDir, { recursive: true });

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);

    // 初始配置 - 在 beforeAll 中设置完整的测试数据
    const testConfig: ProxyConfig = {
      models: [
        {
          customModel: 'gpt-4',
          realModel: 'gpt-4',
          apiKey: 'sk-openai-key',
          baseUrl: 'https://api.openai.com/v1',
          provider: 'openai',
          desc: 'GPT-4 模型'
        },
        {
          customModel: 'gpt-3.5',
          realModel: 'gpt-3.5-turbo',
          apiKey: 'sk-openai-key',
          baseUrl: 'https://api.openai.com/v1',
          provider: 'openai',
          desc: 'GPT-3.5 模型'
        },
        {
          customModel: 'claude-3',
          realModel: 'claude-3-opus',
          apiKey: 'sk-anthropic-key',
          baseUrl: 'https://api.anthropic.com',
          provider: 'anthropic',
          desc: 'Claude 3 模型'
        }
      ],
      modelGroups: [
        {
          name: 'gpt-pool',
          models: ['gpt-4', 'gpt-3.5'],
          desc: 'GPT 模型池'
        },
        {
          name: 'mixed-pool',
          models: ['gpt-4', 'claude-3'],
          desc: '混合模型池'
        },
        {
          name: 'single-model-group',
          models: ['claude-3'],
          desc: '单模型组'
        }
      ]
    };
    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('删除模型时清理 Model Group', () => {
    it('删除模型后应该从所有 Model Group 中移除该模型引用', async () => {
      // 删除 gpt-4 模型
      const response = await app.request('/admin/models/delete/gpt-4', {
        method: 'POST'
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/admin/models');

      // 验证配置文件已更新
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as ProxyConfig;

      // 模型应该被删除
      expect(config.models.find(m => m.customModel === 'gpt-4')).toBeUndefined();

      // gpt-pool 中的 gpt-4 应该被移除
      const gptPool = config.modelGroups?.find(g => g.name === 'gpt-pool');
      expect(gptPool).toBeDefined();
      expect(gptPool!.models).not.toContain('gpt-4');
      expect(gptPool!.models).toContain('gpt-3.5');

      // mixed-pool 中的 gpt-4 也应该被移除
      const mixedPool = config.modelGroups?.find(g => g.name === 'mixed-pool');
      expect(mixedPool).toBeDefined();
      expect(mixedPool!.models).not.toContain('gpt-4');
      expect(mixedPool!.models).toContain('claude-3');
    });

    it('Model Group 变为空时应该自动删除该 Group', async () => {
      // 在上一个测试删除 gpt-4 的基础上,再删除 claude-3
      // single-model-group 只包含 claude-3,删除后应该变为空
      const response = await app.request('/admin/models/delete/claude-3', {
        method: 'POST'
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/admin/models');

      // 验证配置文件已更新
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as ProxyConfig;

      // claude-3 应该被删除
      expect(config.models.find(m => m.customModel === 'claude-3')).toBeUndefined();

      // single-model-group 应该被自动删除
      const singleGroup = config.modelGroups?.find(g => g.name === 'single-model-group');
      expect(singleGroup).toBeUndefined();

      // gpt-pool 应该保留(包含 gpt-3.5)
      const gptPool = config.modelGroups?.find(g => g.name === 'gpt-pool');
      expect(gptPool).toBeDefined();
      expect(gptPool!.models).toEqual(['gpt-3.5']);

      // mixed-pool 应该也被删除了(因为它只包含 gpt-4 和 claude-3,都被删除了)
      const mixedPool = config.modelGroups?.find(g => g.name === 'mixed-pool');
      expect(mixedPool).toBeUndefined();
    });

    it('删除不存在的模型应该返回错误', async () => {
      const response = await app.request('/admin/models/delete/nonexistent-model', {
        method: 'POST'
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('未找到模型');
    });
  });
});
