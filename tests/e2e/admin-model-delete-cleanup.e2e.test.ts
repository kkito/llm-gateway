import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig, ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, rmSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { sessions } from '../../src/admin/middleware/auth.js';

describe('Admin Model Delete Cleanup E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let tempDir: string;
  let originalFetch: typeof fetch;
  let adminSessionCookie: string;

  const createFreshConfig = (): ProxyConfig => ({
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
    ],
    userApiKeys: [
      { name: '单模型用户', apikey: 'sk-lg-single1234567', allowedModels: ['gpt-4'] },
      { name: '多模型用户', apikey: 'sk-lg-multi123456789', allowedModels: ['gpt-4', 'claude-3'] },
      { name: '无限用户', apikey: 'sk-lg-unlimited1234567' }
    ],
    adminPassword: '946ef222d5a6fafae845a03be3b747667c15d97d7fbe8fade1b150809fff144d'
  });

  beforeAll(() => {
    tempDir = join(tmpdir(), 'test-model-delete-cleanup-' + Date.now());
    testLogDir = join(tempDir, 'logs');
    testConfigPath = join(tempDir, 'config.json');
    mkdirSync(testLogDir, { recursive: true });

    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    sessions.clear();
    
    const testConfig = createFreshConfig();
    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);
    app = createServer(testConfig, logger, detailLogger, 30000, tempDir);

    // 登录获取 Admin Session
    const loginResponse = await app.request('/admin/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'password=admin123'
    });

    adminSessionCookie = loginResponse.headers.get('Set-Cookie') || '';
  });

  describe('删除模型时清理 Model Group', () => {
    it('删除模型后应该从所有 Model Group 中移除该模型引用', async () => {
      const response = await app.request('/admin/models/delete/gpt-4', {
        method: 'POST',
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/admin/models');

      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as ProxyConfig;

      expect(config.models.find(m => m.customModel === 'gpt-4')).toBeUndefined();

      const gptPool = config.modelGroups?.find(g => g.name === 'gpt-pool');
      expect(gptPool).toBeDefined();
      expect(gptPool!.models).not.toContain('gpt-4');
      expect(gptPool!.models).toContain('gpt-3.5');

      const mixedPool = config.modelGroups?.find(g => g.name === 'mixed-pool');
      expect(mixedPool).toBeDefined();
      expect(mixedPool!.models).not.toContain('gpt-4');
      expect(mixedPool!.models).toContain('claude-3');
    });

    it('Model Group 变为空时应该自动删除该 Group', async () => {
      const response = await app.request('/admin/models/delete/claude-3', {
        method: 'POST',
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(302);

      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as ProxyConfig;

      expect(config.models.find(m => m.customModel === 'claude-3')).toBeUndefined();

      const singleGroup = config.modelGroups?.find(g => g.name === 'single-model-group');
      expect(singleGroup).toBeUndefined();

      const mixedPool = config.modelGroups?.find(g => g.name === 'mixed-pool');
      expect(mixedPool).toBeDefined();
      expect(mixedPool!.models).toEqual(['gpt-4']);
    });

    it('删除不存在的模型应该返回错误', async () => {
      const response = await app.request('/admin/models/delete/nonexistent-model', {
        method: 'POST',
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('未找到模型');
    });
  });

  describe('删除模型时清理用户绑定', () => {
    it('删除模型后应清理用户绑定中的该模型', async () => {
      const response = await app.request('/admin/models/delete/gpt-4', {
        method: 'POST',
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(302);

      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as ProxyConfig;

      const singleUser = config.userApiKeys?.find(u => u.name === '单模型用户');
      expect(singleUser).toBeDefined();
      expect(singleUser!.allowedModels).toBeUndefined();

      const multiUser = config.userApiKeys?.find(u => u.name === '多模型用户');
      expect(multiUser).toBeDefined();
      expect(multiUser!.allowedModels).toEqual(['claude-3']);

      const unlimitedUser = config.userApiKeys?.find(u => u.name === '无限用户');
      expect(unlimitedUser).toBeDefined();
      expect(unlimitedUser!.allowedModels).toBeUndefined();
    });

    it('删除模型后其他模型绑定应保留', async () => {
      const response = await app.request('/admin/models/delete/gpt-4', {
        method: 'POST',
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(302);

      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as ProxyConfig;

      const multiUser = config.userApiKeys?.find(u => u.name === '多模型用户');
      expect(multiUser).toBeDefined();
      expect(multiUser!.allowedModels).toEqual(['claude-3']);
    });
  });
});
