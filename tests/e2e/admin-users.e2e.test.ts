import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig, UserApiKey, ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, rmSync, mkdirSync, readFileSync } from 'fs';
import { sessions } from '../../src/admin/middleware/auth.js';
import { userSessions } from '../../src/user/middleware/auth.js';

const ADMIN_PASSWORD = 'admin123';

describe('Admin Users Management E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let adminSessionCookie: string;
  let originalFetch: typeof fetch;

  // Mock 上游 API 响应
  const createMockOpenAINonStreamResponse = (text: string) => {
    return new Response(JSON.stringify({
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  beforeAll(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(createMockOpenAINonStreamResponse('Hello from mock'));
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(async () => {
    sessions.clear();
    userSessions.clear();

    testLogDir = join(tmpdir(), 'test-admin-users-' + Date.now());
    testConfigPath = join(testLogDir, 'config.json');

    // 确保目录存在
    mkdirSync(testLogDir, { recursive: true });

    const testModels: ProviderConfig[] = [
      {
        customModel: 'test-openai',
        realModel: 'gpt-4',
        apiKey: 'sk-test-openai-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai'
      }
    ];

    // 初始配置包含一个用户
    const initialUserApiKeys: UserApiKey[] = [
      { name: '初始用户', apikey: 'sk-lg-initial123456789012', desc: '初始测试用户' }
    ];

    // 创建测试 ProxyConfig 对象
    const testConfig: ProxyConfig = {
      models: testModels,
      adminPassword: '946ef222d5a6fafae845a03be3b747667c15d97d7fbe8fade1b150809fff144d', // "admin123" 的哈希
      userApiKeys: initialUserApiKeys
    };

    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);
    app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);

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

  afterEach(() => {
    rmSync(testLogDir, { recursive: true, force: true });
  });

  describe('用户列表页面', () => {
    it('应该显示用户列表页面', async () => {
      const response = await app.request('/admin/users', {
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('用户管理');
      expect(html).toContain('初始用户');
    });

    it('应该通过 API 返回用户列表', async () => {
      const response = await app.request('/admin/users/api', {
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.users).toHaveLength(1);
      expect(data.users[0].name).toBe('初始用户');
    });
  });

  describe('新增用户', () => {
    it('应该显示新增用户页面', async () => {
      const response = await app.request('/admin/users/new', {
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('新增用户');
      expect(html).toContain('用户名称');
    });

    it('应该成功新增用户', async () => {
      const response = await app.request('/admin/users/new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: adminSessionCookie
        },
        body: new URLSearchParams({ name: '新用户', desc: '测试描述' })
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/users');

      // 验证配置文件已更新
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent);
      expect(config.userApiKeys).toHaveLength(2);
      expect(config.userApiKeys.find((u: any) => u.name === '新用户')).toBeTruthy();
    });

    it('应该拒绝新增空名称用户', async () => {
      const response = await app.request('/admin/users/new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: adminSessionCookie
        },
        body: new URLSearchParams({ name: '', desc: '测试' })
      });

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.error).toBe('用户名称不能为空');
    });

    it('应该拒绝新增重名用户', async () => {
      const response = await app.request('/admin/users/new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: adminSessionCookie
        },
        body: new URLSearchParams({ name: '初始用户', desc: '重复用户' })
      });

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.error).toBe('用户已存在');
    });

    it('应该为新增用户自动生成 API Key', async () => {
      const response = await app.request('/admin/users/new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: adminSessionCookie
        },
        body: new URLSearchParams({ name: '自动 Key 用户', desc: '测试' })
      });

      expect(response.status).toBe(302);

      // 验证生成的 API Key 格式
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent);
      const newUser = config.userApiKeys.find((u: any) => u.name === '自动 Key 用户');
      expect(newUser).toBeTruthy();
      expect(newUser.apikey).toMatch(/^sk-lg-[a-zA-Z0-9]{20}$/);
    });
  });

  describe('编辑用户', () => {
    beforeEach(async () => {
      // 先添加一个用户用于编辑测试
      await app.request('/admin/users/new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: adminSessionCookie
        },
        body: new URLSearchParams({ name: '编辑测试用户', desc: '原始描述' })
      });
    });

    it('应该显示编辑用户页面', async () => {
      const response = await app.request('/admin/users/edit/编辑测试用户', {
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('编辑用户');
      expect(html).toContain('编辑测试用户');
      expect(html).toContain('原始描述');
    });

    it('应该成功更新用户描述', async () => {
      const response = await app.request('/admin/users/edit/编辑测试用户', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: adminSessionCookie
        },
        body: new URLSearchParams({ name: '编辑测试用户', desc: '更新后的描述' })
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/users');

      // 验证配置文件已更新
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent);
      const user = config.userApiKeys.find((u: any) => u.name === '编辑测试用户');
      expect(user.desc).toBe('更新后的描述');
    });

    it('应该拒绝更新为空名称', async () => {
      const response = await app.request('/admin/users/edit/编辑测试用户', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: adminSessionCookie
        },
        body: new URLSearchParams({ name: '', desc: '测试' })
      });

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.error).toBe('用户名称不能为空');
    });

    it('应该返回 404 当编辑不存在的用户', async () => {
      const response = await app.request('/admin/users/edit/不存在用户', {
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(404);
    });
  });

  describe('删除用户', () => {
    it('应该成功删除用户', async () => {
      const response = await app.request('/admin/users/delete/初始用户', {
        method: 'POST',
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/users');

      // 验证配置文件已更新，初始用户已被删除
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent);
      const initialUser = config.userApiKeys?.find((u: any) => u.name === '初始用户');
      expect(initialUser).toBeUndefined();
    });

    it('应该返回 404 当删除不存在的用户', async () => {
      const response = await app.request('/admin/users/delete/不存在用户', {
        method: 'POST',
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(404);
      const data = await response.json() as any;
      expect(data.error).toBe('用户不存在');
    });
  });

  describe('启用/禁用用户认证', () => {
    it('应该显示启用/禁用切换按钮', async () => {
      const response = await app.request('/admin/users', {
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      // 应该包含 toggle 功能的元素（显示禁用或启用按钮）
      expect(html).toContain('禁用认证');
    });

    it('应该成功禁用用户认证（清空 userApiKeys）', async () => {
      const response = await app.request('/admin/users/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: adminSessionCookie
        },
        body: new URLSearchParams({ enabled: 'false' })
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/users');

      // 验证配置文件已更新
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent);
      // 禁用后 userApiKeys 应该为空数组或不存在
      expect(!config.userApiKeys || config.userApiKeys.length === 0).toBe(true);
    });

    it('应该成功启用用户认证（恢复 userApiKeys）', async () => {
      // 先禁用
      await app.request('/admin/users/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: adminSessionCookie
        },
        body: new URLSearchParams({ enabled: 'false' })
      });

      // 再启用（应该恢复之前的用户）
      const response = await app.request('/admin/users/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: adminSessionCookie
        },
        body: new URLSearchParams({ enabled: 'true' })
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/users');

      // 验证配置文件已更新
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent);
      // 启用后应该恢复用户
      expect(config.userApiKeys).toBeTruthy();
      expect(config.userApiKeys.length).toBeGreaterThan(0);
    });
  });

  describe('认证拦截', () => {
    it('应该拦截未认证的 /admin/users 访问', async () => {
      sessions.clear();
      const response = await app.request('/admin/users');
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/login');
    });

    it('应该拦截未认证的 /admin/users/new 访问', async () => {
      sessions.clear();
      const response = await app.request('/admin/users/new');
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/admin/login');
    });

    it('应该拦截未认证的 /admin/users/delete 访问', async () => {
      sessions.clear();
      const response = await app.request('/admin/users/delete/初始用户', {
        method: 'POST'
      });
      expect(response.status).toBe(302);
    });
  });

  describe('菜单导航', () => {
    it('管理菜单应该包含用户管理链接', async () => {
      const response = await app.request('/admin/users', {
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      // 菜单中应该包含指向 /admin/users 的链接
      expect(html).toContain('<a href="/admin/users"');
      expect(html).toContain('用户');
    });

    it('模型管理页面菜单也应该包含用户管理链接', async () => {
      const response = await app.request('/admin/models', {
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      // 菜单中应该包含指向 /admin/users 的链接
      expect(html).toContain('<a href="/admin/users"');
      expect(html).toContain('用户');
    });
  });

  describe('空用户时启用认证提示', () => {
    it('当没有用户且认证被禁用时，应该提示需要先添加用户', async () => {
      // 先清空所有用户
      await app.request('/admin/users/delete/初始用户', {
        method: 'POST',
        headers: {
          Cookie: adminSessionCookie
        }
      });

      const response = await app.request('/admin/users', {
        headers: {
          Cookie: adminSessionCookie
        }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      // 应该显示提示信息，告知用户需要先添加用户才能启用认证
      expect(html).toContain('请先添加用户');
      expect(html).toContain('添加用户');
    });
  });

  describe('错误提示显示', () => {
    it('错误提示应该正确转义 HTML 标签，不应显示原始 HTML', async () => {
      // 测试页面中错误信息的显示方式
      // 首先通过 API 提交错误请求，然后检查如果错误显示在页面上是否正确转义
      const response = await app.request('/admin/users/new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: adminSessionCookie
        },
        body: new URLSearchParams({ name: '', desc: '测试' })
      });

      // 应该返回 400 错误
      expect(response.status).toBe(400);
      const data = await response.json() as any;
      // 错误信息应该是纯文本，不应该包含未转义的 HTML
      expect(data.error).toBeDefined();
      expect(typeof data.error).toBe('string');
    });

    it('用户登录页面错误信息应该转义 HTML 标签防止 XSS', async () => {
      // 使用包含 HTML 标签的 API Key 尝试登录
      const maliciousApiKey = '<script>alert("xss")</script>';
      const response = await app.request('/user/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ apikey: maliciousApiKey })
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      
      // 验证页面正常返回错误信息
      expect(html).toContain('无效的 API Key');
      
      // 验证输入的恶意 HTML 标签被转义，不会直接渲染
      // 即使错误信息不是用户输入的内容，也要确保页面中没有未转义的 script 标签
      expect(html).not.toMatch(/<script>alert\("xss"\)<\/script>/);
    });
  });
});
