# User Model Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user model-level access control — admin can select allowed models per user, enforced via interceptor at request time, with model list filtering on the user home page.

**Architecture:** Extend `UserApiKey` with optional `allowedModels[]`; add a new `UpstreamInterceptor` that checks permission before upstream request; filter `models` prop on user home page; admin form passes available models for checkbox selection.

**Tech Stack:** TypeScript, Hono, Vitest, JSX/TSX

---

### Task 1: Extend `UserApiKey` with `allowedModels` field

**Files:**
- Modify: `src/config.ts:47-51`

- [ ] **Step 1: Add `allowedModels` to UserApiKey**

```typescript
// src/config.ts
export interface UserApiKey {
  name: string;
  apikey: string;
  desc?: string;
  /** 允许使用的模型列表（customModel 名称）。空或 undefined 表示不限制 */
  allowedModels?: string[];
}
```

- [ ] **Step 2: Run type check to verify no breakage**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add allowedModels field to UserApiKey"
```

---

### Task 2: Write PermissionError class and interceptor unit tests

**Files:**
- Create: `src/interceptor/user-model-access.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { describe, it, expect } from 'vitest'
import { userModelAccessInterceptor, PermissionError } from './user-model-access.js'
import type { UpstreamRequest } from '../routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from './types.js'

function makeCtx(overrides?: Partial<UpstreamInterceptorContext>): UpstreamInterceptorContext {
  return {
    provider: {
      customModel: 'test-model',
      realModel: 'gpt-4',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      provider: 'openai',
    },
    c: {} as any,
    currentUser: null,
    clientIp: null,
    requestId: 'test-001',
    customModel: 'test-model',
    stream: false,
    ...overrides,
  }
}

const baseUpstream: UpstreamRequest = {
  url: 'https://api.openai.com/v1/chat/completions',
  headers: { Authorization: 'Bearer test-key' },
  body: { model: 'test-model', messages: [] },
}

describe('PermissionError', () => {
  it('should set correct name and message', () => {
    const err = new PermissionError('gpt-4')
    expect(err.name).toBe('PermissionError')
    expect(err.message).toBe("You don't have access to model: gpt-4")
  })
})

describe('userModelAccessInterceptor', () => {
  it('should pass through when currentUser is null', async () => {
    const ctx = makeCtx({ currentUser: null })
    const result = await userModelAccessInterceptor(baseUpstream, ctx)
    expect(result).toBe(baseUpstream)
  })

  it('should pass through when allowedModels is undefined', async () => {
    const ctx = makeCtx({ currentUser: { name: 'Alice', apikey: 'sk-lg-xxx', allowedModels: undefined } })
    const result = await userModelAccessInterceptor(baseUpstream, ctx)
    expect(result).toBe(baseUpstream)
  })

  it('should pass through when allowedModels is empty array', async () => {
    const ctx = makeCtx({ currentUser: { name: 'Alice', apikey: 'sk-lg-xxx', allowedModels: [] } })
    const result = await userModelAccessInterceptor(baseUpstream, ctx)
    expect(result).toBe(baseUpstream)
  })

  it('should pass through when model is in allowedModels', async () => {
    const ctx = makeCtx({
      currentUser: { name: 'Alice', apikey: 'sk-lg-xxx', allowedModels: ['test-model', 'gpt-4'] },
    })
    const result = await userModelAccessInterceptor(baseUpstream, ctx)
    expect(result).toBe(baseUpstream)
  })

  it('should throw PermissionError when model is not in allowedModels', async () => {
    const ctx = makeCtx({
      currentUser: { name: 'Alice', apikey: 'sk-lg-xxx', allowedModels: ['gpt-4', 'claude-3'] },
      customModel: 'gemini-pro',
    })
    await expect(userModelAccessInterceptor(baseUpstream, ctx))
      .rejects.toThrow(PermissionError)
  })

  it('should not mutate upstream when passing through', async () => {
    const upstream = { ...baseUpstream, body: { ...baseUpstream.body } }
    const ctx = makeCtx({ currentUser: { name: 'Alice', apikey: 'sk-lg-xxx', allowedModels: ['test-model'] } })
    const result = await userModelAccessInterceptor(upstream, ctx)
    expect(result).toBe(upstream)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/interceptor/user-model-access.test.ts`
Expected: FAIL — "Cannot find module './user-model-access.js'"

- [ ] **Step 3: Commit**

```bash
git add src/interceptor/user-model-access.test.ts
git commit -m "test: add PermissionError and interceptor unit tests"
```

---

### Task 3: Implement the interceptor

**Files:**
- Create: `src/interceptor/user-model-access.ts`

- [ ] **Step 1: Write the interceptor**

```typescript
import type { UpstreamInterceptor } from './types.js'

export class PermissionError extends Error {
  constructor(model: string) {
    super(`You don't have access to model: ${model}`)
    this.name = 'PermissionError'
  }
}

export const userModelAccessInterceptor: UpstreamInterceptor = async (upstream, ctx) => {
  const { currentUser, customModel } = ctx
  if (!currentUser) return upstream

  const allowed: string[] | undefined = (currentUser as any).allowedModels
  if (!allowed || allowed.length === 0) return upstream

  if (!allowed.includes(customModel)) {
    throw new PermissionError(customModel)
  }

  return upstream
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/interceptor/user-model-access.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 3: Commit**

```bash
git add src/interceptor/user-model-access.ts
git commit -m "feat: add user model access interceptor"
```

---

### Task 4: Register interceptor and handle PermissionError in handlers

**Files:**
- Modify: `src/server.ts:41-45`
- Modify: `src/routes/chat-completions/handler.ts:268-271`
- Modify: `src/routes/messages/handler.ts:263-266`

- [ ] **Step 1: Register interceptor in server.ts**

```typescript
// src/server.ts — add import after line 38:
import { userModelAccessInterceptor } from './interceptor/user-model-access.js'

// register after opencodeSessionInterceptor (after line 45):
interceptors.use(userModelAccessInterceptor)
```

- [ ] **Step 2: Add PermissionError handling in chat-completions handler**

```typescript
// src/routes/chat-completions/handler.ts — add before the generic error return (before line 286):
if (error.name === 'PermissionError') {
  return c.json({
    error: { message: error.message, type: 'permission_error' }
  }, 403)
}
```

- [ ] **Step 3: Add PermissionError handling in messages handler**

```typescript
// src/routes/messages/handler.ts — add before the generic error return (before line 281):
if (error.name === 'PermissionError') {
  return c.json({
    error: { message: error.message, type: 'permission_error' }
  }, 403)
}
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests pass

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/routes/chat-completions/handler.ts src/routes/messages/handler.ts
git commit -m "feat: register user model access interceptor and handle PermissionError"
```

---

### Task 5: Add model checkboxes to admin user form

**Files:**
- Modify: `src/admin/views/user-form.tsx`

- [ ] **Step 1: Add allowedModels to local UserApiKey interface and Props**

```typescript
// Update local interface at line 4-8:
interface UserApiKey {
  name: string;
  apikey: string;
  desc?: string;
  allowedModels?: string[];
}

interface Props {
  mode: 'new' | 'edit';
  user?: UserApiKey;
  models?: Array<{ customModel: string; realModel: string; desc?: string }>;
}
```

- [ ] **Step 2: Add model selection markup before the form-actions div**

Add after the `{isEdit && (...)}` block (after the apikey-display div, line 209) and before the form-actions div (line 211):

```tsx
{props.models && props.models.length > 0 && (
  <div class="form-group">
    <label class="form-label">模型权限</label>
    <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.3rem;">
      {props.models.map(m => (
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; cursor: pointer;">
          <input
            type="checkbox"
            name="allowedModels"
            value={m.customModel}
            checked={props.user?.allowedModels?.includes(m.customModel) || false}
          />
          <span style="font-weight: 500;">{m.customModel}</span>
          <span style="color: var(--text-secondary); font-size: 0.82rem;">→ {m.realModel}</span>
        </label>
      ))}
    </div>
    <span class="form-hint">不选择任何模型表示不限制</span>
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/admin/views/user-form.tsx
git commit -m "feat: add model selection checkboxes to user form"
```

---

### Task 6: Admin routes — pass models list and handle allowedModels

**Files:**
- Modify: `src/admin/routes/users.tsx`

- [ ] **Step 1: Update GET /admin/users/new to pass models**

```typescript
// Line 51-52 — change to:
app.get('/admin/users/new', (c) => {
  const config = loadFullConfig(getConfig());
  const models = config.models.map(m => ({
    customModel: m.customModel,
    realModel: m.realModel,
    desc: m.desc,
  }));
  return c.html(<UserFormPage mode="new" models={models} />);
});
```

- [ ] **Step 2: Update GET /admin/users/edit/:name to pass models**

```typescript
// Line 108-127 — change to:
app.get('/admin/users/edit/:name', (c) => {
  const name = c.req.param('name');
  const config = loadFullConfig(getConfig());
  const user = config.userApiKeys?.find(u => u.name === name);

  if (!user) {
    return c.html(
      <html>
        <head><title>错误</title></head>
        <body>
          <h1>❌ 用户不存在</h1>
          <a href="/admin/users">返回</a>
        </body>
      </html>,
      404
    );
  }

  const models = config.models.map(m => ({
    customModel: m.customModel,
    realModel: m.realModel,
    desc: m.desc,
  }));
  return c.html(<UserFormPage mode="edit" user={user} models={models} />);
});
```

- [ ] **Step 3: Update POST /admin/users/new to handle allowedModels**

```typescript
// Line 56-85 — change body parsing and newUser creation:
app.post('/admin/users/new', async (c) => {
  const body = await c.req.parseBody();
  const name = body.name as string;
  const desc = body.desc as string;
  // allowedModels can be a single string or array of strings
  const allowedModelsRaw = body.allowedModels;
  const allowedModels: string[] | undefined = allowedModelsRaw
    ? (Array.isArray(allowedModelsRaw) ? allowedModelsRaw : [allowedModelsRaw])
    : undefined;

  if (!name) {
    return c.json({ error: '用户名称不能为空' }, 400);
  }

  const config = loadFullConfig(getConfig());

  if (config.userApiKeys?.find(u => u.name === name)) {
    return c.json({ error: '用户已存在' }, 400);
  }

  const newUser: UserApiKey = {
    name,
    apikey: generateUserApiKey(),
    desc: desc || undefined,
    allowedModels: allowedModels && allowedModels.length > 0 ? allowedModels : undefined,
  };

  if (!config.userApiKeys) {
    config.userApiKeys = [];
  }
  config.userApiKeys.push(newUser);
  saveConfig(config, getConfig());

  return c.redirect('/admin/users');
});
```

- [ ] **Step 4: Update POST /admin/users/edit/:name to handle allowedModels**

```typescript
// Line 130-163 — change body parsing and user update:
app.post('/admin/users/edit/:name', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.parseBody();
  const newName = body.name as string;
  const desc = body.desc as string;
  const allowedModelsRaw = body.allowedModels;
  const allowedModels: string[] | undefined = allowedModelsRaw
    ? (Array.isArray(allowedModelsRaw) ? allowedModelsRaw : [allowedModelsRaw])
    : undefined;

  if (!newName) {
    return c.json({ error: '用户名称不能为空' }, 400);
  }

  const config = loadFullConfig(getConfig());
  const userIndex = config.userApiKeys?.findIndex(u => u.name === name);

  if (userIndex === undefined || userIndex === -1) {
    return c.json({ error: '用户不存在' }, 404);
  }

  if (newName !== name && config.userApiKeys?.find(u => u.name === newName)) {
    return c.json({ error: '用户已存在' }, 400);
  }

  if (!config.userApiKeys) {
    config.userApiKeys = [];
  }
  config.userApiKeys[userIndex] = {
    ...config.userApiKeys[userIndex],
    name: newName,
    desc: desc || undefined,
    allowedModels: allowedModels && allowedModels.length > 0 ? allowedModels : undefined,
  };

  saveConfig(config, getConfig());
  return c.redirect('/admin/users');
});
```

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Run existing tests**

Run: `npx vitest run`
Expected: All existing tests pass

- [ ] **Step 7: Commit**

```bash
git add src/admin/routes/users.tsx
git commit -m "feat: pass models list to user form and handle allowedModels in admin routes"
```

---

### Task 7: Filter model list on user home page

**Files:**
- Modify: `src/user/routes/home.tsx`

- [ ] **Step 1: Filter models based on currentUser.allowedModels**

```typescript
// src/user/routes/home.tsx — in both the auth-enabled and non-auth paths,
// filter visibleModels before passing to HomePage

// After line 28 (non-auth path):
const currentConfig = typeof config === 'function' ? config() : config;
const fullConfig = configPath ? loadFullConfig(configPath) : undefined;
// No filtering needed — auth is not enabled

// After line 37-39 (auth path):
const currentUser = getCurrentUser(c, configPath);
if (!currentUser) {
  return c.redirect('/user/login');
}

const currentConfig = typeof config === 'function' ? config() : config;
const fullConfig = configPath ? loadFullConfig(configPath) : undefined;

// Filter models if user has allowedModels
let visibleModels = currentConfig.models;
if (currentUser?.allowedModels?.length) {
  visibleModels = currentConfig.models.filter(
    m => currentUser.allowedModels!.includes(m.customModel)
  );
}
return c.html(<HomePage models={visibleModels} modelGroups={currentConfig.modelGroups} userName={currentUser.name} uiSettings={fullConfig?.uiSettings} />);
```

The complete updated function (lines 16-39):

```typescript
app.get('/user/main', (c) => {
  let isAuthEnabled = false;
  if (configPath) {
    const fullConfig = loadFullConfig(configPath);
    isAuthEnabled = !!(fullConfig.userApiKeys && fullConfig.userApiKeys.length > 0);
  }

  if (!isAuthEnabled) {
    const currentConfig = typeof config === 'function' ? config() : config;
    const fullConfig = configPath ? loadFullConfig(configPath) : undefined;
    return c.html(<HomePage models={currentConfig.models} modelGroups={currentConfig.modelGroups} userName={undefined} uiSettings={fullConfig?.uiSettings} />);
  }

  const currentUser = getCurrentUser(c, configPath);
  if (!currentUser) {
    return c.redirect('/user/login');
  }

  const currentConfig = typeof config === 'function' ? config() : config;
  const fullConfig = configPath ? loadFullConfig(configPath) : undefined;

  let visibleModels = currentConfig.models;
  if (currentUser?.allowedModels?.length) {
    visibleModels = currentConfig.models.filter(
      m => currentUser.allowedModels!.includes(m.customModel)
    );
  }

  return c.html(<HomePage models={visibleModels} modelGroups={currentConfig.modelGroups} userName={currentUser.name} uiSettings={fullConfig?.uiSettings} />);
});
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run existing tests**

Run: `npx vitest run`
Expected: All existing tests pass

- [ ] **Step 4: Commit**

```bash
git add src/user/routes/home.tsx
git commit -m "feat: filter model list on user home page by allowedModels"
```

---

### Task 8: Write TSX view tests for user form

**Files:**
- Create: `tests/admin/views/user-form.test.tsx`

- [ ] **Step 1: Write the view tests**

```typescript
import { describe, it, expect } from 'vitest'
import { UserFormPage } from '../../../src/admin/views/user-form.js'
import type { UserApiKey } from '../../../src/config.js'

const mockModels = [
  { customModel: 'gpt-4', realModel: 'gpt-4', desc: 'OpenAI GPT-4' },
  { customModel: 'claude-3', realModel: 'claude-3-opus', desc: 'Anthropic Claude 3' },
  { customModel: 'gemini-pro', realModel: 'gemini-1.5-pro', desc: 'Google Gemini' },
]

describe('UserFormPage', () => {
  it('should render name input', () => {
    const html = UserFormPage({ mode: 'new', models: mockModels }).toString()
    expect(html).toContain('name="name"')
    expect(html).toContain('用户名称')
  })

  it('should render model checkboxes when models prop is provided', () => {
    const html = UserFormPage({ mode: 'new', models: mockModels }).toString()
    expect(html).toContain('模型权限')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('name="allowedModels"')
    expect(html).toContain('gpt-4')
    expect(html).toContain('claude-3')
    expect(html).toContain('gemini-pro')
  })

  it('should not render model section when models prop is empty', () => {
    const html = UserFormPage({ mode: 'new', models: [] }).toString()
    expect(html).not.toContain('模型权限')
  })

  it('should check allowedModels checkboxes in edit mode', () => {
    const user: UserApiKey = {
      name: 'Alice',
      apikey: 'sk-lg-test',
      allowedModels: ['gpt-4', 'gemini-pro'],
    }
    const html = UserFormPage({ mode: 'edit', user, models: mockModels }).toString()
    // checked boxes
    expect(html).toContain('value="gpt-4" checked')
    expect(html).toContain('value="gemini-pro" checked')
    // unchecked box
    expect(html).toContain('value="claude-3"')
    expect(html).not.toContain('value="claude-3" checked')
  })

  it('should show API key in edit mode', () => {
    const user: UserApiKey = {
      name: 'Alice',
      apikey: 'sk-lg-secret-key',
    }
    const html = UserFormPage({ mode: 'edit', user, models: mockModels }).toString()
    expect(html).toContain('sk-lg-secret-key')
    expect(html).toContain('API Key 不可修改')
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/admin/views/user-form.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 3: Commit**

```bash
git add tests/admin/views/user-form.test.tsx
git commit -m "test: add TSX view tests for user form model selection"
```

---

### Task 9: Write E2E tests

**Files:**
- Create: `tests/e2e/user-model-access.e2e.test.ts`

- [ ] **Step 1: Write the E2E tests**

```typescript
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

describe('User Model Access E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let adminSessionCookie: string;
  let originalFetch: typeof fetch;

  const createMockResponse = (text: string) => {
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
    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse('Hello from mock'));
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(async () => {
    sessions.clear();
    userSessions.clear();

    testLogDir = join(tmpdir(), 'test-model-access-' + Date.now());
    testConfigPath = join(testLogDir, 'config.json');

    mkdirSync(testLogDir, { recursive: true });

    const testModels: ProviderConfig[] = [
      {
        customModel: 'gpt-4',
        realModel: 'gpt-4',
        apiKey: 'sk-test-openai',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai'
      },
      {
        customModel: 'claude-3',
        realModel: 'claude-3-opus',
        apiKey: 'sk-test-anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        provider: 'anthropic'
      },
    ];

    const testConfig: ProxyConfig = {
      models: testModels,
      adminPassword: '946ef222d5a6fafae845a03be3b747667c15d97d7fbe8fade1b150809fff144d',
      userApiKeys: [
        { name: '受限用户', apikey: 'sk-lg-restricted1234567', allowedModels: ['gpt-4'] },
        { name: '无限用户', apikey: 'sk-lg-unlimited12345678' },
      ]
    };

    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);
    app = createServer(testConfig, logger, detailLogger, 30000, testLogDir);

    // Login to get admin session
    const loginResponse = await app.request('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=admin123'
    });
    adminSessionCookie = loginResponse.headers.get('Set-Cookie') || '';
  });

  afterEach(() => {
    rmSync(testLogDir, { recursive: true, force: true });
  });

  it('should allow access to model in allowedModels', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-lg-restricted1234567'
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hello' }]
      })
    });
    expect(res.status).toBe(200);
  });

  it('should deny access to model not in allowedModels with 403', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-lg-restricted1234567'
      },
      body: JSON.stringify({
        model: 'claude-3',
        messages: [{ role: 'user', content: 'hello' }]
      })
    });
    expect(res.status).toBe(403);
    const data = await res.json() as any;
    expect(data.error.type).toBe('permission_error');
  });

  it('should allow unlimited user to access any model', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-lg-unlimited12345678'
      },
      body: JSON.stringify({
        model: 'claude-3',
        messages: [{ role: 'user', content: 'hello' }]
      })
    });
    expect(res.status).toBe(200);
  });

  it('should handle model_group requests without restriction', async () => {
    // Create a model group in config
    const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
    config.modelGroups = [{ name: 'all-models', models: ['gpt-4', 'claude-3'] }];
    writeFileSync(testConfigPath, JSON.stringify(config, null, 2));

    // Re-login to reload config
    sessions.clear();
    userSessions.clear();
    const loginResponse = await app.request('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=admin123'
    });
    adminSessionCookie = loginResponse.headers.get('Set-Cookie') || '';

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-lg-restricted1234567'
      },
      body: JSON.stringify({
        model_group: 'all-models',
        messages: [{ role: 'user', content: 'hello' }]
      })
    });
    expect(res.status).toBe(200);
  });

  it('should not find any models on user home page when user has no matching models', async () => {
    // Create a user with allowedModels that don't exist in config
    const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
    config.userApiKeys!.push({
      name: '无匹配用户',
      apikey: 'sk-lg-nomatch1234567890',
      allowedModels: ['nonexistent-model']
    });
    writeFileSync(testConfigPath, JSON.stringify(config, null, 2));

    // Login user to get session
    const loginRes = await app.request('/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'apikey=sk-lg-nomatch1234567890'
    });
    const cookie = loginRes.headers.get('Set-Cookie') || '';

    // Access user main page
    const homeRes = await app.request('/user/main', {
      headers: { 'Cookie': cookie }
    });
    const html = await homeRes.text();
    expect(homeRes.status).toBe(200);
    // Should not show any model cards
    expect(html).not.toContain('gpt-4');
    expect(html).not.toContain('claude-3');
  });
});
```

- [ ] **Step 2: Run E2E tests**

Run: `npx vitest run tests/e2e/user-model-access.e2e.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/user-model-access.e2e.test.ts
git commit -m "test: add E2E tests for user model access control"
```

---

### Task 10: Run full test suite and verify

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (including existing tests)

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Final commit — any remaining fixes**

```bash
git add -A
git commit -m "chore: final adjustments after full test run"
```
