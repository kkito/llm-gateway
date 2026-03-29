# 用户 API Key 认证功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 LLM Gateway 实现用户级 API Key 认证功能，支持多用户管理、独立统计 Dashboard 和配置热加载。

**Architecture:** 采用分层认证架构，在现有 Admin 认证体系基础上新增独立的用户认证系统。通过中间件实现认证逻辑，支持 API 调用和 Web 界面双重认证。统计系统通过扩展日志格式支持用户维度的数据过滤。

**Tech Stack:** TypeScript 5.9+, Hono, Node.js crypto 模块，ESM 模块系统

---

## Phase 1: 核心基础设施

### Task 1: 扩展配置接口和 API Key 生成工具

**Files:**
- Create: `src/lib/apikey.ts`
- Modify: `src/config.ts`
- Test: `tests/lib/apikey.test.ts`

- [ ] **Step 1: 编写 API Key 生成工具的测试**

```typescript
// tests/lib/apikey.test.ts
import { describe, it, expect } from 'vitest';
import { generateUserApiKey, validateApiKeyFormat } from '../../src/lib/apikey';

describe('generateUserApiKey', () => {
  it('should generate API key with correct format', () => {
    const apiKey = generateUserApiKey();
    expect(apiKey).toMatch(/^sk-lg-[a-zA-Z0-9]{20}$/);
  });

  it('should generate unique keys', () => {
    const key1 = generateUserApiKey();
    const key2 = generateUserApiKey();
    expect(key1).not.toBe(key2);
  });

  it('should generate keys with correct length', () => {
    const apiKey = generateUserApiKey();
    expect(apiKey.length).toBe(26); // 'sk-lg-' (6) + 20 random chars
  });
});

describe('validateApiKeyFormat', () => {
  it('should validate correct format', () => {
    expect(validateApiKeyFormat('sk-lg-abcdefghij1234567890')).toBe(true);
  });

  it('should reject invalid prefix', () => {
    expect(validateApiKeyFormat('sk-abcdefghij1234567890')).toBe(false);
  });

  it('should reject incorrect length', () => {
    expect(validateApiKeyFormat('sk-lg-short')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test tests/lib/apikey.test.ts
```
预期：FAIL - 文件不存在

- [ ] **Step 3: 实现 API Key 生成工具**

```typescript
// src/lib/apikey.ts

/**
 * 生成用户 API Key
 * 格式：sk-lg-xxxxxxxxxxxxxxx（sk-lg- + 20 位随机字符）
 */
export function generateUserApiKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomPart = '';
  const randomBytes = new Uint8Array(20);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < 20; i++) {
    randomPart += chars[randomBytes[i] % chars.length];
  }
  return `sk-lg-${randomPart}`;
}

/**
 * 验证 API Key 格式
 * @param apiKey 待验证的 API Key
 * @returns 格式是否正确
 */
export function validateApiKeyFormat(apiKey: string): boolean {
  return /^sk-lg-[a-zA-Z0-9]{20}$/.test(apiKey);
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test tests/lib/apikey.test.ts
```
预期：PASS - 所有测试通过

- [ ] **Step 5: 提交**

```bash
git add src/lib/apikey.ts tests/lib/apikey.test.ts
git commit -m "feat: add API key generation utility"
```

---

### Task 2: 扩展配置接口支持用户 API Key

**Files:**
- Modify: `src/config.ts`
- Test: `tests/config.test.ts` (新增相关测试)

- [ ] **Step 1: 查看现有 config.ts 结构**

```bash
cat src/config.ts
```

- [ ] **Step 2: 扩展配置接口定义**

在 `src/config.ts` 中添加：

```typescript
// 在现有接口定义后添加

/**
 * 用户 API Key 配置
 */
export interface UserApiKey {
  name: string;
  apikey: string;
  desc?: string;
}

/**
 * 扩展 ProxyConfig 接口
 */
export interface ProxyConfig {
  models: ProviderConfig[];
  adminPassword?: string;
  userApiKeys?: UserApiKey[];
}
```

- [ ] **Step 3: 添加配置验证测试**

```typescript
// tests/config.test.ts - 在文件末尾添加

import { UserApiKey } from '../src/config';

describe('UserApiKey config', () => {
  it('should accept valid userApiKeys config', () => {
    const config: ProxyConfig = {
      models: [],
      userApiKeys: [
        { name: '用户 A', apikey: 'sk-lg-abc123def456', desc: '测试用' },
        { name: '用户 B', apikey: 'sk-lg-xyz789uvw012' }
      ]
    };
    expect(config.userApiKeys).toHaveLength(2);
  });

  it('should accept empty userApiKeys array', () => {
    const config: ProxyConfig = {
      models: [],
      userApiKeys: []
    };
    expect(config.userApiKeys).toHaveLength(0);
  });

  it('should accept undefined userApiKeys', () => {
    const config: ProxyConfig = {
      models: []
    };
    expect(config.userApiKeys).toBeUndefined();
  });
});
```

- [ ] **Step 4: 运行配置测试**

```bash
pnpm test tests/config.test.ts
```
预期：PASS

- [ ] **Step 5: 提交**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: extend config interface with userApiKeys"
```

---

### Task 3: 实现用户认证中间件

**Files:**
- Create: `src/user/middleware/auth.ts`
- Test: `tests/user/middleware/auth.test.ts`

- [ ] **Step 1: 编写认证中间件测试**

```typescript
// tests/user/middleware/auth.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Context } from 'hono';
import { userAuthMiddleware, getCurrentUser } from '../../../src/user/middleware/auth';

// Mock config
vi.mock('../../../src/config', () => ({
  loadFullConfig: vi.fn(),
  getConfigPath: vi.fn()
}));

describe('userAuthMiddleware', () => {
  let ctx: Context;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ctx = new Context(new Request('http://localhost/test'));
    next = vi.fn();
  });

  it('should allow access when userApiKeys is not configured', async () => {
    vi.mocked(loadFullConfig).mockReturnValue({ models: [] });
    await userAuthMiddleware(ctx, next);
    expect(next).toHaveBeenCalled();
  });

  it('should allow access when userApiKeys is empty', async () => {
    vi.mocked(loadFullConfig).mockReturnValue({ models: [], userApiKeys: [] });
    await userAuthMiddleware(ctx, next);
    expect(next).toHaveBeenCalled();
  });

  it('should reject access when API key is missing', async () => {
    vi.mocked(loadFullConfig).mockReturnValue({
      models: [],
      userApiKeys: [{ name: '用户 A', apikey: 'sk-lg-test12345678901234' }]
    });
    const response = await userAuthMiddleware(ctx, next);
    expect(response?.status).toBe(401);
  });

  it('should reject access with invalid API key', async () => {
    vi.mocked(loadFullConfig).mockReturnValue({
      models: [],
      userApiKeys: [{ name: '用户 A', apikey: 'sk-lg-valid12345678901234' }]
    });
    ctx.newRequest('http://localhost/test', {
      headers: { 'Authorization': 'Bearer sk-lg-invalid' }
    });
    const response = await userAuthMiddleware(ctx, next);
    expect(response?.status).toBe(401);
  });

  it('should allow access with valid API key', async () => {
    vi.mocked(loadFullConfig).mockReturnValue({
      models: [],
      userApiKeys: [{ name: '用户 A', apikey: 'sk-lg-valid12345678901234' }]
    });
    ctx.newRequest('http://localhost/test', {
      headers: { 'Authorization': 'Bearer sk-lg-valid12345678901234' }
    });
    await userAuthMiddleware(ctx, next);
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test tests/user/middleware/auth.test.ts
```
预期：FAIL - 文件不存在

- [ ] **Step 3: 实现用户认证中间件**

```typescript
// src/user/middleware/auth.ts
import { Context, Next } from 'hono';
import { loadFullConfig, getConfigPath } from '../../config';
import type { UserApiKey } from '../../config';

/**
 * 用户 Session 存储（内存）
 */
export const userSessions = new Map<string, UserApiKey>();

/**
 * 生成用户 Session ID
 */
function generateUserSessionId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * 用户登录（通过 API Key）
 */
export function loginUserSession(apiKey: string): string | null {
  const config = loadFullConfig(getConfigPath());
  const user = config.userApiKeys?.find(u => u.apikey === apiKey);
  if (!user) return null;

  const sessionId = generateUserSessionId();
  userSessions.set(sessionId, user);
  return sessionId;
}

/**
 * 获取当前登录用户
 */
export function getCurrentUser(c: Context): UserApiKey | null {
  // 1. 优先从 API Key 获取（API 调用）
  const apiKey =
    c.req.header('Authorization')?.replace('Bearer ', '') ||
    c.req.header('x-api-key');

  if (apiKey) {
    const config = loadFullConfig(getConfigPath());
    return config.userApiKeys?.find(u => u.apikey === apiKey) || null;
  }

  // 2. 从 Session 获取（Web 界面）
  const sessionId =
    c.req.header('Cookie')?.match(/user_session=([^;]+)/)?.[1] ||
    c.req.query('session');

  if (sessionId && userSessions.has(sessionId)) {
    return userSessions.get(sessionId)!;
  }

  return null;
}

/**
 * 用户认证中间件
 */
export async function userAuthMiddleware(c: Context, next: Next) {
  const configPath = getConfigPath();
  const config = loadFullConfig(configPath);
  const isAuthEnabled = config.userApiKeys && config.userApiKeys.length > 0;

  // 未启用认证，直接放行
  if (!isAuthEnabled) {
    await next();
    return;
  }

  // 提取 API Key（支持两种方式）
  const apiKey =
    c.req.header('Authorization')?.replace('Bearer ', '') ||
    c.req.header('x-api-key');

  if (!apiKey) {
    return c.json({ error: { message: 'Missing API Key' } }, 401);
  }

  // 验证 API Key 是否存在
  const validUser = config.userApiKeys?.find(u => u.apikey === apiKey);
  if (!validUser) {
    return c.json({ error: { message: 'Invalid API Key' } }, 401);
  }

  // 将用户信息注入上下文
  (c as any).currentUser = validUser;
  await next();
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test tests/user/middleware/auth.test.ts
```
预期：PASS

- [ ] **Step 5: 提交**

```bash
git add src/user/middleware/auth.ts tests/user/middleware/auth.test.ts
git commit -m "feat: implement user authentication middleware"
```

---

### Task 4: 扩展日志格式支持用户名

**Files:**
- Modify: `src/logger.ts`

- [ ] **Step 1: 查看现有 LogEntry 接口**

```bash
grep -A 20 "export interface LogEntry" src/logger.ts
```

- [ ] **Step 2: 扩展 LogEntry 接口**

在 `src/logger.ts` 的 `LogEntry` 接口中添加：

```typescript
export interface LogEntry {
  timestamp: string;
  requestId: string;
  customModel: string;
  realModel?: string;
  provider?: string;
  endpoint: string;
  method: string;
  statusCode: number;
  durationMs: number;
  isStreaming: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  userName?: string;  // 新增：用户名称
  error?: {
    message: string;
    type?: string;
  };
}
```

- [ ] **Step 3: 修改日志记录逻辑注入 userName**

在日志记录函数中（找到记录请求的地方）添加：

```typescript
// 在记录日志时获取当前用户
const currentUser = getCurrentUser(c);
const logEntry: LogEntry = {
  // ... 现有字段
  userName: currentUser?.name,  // 新增
  // ... 其他字段
};
```

- [ ] **Step 4: 编译验证**

```bash
pnpm build
```
预期：无编译错误

- [ ] **Step 5: 提交**

```bash
git add src/logger.ts
git commit -m "feat: add userName field to log entries"
```

---

## Phase 2: 统计系统扩展

### Task 5: 扩展统计核心支持用户过滤

**Files:**
- Modify: `src/lib/stats-core.ts`
- Test: `tests/lib/stats-core.test.ts`

- [ ] **Step 1: 查看现有 stats-core.ts 结构**

```bash
cat src/lib/stats-core.ts
```

- [ ] **Step 2: 扩展 StatsOptions 接口**

```typescript
// 在现有接口定义后添加

export interface UserStatsOptions extends StatsOptions {
  userName?: string;  // 筛选特定用户
}
```

- [ ] **Step 3: 修改 loadStats 函数支持用户过滤**

```typescript
export function loadStats(
  logDir: string,
  options: UserStatsOptions = {}
): Stats {
  const logFiles = getLogFilesForRange(logDir, options);

  let entries: StatsEntry[] = [];
  for (const file of logFiles) {
    entries = entries.concat(parseLogFile(file));
  }

  // 如果指定了 userName，过滤日志
  if (options.userName) {
    entries = entries.filter(e => e.userName === options.userName);
  }

  return calculateStats(entries, options);
}
```

- [ ] **Step 4: 添加用户过滤测试**

```typescript
// tests/lib/stats-core.test.ts - 添加测试

it('should filter stats by userName', () => {
  // 创建包含不同用户名的测试日志
  // 验证 loadStats(logDir, { userName: '用户 A' }) 只返回该用户的数据
});
```

- [ ] **Step 5: 运行测试**

```bash
pnpm test tests/lib/stats-core.test.ts
```

- [ ] **Step 6: 提交**

```bash
git add src/lib/stats-core.ts tests/lib/stats-core.test.ts
git commit -m "feat: add user filtering to stats system"
```

---

## Phase 3: 用户界面

### Task 6: 实现用户登录页面

**Files:**
- Create: `src/user/routes/login.tsx`
- Create: `src/user/views/login.tsx`

- [ ] **Step 1: 创建登录页面组件**

```tsx
// src/user/views/login.tsx
import { html } from 'hono/html';

interface LoginViewProps {
  error?: string;
}

export function LoginView(props: LoginViewProps) {
  return html`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>用户登录 - LLM Gateway</title>
  <style>
    /* 添加样式 */
  </style>
</head>
<body>
  <div class="container">
    <h1>用户登录</h1>
    ${props.error ? `<div class="error">${props.error}</div>` : ''}
    <form method="POST" action="/user/login">
      <div class="form-group">
        <label for="apikey">API Key</label>
        <input type="password" id="apikey" name="apikey" required placeholder="sk-lg-xxxxxxxxxxxxxxx">
      </div>
      <button type="submit">登录</button>
    </form>
  </div>
</body>
</html>
`;
}
```

- [ ] **Step 2: 创建登录路由**

```tsx
// src/user/routes/login.tsx
import { Hono } from 'hono';
import { LoginView } from '../views/login';
import { loginUserSession } from '../middleware/auth';

export const loginRoute = new Hono();

loginRoute.get('/', (c) => {
  return c.html(<LoginView />);
});

loginRoute.post('/', async (c) => {
  const body = await c.req.parseBody();
  const apiKey = body.apikey as string;

  if (!apiKey) {
    return c.html(<LoginView error="请输入 API Key" />, 400);
  }

  const sessionId = loginUserSession(apiKey);
  if (!sessionId) {
    return c.html(<LoginView error="无效的 API Key" />, 401);
  }

  // 设置 Session Cookie
  c.header('Set-Cookie', `user_session=${sessionId}; Path=/; HttpOnly`);
  return c.redirect('/user/main');
});
```

- [ ] **Step 3: 提交**

```bash
git add src/user/routes/login.tsx src/user/views/login.tsx
git commit -m "feat: implement user login page"
```

---

### Task 7: 实现用户统计 Dashboard

**Files:**
- Create: `src/user/routes/stats.tsx`
- Create: `src/user/views/stats.tsx`

- [ ] **Step 1: 创建统计页面组件**

```tsx
// src/user/views/stats.tsx
import { html } from 'hono/html';
import type { Stats } from '../../lib/stats-core';

interface StatsViewProps {
  stats: Stats;
  userName: string;
}

export function StatsView(props: StatsViewProps) {
  return html`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>使用统计 - LLM Gateway</title>
</head>
<body>
  <h1>使用统计 - ${props.userName}</h1>
  <div class="stats">
    <div class="stat-card">
      <h3>总请求数</h3>
      <p>${props.stats.totalRequests}</p>
    </div>
    <div class="stat-card">
      <h3>总 Token 数</h3>
      <p>${props.stats.totalTokens}</p>
    </div>
    <!-- 其他统计 -->
  </div>
</body>
</html>
`;
}
```

- [ ] **Step 2: 创建统计路由**

```tsx
// src/user/routes/stats.tsx
import { Hono } from 'hono';
import { StatsView } from '../views/stats';
import { getCurrentUser } from '../middleware/auth';
import { loadStats } from '../../lib/stats-core';
import { getConfigPath } from '../../config';

export const statsRoute = new Hono();

statsRoute.get('/', (c) => {
  const currentUser = getCurrentUser(c);
  if (!currentUser) {
    return c.redirect('/user/login');
  }

  const configPath = getConfigPath();
  const stats = loadStats('./logs/proxy', { userName: currentUser.name });

  return c.html(<StatsView stats={stats} userName={currentUser.name} />);
});
```

- [ ] **Step 3: 提交**

```bash
git add src/user/routes/stats.tsx src/user/views/stats.tsx
git commit -m "feat: implement user stats dashboard"
```

---

### Task 8: 修改用户首页路由

**Files:**
- Modify: `src/user/routes/main.tsx`
- Modify: `src/user/views/main.tsx` (如存在)

- [ ] **Step 1: 查看现有首页路由**

```bash
cat src/user/routes/main.tsx
```

- [ ] **Step 2: 添加认证检查**

在首页路由中添加 `getCurrentUser` 检查，未登录则重定向到登录页。

- [ ] **Step 3: 显示用户信息**

在首页显示当前登录用户的名称和配置指南。

- [ ] **Step 4: 提交**

```bash
git add src/user/routes/main.tsx
git commit -m "feat: add authentication to user main page"
```

---

## Phase 4: Admin 用户管理界面

### Task 9: 实现用户管理路由

**Files:**
- Create: `src/admin/routes/users.tsx`

- [ ] **Step 1: 创建用户管理路由**

```tsx
// src/admin/routes/users.tsx
import { Hono } from 'hono';
import { loadFullConfig, getConfigPath, saveConfig } from '../../config';
import { generateUserApiKey } from '../../lib/apikey';

export const usersRoute = new Hono();

// 用户列表
usersRoute.get('/', (c) => {
  const config = loadFullConfig(getConfigPath());
  const users = config.userApiKeys || [];
  return c.json({ users });
});

// 新增用户
usersRoute.post('/new', async (c) => {
  const body = await c.req.parseBody();
  const name = body.name as string;
  const desc = body.desc as string;

  if (!name) {
    return c.json({ error: '用户名称不能为空' }, 400);
  }

  const config = loadFullConfig(getConfigPath());
  
  // 检查用户是否已存在
  if (config.userApiKeys?.find(u => u.name === name)) {
    return c.json({ error: '用户已存在' }, 400);
  }

  const newUser = {
    name,
    apikey: generateUserApiKey(),
    desc: desc || undefined
  };

  if (!config.userApiKeys) {
    config.userApiKeys = [];
  }
  config.userApiKeys.push(newUser);
  saveConfig(config, getConfigPath());

  return c.json({ success: true, user: newUser });
});

// 删除用户
usersRoute.post('/delete/:name', async (c) => {
  const name = c.req.param('name');
  const config = loadFullConfig(getConfigPath());

  const index = config.userApiKeys?.findIndex(u => u.name === name);
  if (index === undefined || index === -1) {
    return c.json({ error: '用户不存在' }, 404);
  }

  config.userApiKeys?.splice(index, 1);
  saveConfig(config, getConfigPath());

  return c.json({ success: true });
});
```

- [ ] **Step 2: 提交**

```bash
git add src/admin/routes/users.tsx
git commit -m "feat: implement admin user management routes"
```

---

### Task 10: 实现用户管理页面

**Files:**
- Create: `src/admin/views/users.tsx`

- [ ] **Step 1: 创建用户管理页面组件**

```tsx
// src/admin/views/users.tsx
import { html } from 'hono/html';
import type { UserApiKey } from '../../config';

interface UsersViewProps {
  users: UserApiKey[];
}

export function UsersView(props: UsersViewProps) {
  return html`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>用户管理 - LLM Gateway</title>
</head>
<body>
  <h1>用户管理</h1>
  <button onclick="showNewUserForm()">新增用户</button>
  <table>
    <thead>
      <tr>
        <th>名称</th>
        <th>API Key</th>
        <th>描述</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      ${props.users.map(user => `
        <tr>
          <td>${user.name}</td>
          <td><code>${user.apikey}</code></td>
          <td>${user.desc || '-'}</td>
          <td>
            <button onclick="deleteUser('${user.name}')">删除</button>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</body>
</html>
`;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/admin/views/users.tsx
git commit -m "feat: implement admin user management page"
```

---

## Phase 5: 服务器集成

### Task 11: 注册新用户路由和中间件

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: 查看现有 server.ts 结构**

```bash
cat src/server.ts
```

- [ ] **Step 2: 导入用户路由和中间件**

```typescript
import { userAuthMiddleware } from './user/middleware/auth';
import { loginRoute } from './user/routes/login';
import { statsRoute as userStatsRoute } from './user/routes/stats';
// 导入其他用户路由...
```

- [ ] **Step 3: 注册路由**

```typescript
// 在 server.ts 中添加
app.route('/user/login', loginRoute);
app.route('/user/stats', userStatsRoute);
// 应用用户认证中间件到 /user/* 和 /v1/* 路由
app.use('/user/*', userAuthMiddleware);
app.use('/v1/*', userAuthMiddleware);
```

- [ ] **Step 4: 编译验证**

```bash
pnpm build
```

- [ ] **Step 5: 提交**

```bash
git add src/server.ts
git commit -m "feat: register user routes and middleware"
```

---

## Phase 6: 测试与文档

### Task 12: 编写 E2E 测试

**Files:**
- Create: `tests/e2e/user-auth.e2e.test.ts`

- [ ] **Step 1: 创建 E2E 测试文件**

```typescript
// tests/e2e/user-auth.e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('User Authentication E2E', () => {
  // 1. 未启用认证时的开放访问
  it('should allow access without auth when userApiKeys is not configured', async () => {
    // 测试逻辑
  });

  // 2. 启用认证后的访问控制
  it('should require API key when userApiKeys is configured', async () => {
    // 测试逻辑
  });

  // 3. API Key 登录流程
  it('should login with valid API key', async () => {
    // 测试逻辑
  });

  // 4. 用户统计页面访问
  it('should access stats page only when logged in', async () => {
    // 测试逻辑
  });

  // 5. API 调用认证
  it('should call API with valid API key', async () => {
    // 测试逻辑
  });
});
```

- [ ] **Step 2: 运行 E2E 测试**

```bash
pnpm test tests/e2e/user-auth.e2e.test.ts
```

- [ ] **Step 3: 提交**

```bash
git add tests/e2e/user-auth.e2e.test.ts
git commit -m "test: add user authentication E2E tests"
```

---

### Task 13: 编写用户文档

**Files:**
- Create: `docs/user-api-key.md`

- [ ] **Step 1: 创建用户文档**

```markdown
# 用户 API Key 使用指南

## 功能概述

LLM Gateway 支持多用户管理，每个用户可以有独立的 API Key 和使用统计。

## 快速开始

### 获取 API Key

联系管理员在后台系统中为你创建用户并获取 API Key。API Key 格式为 `sk-lg-xxxxxxxxxxxxxxx`。

### 使用 API Key

在 API 调用中，通过以下任一方式提供 API Key：

1. **Authorization Header**（推荐）:
```bash
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-lg-xxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [...]}'
```

2. **x-api-key Header**:
```bash
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "x-api-key: sk-lg-xxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [...]}'
```

## 统计 Dashboard

访问 `http://localhost:4000/user/stats` 查看你的使用统计，包括：
- 总请求数
- Token 使用量
- 模型使用情况

## 常见问题

### Q: API Key 泄露了怎么办？
A: 联系管理员删除旧用户并创建新用户，生成新的 API Key。

### Q: 可以修改 API Key 吗？
A: 当前版本不支持修改，但可以删除后重新创建。
```

- [ ] **Step 2: 提交**

```bash
git add docs/user-api-key.md
git commit -m "docs: add user API key guide"
```

---

### Task 14: 更新管理员文档

**Files:**
- Modify: `docs/admin-password.md`

- [ ] **Step 1: 在管理员文档中添加用户管理章节**

在 `docs/admin-password.md` 末尾添加：

```markdown
## 用户管理

### 访问用户管理界面

访问 `http://localhost:4000/admin/users`（需要先通过 Admin 密码认证）。

### 新增用户

1. 点击"新增用户"按钮
2. 填写用户名称（必填）和描述（可选）
3. 系统自动生成 API Key
4. 将 API Key 提供给用户

### 删除用户

1. 在用户列表中找到目标用户
2. 点击"删除"按钮
3. 确认后用户立即失效

### 启用/禁用用户认证

- 配置 `userApiKeys` 后自动启用认证
- 清空 `userApiKeys` 数组可禁用认证
```

- [ ] **Step 2: 提交**

```bash
git add docs/admin-password.md
git commit -m "docs: add user management section to admin docs"
```

---

## 自检验证

完成所有任务后，对照 spec 进行以下检查：

**1. Spec 覆盖检查:**
- [ ] 配置结构 - Task 2
- [ ] API Key 生成 - Task 1
- [ ] 认证中间件 - Task 3
- [ ] Session 管理 - Task 3
- [ ] 日志扩展 - Task 4
- [ ] 统计过滤 - Task 5
- [ ] 用户登录 - Task 6
- [ ] 用户统计 - Task 7
- [ ] 用户首页 - Task 8
- [ ] Admin 用户管理 - Task 9, 10
- [ ] 服务器集成 - Task 11
- [ ] E2E 测试 - Task 12
- [ ] 文档 - Task 13, 14

**2. 占位符检查:**
- 搜索计划中是否有 "TBD", "TODO", "fill in" 等占位符
- 确保所有步骤都有具体代码或命令

**3. 类型一致性检查:**
- `UserApiKey` 接口在所有文件中一致
- `getCurrentUser`, `loginUserSession` 等函数签名一致
- `userName` 字段在日志和统计中一致

---

## 执行手off

Plan complete and saved to `docs/superpowers/plans/2026-03-28-user-api-key-design.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
