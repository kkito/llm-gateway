# API Key 管理功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在后台管理中添加独立的 API Key 管理功能，允许用户集中存储和管理常用的 API Key，在配置模型时可选择已有 Key 或手动输入新 Key。

**Architecture:** 独立的 API Key 存储，与模型配置分离。Key 存储在 config.json 中，与 models 数组同级。在模型表单中添加下拉选择功能，支持选择已有 Key 或手动输入。

**Tech Stack:** TypeScript, Hono (后端框架), JSX (前端), Vitest (测试)

---

## 文件结构规划

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| 修改 | `src/config.ts` | 添加 ApiKey 类型和 CRUD 函数 |
| 创建 | `src/admin/views/api-keys.tsx` | API Key 管理页面视图 |
| 创建 | `src/admin/routes/api-keys.tsx` | API Key 管理的路由处理 |
| 修改 | `src/admin/views/model-form.tsx` | 添加 API Key 选择功能 |
| 修改 | `src/admin/components/Layout.tsx` | 添加导航入口 |
| 修改 | `src/server.ts` | 注册新路由 |
| 创建 | `tests/api-keys.test.ts` | API Key 路由测试 |

---

## Task 1: 在 config.ts 中添加 ApiKey 类型和相关函数

**Files:**
- Modify: `src/config.ts`
- Test: `tests/config.test.ts` (在现有文件中添加)

- [ ] **Step 1: 添加 ApiKey 类型定义**

在 `src/config.ts` 中，`ProviderType` 定义后添加：

```typescript
export interface ApiKey {
  id: string;
  name: string;
  key: string;
  provider: ProviderType;
  createdAt: number;
  updatedAt: number;
}
```

修改 `ProxyConfig` 接口：

```typescript
export interface ProxyConfig {
  models: ProviderConfig[];
  adminPassword?: string;
  apiKeys?: ApiKey[];  // 新增
}
```

- [ ] **Step 2: 添加 API Key 相关函数**

在 `src/config.ts` 末尾添加：

```typescript
import { randomUUID } from 'crypto';

/**
 * 生成 UUID
 */
function generateId(): string {
  return randomUUID();
}

/**
 * 添加 API Key
 */
export function addApiKey(
  config: ApiKey[],
  name: string,
  key: string,
  provider: ProviderType
): ApiKey {
  const now = Date.now();
  const newKey: ApiKey = {
    id: generateId(),
    name,
    key,
    provider,
    createdAt: now,
    updatedAt: now
  };
  return newKey;
}

/**
 * 更新 API Key
 */
export function updateApiKey(
  config: ApiKey[],
  id: string,
  updates: Partial<Omit<ApiKey, 'id' | 'createdAt'>>
): ApiKey[] {
  const index = config.findIndex(k => k.id === id);
  if (index === -1) {
    throw new Error(`API Key not found: ${id}`);
  }
  const updated = { ...config[index], ...updates, updatedAt: Date.now() };
  const newConfig = [...config];
  newConfig[index] = updated;
  return newConfig;
}

/**
 * 删除 API Key
 */
export function deleteApiKey(config: ApiKey[], id: string): ApiKey[] {
  const index = config.findIndex(k => k.id === id);
  if (index === -1) {
    throw new Error(`API Key not found: ${id}`);
  }
  return config.filter(k => k.id !== id);
}

/**
 * 获取单个 API Key
 */
export function getApiKey(config: ApiKey[], id: string): ApiKey | null {
  return config.find(k => k.id === id) || null;
}

/**
 * 获取下拉选项（不返回 key 本身）
 */
export function getApiKeyOptions(config: ApiKey[]): Omit<ApiKey, 'key'>[] {
  return config.map(({ key, ...rest }) => rest);
}
```

- [ ] **Step 3: 修改 loadFullConfig 和 saveConfig**

修改 `loadFullConfig` 返回值包含 apiKeys：

```typescript
export function loadFullConfig(configPath: string): ProxyConfig {
  // ... 现有代码 ...
  
  return {
    models: config.models,
    adminPassword: config.adminPassword,
    apiKeys: config.apiKeys || []  // 新增
  };
}
```

修改 `saveConfig` 支持保存 apiKeys：

```typescript
export function saveConfig(configPath: string, config: ProviderConfig[], adminPassword?: string, apiKeys?: ApiKey[]): void {
  // ... 现有代码 ...
  const proxyConfig: ProxyConfig = { models: config };
  if (adminPassword) {
    proxyConfig.adminPassword = adminPassword;
  }
  if (apiKeys) {
    proxyConfig.apiKeys = apiKeys;
  }
  writeFileSync(configPath, JSON.stringify(proxyConfig, null, 2), 'utf-8');
}
```

- [ ] **Step 4: 编写测试**

在 `tests/config.test.ts` 末尾添加：

```typescript
describe('ApiKey operations', () => {
  const testApiKeys: ApiKey[] = [
    {
      id: 'test-uuid-1',
      name: 'My OpenAI Key',
      key: 'sk-test-openai',
      provider: 'openai',
      createdAt: 1700000000000,
      updatedAt: 1700000000000
    },
    {
      id: 'test-uuid-2',
      name: 'My Anthropic Key',
      key: 'sk-ant-test-anthropic',
      provider: 'anthropic',
      createdAt: 1700000000000,
      updatedAt: 1700000000000
    }
  ];

  describe('addApiKey', () => {
    it('should add a new API key', () => {
      const result = addApiKey([], 'Test Key', 'sk-test', 'openai');
      expect(result).toBeDefined();
      expect(result.name).toBe('Test Key');
      expect(result.key).toBe('sk-test');
      expect(result.provider).toBe('openai');
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeDefined();
    });
  });

  describe('getApiKey', () => {
    it('should find API key by id', () => {
      const result = getApiKey(testApiKeys, 'test-uuid-1');
      expect(result).toBeDefined();
      expect(result?.name).toBe('My OpenAI Key');
    });

    it('should return null for unknown id', () => {
      const result = getApiKey(testApiKeys, 'unknown-id');
      expect(result).toBeNull();
    });
  });

  describe('updateApiKey', () => {
    it('should update API key', () => {
      const result = updateApiKey(testApiKeys, 'test-uuid-1', { name: 'Updated Key' });
      expect(result[0].name).toBe('Updated Key');
    });

    it('should throw error for unknown id', () => {
      expect(() => updateApiKey(testApiKeys, 'unknown', { name: 'Test' })).toThrow('API Key not found');
    });
  });

  describe('deleteApiKey', () => {
    it('should delete API key', () => {
      const result = deleteApiKey(testApiKeys, 'test-uuid-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('test-uuid-2');
    });

    it('should throw error for unknown id', () => {
      expect(() => deleteApiKey(testApiKeys, 'unknown')).toThrow('API Key not found');
    });
  });

  describe('getApiKeyOptions', () => {
    it('should return options without key field', () => {
      const result = getApiKeyOptions(testApiKeys);
      expect(result[0]).not.toHaveProperty('key');
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('provider');
    });
  });
});
```

- [ ] **Step 5: 运行测试验证**

```bash
cd /home/kkito/proj/llm-gateway && pnpm test tests/config.test.ts
```

- [ ] **Step 6: 提交**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add ApiKey types and CRUD functions"
```

---

## Task 2: 创建 API Key 管理页面视图

**Files:**
- Create: `src/admin/views/api-keys.tsx`

- [ ] **Step 1: 创建 api-keys.tsx**

```tsx
import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';
import type { ApiKey, ProviderType } from '../../config.js';

interface Props {
  apiKeys: Omit<ApiKey, 'key'>[];
  error?: string;
  success?: string;
  editingKey?: Omit<ApiKey, 'key'>;
}

export const ApiKeysPage: FC<Props> = (props) => {
  const isEditing = !!props.editingKey;

  return (
    <Layout title="API Key 管理">
      <h1>API Key 管理</h1>

      {props.error && (
        <article aria-label="错误提示" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
          <strong>错误：</strong> {props.error}
        </article>
      )}

      {props.success && (
        <article aria-label="成功提示" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>
          <strong>成功：</strong> {props.success}
        </article>
      )}

      {/* API Key 列表 */}
      <section>
        <h2>已存储的 API Key</h2>
        {props.apiKeys.length === 0 ? (
          <p>暂无存储的 API Key</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>Provider</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {props.apiKeys.map((key) => (
                <tr key={key.id}>
                  <td>{key.name}</td>
                  <td>{key.provider === 'openai' ? 'OpenAI' : 'Anthropic'}</td>
                  <td>{new Date(key.createdAt).toLocaleDateString()}</td>
                  <td>
                    <a href={`/admin/api-keys/edit/${key.id}`}>编辑</a>
                    <form method="post" action={`/admin/api-keys/delete/${key.id}`} style="display: inline; margin-left: 1rem">
                      <button type="submit" style="color: red; border: none; background: none; cursor: pointer;">
                        删除
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 新增/编辑表单 */}
      <section>
        <h2>{isEditing ? '编辑 API Key' : '新增 API Key'}</h2>
        <form method="post" action={isEditing ? `/admin/api-keys/edit/${props.editingKey!.id}` : '/admin/api-keys'}>
          <label>
            名称
            <input
              name="name"
              type="text"
              placeholder="例如：我的 OpenAI Key"
              value={props.editingKey?.name || ''}
              required
            />
            <small>用于识别此 API Key</small>
          </label>

          <label>
            Provider
            <select name="provider" required>
              <option value="">请选择...</option>
              <option
                value="openai"
                selected={props.editingKey?.provider === 'openai'}
              >
                OpenAI
              </option>
              <option
                value="anthropic"
                selected={props.editingKey?.provider === 'anthropic'}
              >
                Anthropic
              </option>
            </select>
          </label>

          <label>
            API Key
            <input
              name="key"
              type="password"
              placeholder={isEditing ? '留空则保持原密钥不变' : '请输入 API Key'}
              required={!isEditing}
            />
            {isEditing && <small>留空则保持原密钥不变</small>}
          </label>

          <button type="submit">{isEditing ? '保存修改' : '添加 API Key'}</button>
          {isEditing && (
            <a href="/admin/api-keys" role="button" class="secondary" style="margin-left: 0.5rem">
              取消
            </a>
          )}
        </form>
      </section>
    </Layout>
  );
};
```

- [ ] **Step 2: 提交**

```bash
git add src/admin/views/api-keys.tsx
git commit -m "feat: add API Key management page view"
```

---

## Task 3: 创建 API Key 管理的路由

**Files:**
- Create: `src/admin/routes/api-keys.tsx`

- [ ] **Step 1: 创建 routes/api-keys.tsx**

```tsx
import type { App } from 'hono';
import { loadFullConfig, saveConfig, addApiKey, updateApiKey, deleteApiKey, getApiKey, getApiKeyOptions, type ApiKey } from '../../config.js';
import { ApiKeysPage } from '../views/api-keys.js';

interface RouteDeps {
  configPath: string;
}

export function createApiKeysRoute(deps: RouteDeps) {
  const { configPath } = deps;

  return (app: App) => {
    // GET /admin/api-keys - 列表页面
    app.get('/admin/api-keys', async (c) => {
      try {
        const proxyConfig = loadFullConfig(configPath);
        const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
        return c.html(<ApiKeysPage apiKeys={apiKeys} />);
      } catch (error: any) {
        return c.html(<ApiKeysPage apiKeys={[]} error={`加载失败：${error.message}`} />);
      }
    });

    // POST /admin/api-keys - 新增
    app.post('/admin/api-keys', async (c) => {
      try {
        const body = await c.req.parseBody();
        const name = body.name as string;
        const key = body.key as string;
        const provider = body.provider as 'openai' | 'anthropic';

        if (!name || !key || !provider) {
          const proxyConfig = loadFullConfig(configPath);
          const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
          return c.html(<ApiKeysPage apiKeys={apiKeys} error="请填写所有必填字段" />);
        }

        const proxyConfig = loadFullConfig(configPath);
        const newKey = addApiKey(proxyConfig.apiKeys || [], name, key, provider);
        const apiKeys = [...(proxyConfig.apiKeys || []), newKey];
        
        saveConfig(configPath, proxyConfig.models, proxyConfig.adminPassword, apiKeys);
        
        const updatedApiKeys = getApiKeyOptions(apiKeys);
        return c.html(<ApiKeysPage apiKeys={updatedApiKeys} success="API Key 添加成功" />);
      } catch (error: any) {
        const proxyConfig = loadFullConfig(configPath);
        const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
        return c.html(<ApiKeysPage apiKeys={apiKeys} error={`添加失败：${error.message}`} />);
      }
    });

    // GET /admin/api-keys/edit/:id - 编辑页面
    app.get('/admin/api-keys/edit/:id', async (c) => {
      try {
        const id = c.req.param('id');
        const proxyConfig = loadFullConfig(configPath);
        const apiKey = getApiKey(proxyConfig.apiKeys || [], id);
        
        if (!apiKey) {
          const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
          return c.html(<ApiKeysPage apiKeys={apiKeys} error="未找到该 API Key" />);
        }
        
        const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
        const { key, ...editingKey } = apiKey;
        return c.html(<ApiKeysPage apiKeys={apiKeys} editingKey={editingKey} />);
      } catch (error: any) {
        const proxyConfig = loadFullConfig(configPath);
        const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
        return c.html(<ApiKeysPage apiKeys={apiKeys} error={`加载失败：${error.message}`} />);
      }
    });

    // POST /admin/api-keys/edit/:id - 更新
    app.post('/admin/api-keys/edit/:id', async (c) => {
      try {
        const id = c.req.param('id');
        const body = await c.req.parseBody();
        const name = body.name as string;
        const key = body.key as string;
        const provider = body.provider as 'openai' | 'anthropic';

        if (!name || !provider) {
          const proxyConfig = loadFullConfig(configPath);
          const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
          const apiKey = getApiKey(proxyConfig.apiKeys || [], id);
          const { key: _, ...editingKey } = apiKey || {};
          return c.html(<ApiKeysPage apiKeys={apiKeys} editingKey={editingKey} error="请填写所有必填字段" />);
        }

        const proxyConfig = loadFullConfig(configPath);
        const updates: Partial<ApiKey> = { name, provider };
        if (key) {
          updates.key = key;
        }
        
        const apiKeys = updateApiKey(proxyConfig.apiKeys || [], id, updates);
        saveConfig(configPath, proxyConfig.models, proxyConfig.adminPassword, apiKeys);
        
        const updatedApiKeys = getApiKeyOptions(apiKeys);
        return c.html(<ApiKeysPage apiKeys={updatedApiKeys} success="API Key 更新成功" />);
      } catch (error: any) {
        const proxyConfig = loadFullConfig(configPath);
        const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
        return c.html(<ApiKeysPage apiKeys={apiKeys} error={`更新失败：${error.message}`} />);
      }
    });

    // POST /admin/api-keys/delete/:id - 删除
    app.post('/admin/api-keys/delete/:id', async (c) => {
      try {
        const id = c.req.param('id');
        const proxyConfig = loadFullConfig(configPath);
        
        const apiKeys = deleteApiKey(proxyConfig.apiKeys || [], id);
        saveConfig(configPath, proxyConfig.models, proxyConfig.adminPassword, apiKeys);
        
        const updatedApiKeys = getApiKeyOptions(apiKeys);
        return c.html(<ApiKeysPage apiKeys={updatedApiKeys} success="API Key 已删除" />);
      } catch (error: any) {
        const proxyConfig = loadFullConfig(configPath);
        const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
        return c.html(<ApiKeysPage apiKeys={apiKeys} error={`删除失败：${error.message}`} />);
      }
    });
  };
}
```

- [ ] **Step 2: 提交**

```bash
git add src/admin/routes/api-keys.tsx
git commit -m "feat: add API Key management routes"
```

---

## Task 4: 修改模型表单添加 API Key 选择功能

**Files:**
- Modify: `src/admin/views/model-form.tsx`
- Test: `tests/routes.test.ts` 或新建

- [ ] **Step 1: 修改 model-form.tsx**

将现有的 API Key 输入改为下拉选择 + 手动输入的组合：

```tsx
// 在 Props 接口中添加
interface Props {
  model?: ProviderConfig;
  error?: string;
  apiKeyOptions?: { id: string; name: string; provider: string }[];  // 新增
}

// 修改 API Key 部分
<label>
  API Key
  <div style="display: flex; gap: 0.5rem; align-items: center;">
    <select
      name="apiKeySource"
      onchange={(e) => {
        const target = e.target as HTMLSelectElement;
        const manualInput = document.getElementById('apiKeyManual') as HTMLInputElement;
        if (target.value === 'manual') {
          if (manualInput) manualInput.disabled = false;
        } else {
          if (manualInput) {
            manualInput.disabled = true;
            manualInput.value = '';
          }
        }
      }}
    >
      <option value="manual">手动输入...</option>
      {props.apiKeyOptions?.map((opt) => (
        <option value={opt.id}>{opt.name} ({opt.provider})</option>
      ))}
    </select>
    <input
      id="apiKeyManual"
      name="apiKey"
      type="password"
      placeholder={isEdit ? '留空则保持原密钥不变' : '请输入 API Key'}
      value={isEdit ? '' : (props.model?.apiKey || '')}
      required={!isEdit}
      style="flex: 1"
    />
  </div>
  {isEdit && <small>留空则保持原密钥不变</small>}
</label>
```

- [ ] **Step 2: 提交**

```bash
git add src/admin/views/model-form.tsx
git commit -m "feat: add API Key selection to model form"
```

---

## Task 5: 在 Layout 导航中添加入口

**Files:**
- Modify: `src/admin/components/Layout.tsx`

- [ ] **Step 1: 修改 Layout.tsx**

在导航菜单中添加 API Key 管理入口：

```tsx
// 在现有导航中添加
<li><a href="/admin/api-keys">API Key 管理</a></li>
```

- [ ] **Step 2: 提交**

```bash
git add src/admin/components/Layout.tsx
git commit -m "feat: add API Key management nav link"
```

---

## Task 6: 在 server.ts 中注册新路由

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: 修改 server.ts**

添加 import：

```typescript
import { createApiKeysRoute } from './admin/routes/api-keys.js';
```

在路由注册部分添加：

```typescript
app.route('', createApiKeysRoute({ configPath }));
```

- [ ] **Step 2: 提交**

```bash
git add src/server.ts
git commit -m "feat: register API Key management routes"
```

---

## Task 7: 创建集成测试

**Files:**
- Create: `tests/api-keys.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadFullConfig, saveConfig, addApiKey, deleteApiKey, getApiKey, getApiKeyOptions, type ApiKey } from '../src/config.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('API Key management', () => {
  const testConfigPath = join(tmpdir(), 'test-api-keys-config.json');

  beforeEach(() => {
    const initialConfig = {
      models: [],
      apiKeys: []
    };
    writeFileSync(testConfigPath, JSON.stringify(initialConfig));
  });

  afterEach(() => {
    try {
      unlinkSync(testConfigPath);
    } catch {}
  });

  describe('loadFullConfig with apiKeys', () => {
    it('should load config with apiKeys', () => {
      const configWithKeys = {
        models: [],
        apiKeys: [
          {
            id: 'test-id',
            name: 'Test Key',
            key: 'sk-test',
            provider: 'openai' as const,
            createdAt: 1700000000000,
            updatedAt: 1700000000000
          }
        ]
      };
      writeFileSync(testConfigPath, JSON.stringify(configWithKeys));
      
      const config = loadFullConfig(testConfigPath);
      expect(config.apiKeys).toHaveLength(1);
      expect(config.apiKeys?.[0].name).toBe('Test Key');
    });

    it('should return empty array if apiKeys not present', () => {
      const config = loadFullConfig(testConfigPath);
      expect(config.apiKeys).toEqual([]);
    });
  });

  describe('saveConfig with apiKeys', () => {
    it('should save apiKeys to config file', () => {
      const apiKeys: ApiKey[] = [
        {
          id: 'new-id',
          name: 'New Key',
          key: 'sk-new',
          provider: 'anthropic',
          createdAt: 1700000000000,
          updatedAt: 1700000000000
        }
      ];
      
      saveConfig(testConfigPath, [], undefined, apiKeys);
      
      const config = loadFullConfig(testConfigPath);
      expect(config.apiKeys).toHaveLength(1);
      expect(config.apiKeys?.[0].name).toBe('New Key');
    });
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd /home/kkito/proj/llm-gateway && pnpm test tests/api-keys.test.ts
```

- [ ] **Step 3: 提交**

```bash
git add tests/api-keys.test.ts
git commit -m "test: add API Key management tests"
```

---

## 执行方式

**Plan complete and saved to `docs/superpowers/plans/2026-03-29-api-key-management-plan.md`. Two execution options:**

1. **Subagent-Driven (recommended)** - 我为每个任务分配一个独立的 subagent，进行快速迭代

2. **Inline Execution** - 在当前会话中使用 executing-plans 批量执行任务

请选择你喜欢的执行方式？