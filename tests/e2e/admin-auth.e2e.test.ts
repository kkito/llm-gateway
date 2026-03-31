import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { hashPassword, saveConfig } from '../../src/config.js';
import { sessions, setSession, clearSession } from '../../src/admin/middleware/auth.js';
import { writeFileSync } from 'fs';

describe('Admin 认证 E2E 测试', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    testLogDir = join(tmpdir(), 'test-admin-auth-' + Date.now());
    testConfigPath = join(testLogDir, 'config.json');

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);

    // 创建测试配置
    const testConfig: ProviderConfig[] = [
      {
        customModel: 'test-openai',
        realModel: 'gpt-4',
        apiKey: 'sk-test-openai-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai'
      }
    ];

    // 创建临时配置文件
    writeFileSync(testConfigPath, JSON.stringify({ models: testConfig }, null, 2));

    app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    // 清空所有 Session
    sessions.clear();
  });

  describe('无密码正常访问', () => {
    it('应该允许无密码访问 /admin/models 页面', async () => {
      const response = await app.request('/admin/models');
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('模型管理');
    });

    it('应该允许无密码访问 /admin/stats 页面', async () => {
      const response = await app.request('/admin/stats');
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('统计');
    });

    it('应该允许无密码访问 /admin/password 页面', async () => {
      const response = await app.request('/admin/password');
      expect(response.status).toBe(200);
      const html = await response.text();
      // 未设置密码时，显示设置密码表单
      expect(html).toContain('设置密码');
    });
  });

  describe('首次设置密码流程', () => {
    it('应该显示设置密码的登录页面', async () => {
      const response = await app.request('/admin/login');
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('设置管理员密码');
      expect(html).not.toContain('登录');
    });

    it('应该允许首次设置密码并自动登录', async () => {
      const response = await app.request('/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'password=testpassword123'
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/models');

      // 检查是否设置了 Session Cookie
      const setCookie = response.headers.get('Set-Cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain('session=');

      // 提取 Session ID 并验证
      const sessionId = setCookie?.match(/session=([^;]+)/)?.[1];
      expect(sessionId).toBeTruthy();
      expect(sessions.has(sessionId!)).toBe(true);
    });

    it('应该拒绝空密码设置', async () => {
      const response = await app.request('/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'password='
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('请输入密码');
    });
  });

  describe('有密码页面拦截', () => {
    let sessionId: string;

    beforeEach(async () => {
      // 每个测试前先设置密码
      sessions.clear();
      const loginResponse = await app.request('/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'password=testpassword123'
      });
      sessionId = loginResponse.headers.get('Set-Cookie')?.match(/session=([^;]+)/)?.[1] || '';
    });

    it('应该拦截未认证的 /admin/models 访问', async () => {
      // 清除 Session 模拟未认证
      sessions.clear();
      const response = await app.request('/admin/models');
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/login');
    });

    it('应该拦截未认证的 /admin/stats 访问', async () => {
      sessions.clear();
      const response = await app.request('/admin/stats');
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/login');
    });

    it('应该拦截未认证的 /admin/password 访问', async () => {
      sessions.clear();
      const response = await app.request('/admin/password');
      // 已设置密码时，未认证访问应该被重定向到登录页
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/login');
    });

    it('应该允许通过 Session Cookie 访问受保护页面', async () => {
      const response = await app.request('/admin/models', {
        headers: {
          Cookie: `session=${sessionId}`
        }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('模型管理');
    });

    it('应该允许通过 Authorization Header 访问受保护页面', async () => {
      const response = await app.request('/admin/models', {
        headers: {
          Authorization: `Bearer ${sessionId}`
        }
      });

      expect(response.status).toBe(200);
    });

    it('应该允许通过 Query 参数访问受保护页面', async () => {
      const response = await app.request(`/admin/models?session=${sessionId}`);
      expect(response.status).toBe(200);
    });

    it('应该拒绝无效 Session', async () => {
      const response = await app.request('/admin/models', {
        headers: {
          Cookie: 'session=invalid-session-id'
        }
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/login');
    });
  });

  describe('登录流程', () => {
    it('应该显示登录页面', async () => {
      const response = await app.request('/admin/login');
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('密码');
    });

    it('应该允许正确密码登录', async () => {
      const response = await app.request('/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'password=testpassword123'
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/models');
      expect(response.headers.get('Set-Cookie')).toBeTruthy();
    });

    it('应该拒绝错误密码登录', async () => {
      const response = await app.request('/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'password=wrongpassword'
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('密码错误');
    });

    it('应该拒绝空密码登录', async () => {
      const response = await app.request('/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'password='
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('请输入密码');
    });
  });

  describe('修改密码', () => {
    let sessionCookie: string;

    beforeEach(async () => {
      // 确保已登录并获取 Session
      sessions.clear();
      // 先确保有密码（首次设置）
      await app.request('/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'password=testpassword123'
      });

      const loginResponse = await app.request('/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'password=testpassword123'
      });
      sessionCookie = loginResponse.headers.get('Set-Cookie') || '';
    });

    it('应该拦截未登录的 /admin/password 访问', async () => {
      // 清除 Session 模拟未登录状态
      sessions.clear();
      const response = await app.request('/admin/password');
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/login');
    });

    it('应该允许已登录用户访问 /admin/password 页面', async () => {
      const response = await app.request('/admin/password', {
        headers: {
          Cookie: sessionCookie
        }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('修改密码');
    });

    it('应该显示密码管理页面', async () => {
      const response = await app.request('/admin/password', {
        headers: {
          Cookie: sessionCookie
        }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('修改密码');
    });

    it('应该允许修改密码', async () => {
      const response = await app.request('/admin/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: sessionCookie
        },
        body: 'action=change&currentPassword=testpassword123&newPassword=newpassword456&confirmPassword=newpassword456'
      });

      // 修改成功后返回 200 并显示成功消息
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('密码已更新');
    });

    it('应该拒绝不一致的新密码确认', async () => {
      const response = await app.request('/admin/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: sessionCookie
        },
        body: 'action=change&currentPassword=testpassword123&newPassword=newpassword789&confirmPassword=differentpassword'
      });

      // 失败时返回 200 并显示错误消息
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('两次输入的新密码不一致');
    });

    it('应该拒绝错误的当前密码', async () => {
      const response = await app.request('/admin/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: sessionCookie
        },
        body: 'action=change&currentPassword=wrongcurrentpassword&newPassword=anotherpassword&confirmPassword=anotherpassword'
      });

      // 失败时返回 200 并显示错误消息
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('当前密码错误');
    });

    it('应该拒绝空的新密码', async () => {
      const response = await app.request('/admin/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: sessionCookie
        },
        body: 'action=change&currentPassword=testpassword123&newPassword=&confirmPassword='
      });

      // 失败时返回 200 并显示错误消息
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('新密码不能为空');
    });
  });

  describe('删除密码', () => {
    let sessionCookie: string;

    beforeEach(async () => {
      // 确保使用当前密码登录
      sessions.clear();
      // 先确保配置文件中没有密码（直接修改配置）
      const fs = await import('fs');
      const configContent = fs.readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent);
      if (config.adminPassword) {
        delete config.adminPassword;
        fs.writeFileSync(testConfigPath, JSON.stringify(config, null, 2));
      }
      
      // 首次设置密码
      const loginResponse = await app.request('/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'password=testpassword123'
      });
      sessionCookie = loginResponse.headers.get('Set-Cookie') || '';
    });

    it('应该允许删除密码', async () => {
      const response = await app.request('/admin/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: sessionCookie
        },
        body: 'action=delete&currentPassword=testpassword123'
      });

      // 删除成功后返回 200 并显示成功消息
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('密码已删除');
    });

    it('删除密码时不需要提供新密码字段', async () => {
      // 模拟表单提交时包含空的新密码字段（修复前的行为会导致 HTML5 验证失败）
      const response = await app.request('/admin/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: sessionCookie
        },
        body: 'action=delete&currentPassword=testpassword123&newPassword=&confirmPassword='
      });

      // 删除成功后返回 200 并显示成功消息
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('密码已删除');
    });

    it('应该拒绝错误的当前密码删除', async () => {
      // 先重新设置密码
      await app.request('/admin/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: sessionCookie
        },
        body: 'action=change&currentPassword=testpassword123&newPassword=testpassword123&confirmPassword=testpassword123'
      });

      const response = await app.request('/admin/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: sessionCookie
        },
        body: 'action=delete&currentPassword=wrongpassword'
      });

      // 失败时返回 200 并显示错误消息
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('当前密码错误');
    });

    it('删除密码后应该允许无密码访问', async () => {
      // 删除密码
      const deleteResponse = await app.request('/admin/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: sessionCookie
        },
        body: 'action=delete&currentPassword=testpassword123'
      });
      
      // 验证删除成功
      expect(deleteResponse.status).toBe(200);

      // 清除 Session
      sessions.clear();

      // 重新创建服务器以加载最新配置（无密码）
      const logger = new Logger(testLogDir + '-refresh');
      const detailLogger = new DetailLogger(testLogDir + '-refresh');
      const testConfig: ProviderConfig[] = [
        {
          customModel: 'test-openai',
          realModel: 'gpt-4',
          apiKey: 'sk-test-openai-key',
          baseUrl: 'https://api.openai.com/v1',
          provider: 'openai'
        }
      ];
      const freshApp = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);

      // 现在应该可以无密码访问
      const response = await freshApp.request('/admin/models');
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('模型管理');
    });
  });

  describe('Session 管理', () => {
    it('应该正确设置 Session', () => {
      const testSessionId = 'test-session-123';
      setSession(testSessionId);
      expect(sessions.has(testSessionId)).toBe(true);
    });

    it('应该正确清除 Session', () => {
      const testSessionId = 'test-session-456';
      setSession(testSessionId);
      clearSession(testSessionId);
      expect(sessions.has(testSessionId)).toBe(false);
    });

    it('应该清空所有 Session', () => {
      setSession('session-1');
      setSession('session-2');
      sessions.clear();
      expect(sessions.size).toBe(0);
    });
  });

  describe('密码哈希验证', () => {
    it('应该正确哈希密码', () => {
      const password = 'testpassword';
      const hashed = hashPassword(password);
      expect(hashed).toHaveLength(64); // SHA256 输出长度为 64 字符
    });

    it('相同密码应该产生相同哈希', () => {
      const password = 'samepassword';
      const hash1 = hashPassword(password);
      const hash2 = hashPassword(password);
      expect(hash1).toBe(hash2);
    });

    it('不同密码应该产生不同哈希', () => {
      const hash1 = hashPassword('password1');
      const hash2 = hashPassword('password2');
      expect(hash1).not.toBe(hash2);
    });
  });
});
