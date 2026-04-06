import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig, ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { sessions } from '../../src/admin/middleware/auth.js';
import { writeFileSync } from 'fs';

describe('Admin API Keys 页面认证测试', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    testLogDir = join(tmpdir(), 'test-admin-apikeys-' + Date.now());
    testConfigPath = join(testLogDir, 'config.json');

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);

    const testModels: ProviderConfig[] = [
      {
        customModel: 'test-openai',
        realModel: 'gpt-4',
        apiKey: 'sk-test-openai-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai'
      }
    ];

    const testConfig: ProxyConfig = { models: testModels };
    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    sessions.clear();
  });

  describe('页面访问认证', () => {
    it('无密码时应该允许访问 /admin/api-keys 页面', async () => {
      const response = await app.request('/admin/api-keys');
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('API Key');
    });

    it('有密码但未登录时应该拦截 /admin/api-keys 访问', async () => {
      // 设置密码
      const loginResponse = await app.request('/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=testpassword123'
      });
      expect(loginResponse.status).toBe(302);

      // 清除 Session 模拟未登录
      sessions.clear();

      const response = await app.request('/admin/api-keys');
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/login');
    });

    it('已登录时应该允许访问 /admin/api-keys 页面', async () => {
      // 登录
      const loginResponse = await app.request('/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=testpassword123'
      });
      const sessionId = loginResponse.headers.get('Set-Cookie')?.match(/session=([^;]+)/)?.[1] || '';

      const response = await app.request('/admin/api-keys', {
        headers: { Cookie: `session=${sessionId}` }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('API Key');
    });

    it('应该拒绝无效 Session 访问', async () => {
      const response = await app.request('/admin/api-keys', {
        headers: { Cookie: 'session=invalid-session-id' }
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/login');
    });
  });

  describe('API Keys CRUD 操作', () => {
    let sessionCookie: string;

    beforeEach(async () => {
      sessions.clear();
      const loginResponse = await app.request('/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=testpassword123'
      });
      sessionCookie = loginResponse.headers.get('Set-Cookie') || '';
    });

    it('应该显示空的 API Keys 列表', async () => {
      const response = await app.request('/admin/api-keys', {
        headers: { Cookie: sessionCookie }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('API Key');
    });

    it('应该可以添加新的 API Key', async () => {
      const response = await app.request('/admin/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: sessionCookie
        },
        body: 'name=my-api-key&key=sk-test-key-12345'
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('API Key 添加成功');
      expect(html).toContain('my-api-key');
    });

    it('应该拒绝空的 API Key 名称', async () => {
      const response = await app.request('/admin/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: sessionCookie
        },
        body: 'name=&key=sk-test-key-12345'
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('请填写所有必填字段');
    });

    it('未登录时应该无法添加 API Key', async () => {
      sessions.clear();
      const response = await app.request('/admin/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'name=test&key=sk-test'
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/login');
    });

    it('未登录时应该无法编辑 API Key', async () => {
      sessions.clear();
      const response = await app.request('/admin/api-keys/edit/some-id', {
        method: 'GET'
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/login');
    });

    it('未登录时应该无法删除 API Key', async () => {
      sessions.clear();
      const response = await app.request('/admin/api-keys/delete/some-id', {
        method: 'POST'
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/login');
    });
  });
});