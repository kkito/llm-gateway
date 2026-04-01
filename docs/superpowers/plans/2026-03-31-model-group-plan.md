# Model Group 功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Model Group 功能，支持配置模型组并在请求时自动故障转移

**Architecture:** 
- 配置层：扩展 `ProxyConfig` 支持 `modelGroups` 字段，添加验证逻辑
- 核心层：新增 `ModelGroupResolver` 类，负责解析组名和查找可用模型
- 路由层：修改 `/v1/chat/completions` 和 `/v1/messages` 支持 `model_group` 参数
- 管理层：新增 Admin 管理页面，支持 Model Group 的 CRUD 操作

**Tech Stack:** TypeScript, Hono, Node.js fs/promises, vitest 测试框架

---

## 文件结构

### 新增文件
| 文件路径 | 说明 |
|---------|------|
| `src/lib/model-group-resolver.ts` | Model Group 核心解析逻辑 |
| `src/lib/model-group-resolver.test.ts` | 核心逻辑单元测试 |
| `src/lib/model-group-error.ts` | 自定义错误类 |
| `src/admin/routes/model-groups.tsx` | Model Group 列表页路由 |
| `src/admin/routes/model-group-form.tsx` | 新增/编辑表单路由 |
| `src/admin/views/model-groups.tsx` | 列表页视图组件 |
| `src/admin/views/model-group-form.tsx` | 表单视图组件 |
| `tests/lib/model-group-config.test.ts` | 配置验证测试 |
| `tests/e2e/model-group.e2e.test.ts` | E2E 测试 |

### 修改文件
| 文件路径 | 修改内容 |
|---------|---------|
| `src/config.ts` | 新增 `ModelGroup` 接口、验证逻辑 |
| `src/logger.ts` | `LogEntry` 新增 `modelGroup`、`actualModel` 字段 |
| `src/routes/chat-completions.ts` | 支持 `model_group` 参数处理 |
| `src/routes/messages.ts` | 支持 `model_group` 参数处理 |
| `src/admin/routes/models.tsx` | 添加 Model Groups 导航链接 |

---

## Task 1: 配置结构扩展

**Files:**
- Modify: `src/config.ts`
- Test: `tests/lib/model-group-config.test.ts`

- [ ] **Step 1: 编写配置验证测试**

```typescript
// tests/lib/model-group-config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadFullConfig, saveConfig, type ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';

describe('ModelGroup Config Validation', () => {
  const tempConfigPath = join(tmpdir(), 'llm-gateway-test-config.json');

  afterEach(() => {
    if (existsSync(tempConfigPath)) {
      unlinkSync(tempConfigPath);
    }
  });

  it('should validate duplicate group names', () => {
    const config: ProxyConfig = {
      models: [],
      modelGroups: [
        { name: 'pool1', models: ['model-a'] },
        { name: 'pool1', models: ['model-b'] }
      ]
    };
    saveConfig(config, tempConfigPath);
    expect(() => loadFullConfig(tempConfigPath)).toThrow('Duplicate model group name');
  });

  it('should validate model references exist', () => {
    const config: ProxyConfig = {
      models: [{
        customModel: 'model-a',
        realModel: 'gpt-4',
        apiKey: 'sk',
        baseUrl: 'https://api.openai.com',
        provider: 'openai'
      }],
      modelGroups: [
        { name: 'pool1', models: ['model-a', 'model-b'] }
      ]
    };
    saveConfig(config, tempConfigPath);
    expect(() => loadFullConfig(tempConfigPath)).toThrow('Model "model-b" not found');
  });

  it('should validate non-empty models array', () => {
    const config: ProxyConfig = {
      models: [],
      modelGroups: [
        { name: 'pool1', models: [] }
      ]
    };
    saveConfig(config, tempConfigPath);
    expect(() => loadFullConfig(tempConfigPath)).toThrow('models array cannot be empty');
  });

  it('should allow missing modelGroups field', () => {
    const config: ProxyConfig = {
      models: [{
        customModel: 'model-a',
        realModel: 'gpt-4',
        apiKey: 'sk',
        baseUrl: 'https://api.openai.com',
        provider: 'openai'
      }]
    };
    saveConfig(config, tempConfigPath);
    expect(() => loadFullConfig(tempConfigPath)).not.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test tests/lib/model-group-config.test.ts
```

- [ ] **Step 3: 在 config.ts 中新增 ModelGroup 接口**

在 `src/config.ts` 的 `ProviderConfig` 接口后添加：

```typescript
/**
 * 模型组配置
 */
export interface ModelGroup {
  name: string;
  models: string[];
  desc?: string;
}
```

修改 `ProxyConfig` 接口：

```typescript
export interface ProxyConfig {
  models: ProviderConfig[];
  modelGroups?: ModelGroup[];
  adminPassword?: string;
  apiKeys?: ApiKey[];
  userApiKeys?: UserApiKey[];
}
```

- [ ] **Step 4: 添加配置验证函数**

在 `validateModelsArray` 函数后添加：

```typescript
/**
 * 验证 ModelGroup 配置
 */
function validateModelGroups(
  modelGroups: any[],
  models: ProviderConfig[]
): ModelGroup[] {
  const modelNames = new Set(models.map(m => m.customModel));
  const groupNames = new Set<string>();

  modelGroups.forEach((group: any, index: number) => {
    if (!group.name || typeof group.name !== 'string') {
      throw new Error(`Model group at index ${index} must have a name`);
    }

    if (groupNames.has(group.name)) {
      throw new Error(`Duplicate model group name: "${group.name}"`);
    }
    groupNames.add(group.name);

    if (!Array.isArray(group.models) || group.models.length === 0) {
      throw new Error(`Model group "${group.name}" models array cannot be empty`);
    }

    group.models.forEach((modelName: string) => {
      if (!modelNames.has(modelName)) {
        throw new Error(`Model "${modelName}" in group "${group.name}" not found`);
      }
    });
  });

  return modelGroups as ModelGroup[];
}
```

- [ ] **Step 5: 修改 loadFullConfig 函数**

```typescript
// 在 validateModelsArray(config.models) 后添加
if (config.modelGroups) {
  validateModelGroups(config.modelGroups, config.models);
}

return {
  models: config.models,
  modelGroups: config.modelGroups,
  adminPassword: config.adminPassword,
  apiKeys: config.apiKeys || [],
  userApiKeys: config.userApiKeys
};
```

- [ ] **Step 6: 运行测试确认通过**

```bash
pnpm test tests/lib/model-group-config.test.ts
```

- [ ] **Step 7: 提交**

```bash
git add src/config.ts tests/lib/model-group-config.test.ts
git commit -m "feat: add ModelGroup config interface and validation"
```

---

## Task 2: 核心解析逻辑

**Files:**
- Create: `src/lib/model-group-error.ts`
- Create: `src/lib/model-group-resolver.ts`
- Create: `src/lib/model-group-resolver.test.ts`

- [ ] **Step 1: 创建自定义错误类**

```typescript
// src/lib/model-group-error.ts
export interface TriedModel {
  model: string;
  exceeded: boolean;
  message?: string;
}

export class ModelGroupExhaustedError extends Error {
  triedModels: TriedModel[];

  constructor(triedModels: TriedModel[]) {
    super(`All models in group exceeded their limits`);
    this.name = 'ModelGroupExhaustedError';
    this.triedModels = triedModels;
  }
}
```

- [ ] **Step 2: 创建 ModelGroupResolver 类**

```typescript
// src/lib/model-group-resolver.ts
import type { ProviderConfig, ModelGroup } from '../config.js';
import { RateLimiter } from './rate-limiter.js';
import { ModelGroupExhaustedError, type TriedModel } from './model-group-error.js';

export interface AvailableModelResult {
  model: string;
  provider: ProviderConfig;
  triedModels: TriedModel[];
}

export class ModelGroupResolver {
  resolveModelGroup(
    modelGroups: ModelGroup[] | undefined,
    groupName: string
  ): string[] {
    if (!modelGroups) {
      throw new Error(`Model group "${groupName}" not found`);
    }

    const group = modelGroups.find(g => g.name === groupName);
    if (!group) {
      throw new Error(`Model group "${groupName}" not found`);
    }

    return group.models;
  }

  async findAvailableModel(
    modelNames: string[],
    config: ProviderConfig[],
    logDir: string
  ): Promise<AvailableModelResult> {
    const triedModels: TriedModel[] = [];
    const rateLimiter = new RateLimiter(logDir);

    for (const modelName of modelNames) {
      const provider = config.find(p => p.customModel === modelName);

      if (!provider) {
        triedModels.push({
          model: modelName,
          exceeded: false,
          message: 'Model config not found'
        });
        continue;
      }

      try {
        const result = await rateLimiter.checkLimits(provider, logDir);

        if (result.exceeded) {
          triedModels.push({
            model: modelName,
            exceeded: true,
            message: result.message
          });
          continue;
        }

        return { model: modelName, provider, triedModels };
      } catch (error: any) {
        triedModels.push({
          model: modelName,
          exceeded: false,
          message: error.message
        });
        continue;
      }
    }

    throw new ModelGroupExhaustedError(triedModels);
  }
}
```

- [ ] **Step 3: 编写单元测试**

```typescript
// src/lib/model-group-resolver.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ModelGroupResolver } from './model-group-resolver.js';
import { ModelGroupExhaustedError } from './model-group-error.js';
import type { ModelGroup } from '../config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';

describe('ModelGroupResolver', () => {
  const resolver = new ModelGroupResolver();
  const tempLogDir = join(tmpdir(), 'llm-gateway-test-logs');

  beforeEach(() => {
    if (!existsSync(tempLogDir)) mkdirSync(tempLogDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempLogDir)) rmSync(tempLogDir, { recursive: true, force: true });
  });

  describe('resolveModelGroup', () => {
    const modelGroups: ModelGroup[] = [
      { name: 'pool1', models: ['model-a', 'model-b'] }
    ];

    it('should return model names from group', () => {
      const result = resolver.resolveModelGroup(modelGroups, 'pool1');
      expect(result).toEqual(['model-a', 'model-b']);
    });

    it('should throw when group not found', () => {
      expect(() => resolver.resolveModelGroup(modelGroups, 'nonexistent'))
        .toThrow('Model group "nonexistent" not found');
    });

    it('should throw when modelGroups is undefined', () => {
      expect(() => resolver.resolveModelGroup(undefined, 'pool1'))
        .toThrow('Model group "pool1" not found');
    });
  });

  describe('findAvailableModel', () => {
    const config = [
      {
        customModel: 'model-a',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai',
        limits: []
      }
    ];

    it('should return first available model', async () => {
      const result = await resolver.findAvailableModel(
        ['model-a'],
        config,
        tempLogDir
      );
      expect(result.model).toBe('model-a');
    });

    it('should handle missing model config', async () => {
      const result = await resolver.findAvailableModel(
        ['nonexistent'],
        config,
        tempLogDir
      );
      expect(result.triedModels[0].exceeded).toBe(false);
    });
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
pnpm test src/lib/model-group-resolver.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/lib/model-group-error.ts src/lib/model-group-resolver.ts src/lib/model-group-resolver.test.ts
git commit -m "feat: add ModelGroupResolver core logic"
```

---

## Task 3: 日志结构扩展

**Files:**
- Modify: `src/logger.ts`

- [ ] **Step 1: 扩展 LogEntry 接口**

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
  userName?: string;
  modelGroup?: string;
  actualModel?: string;
  triedModels?: Array<{
    model: string;
    exceeded: boolean;
    message?: string;
  }>;
  error?: {
    message: string;
    type?: string;
  };
}
```

- [ ] **Step 2: 运行测试确认无破坏**

```bash
pnpm test tests/logger.test.ts
```

- [ ] **Step 3: 提交**

```bash
git add src/logger.ts
git commit -m "feat: extend LogEntry with modelGroup fields"
```

---

## Task 4: 路由支持 model_group 参数

**Files:**
- Modify: `src/routes/chat-completions.ts`
- Modify: `src/routes/messages.ts`

- [ ] **Step 1: 在 chat-completions.ts 添加导入**

```typescript
import { ModelGroupResolver } from '../lib/model-group-resolver.js';
```

- [ ] **Step 2: 修改 handler 函数开头**

在 `const handler = async (c: any, endpoint: string) =>` 函数内，修改变量声明：

```typescript
const startTime = Date.now();
const requestId = uuidv4();
let customModel = 'unknown';
let modelGroup: string | undefined;
let actualModel: string | undefined;
let triedModels: Array<{ model: string; exceeded: boolean; message?: string }> = [];
```

- [ ] **Step 3: 添加参数验证逻辑**

在 `const body = await c.req.json()` 后添加：

```typescript
const { model, model_group, stream } = body;

if (model && model_group) {
  return c.json({ 
    error: { message: 'model and model_group are mutually exclusive', type: 'invalid_request_error' } 
  }, 400);
}

if (!model && !model_group) {
  return c.json({ 
    error: { message: 'Either model or model_group must be provided', type: 'invalid_request_error' } 
  }, 400);
}

detailLogger.logRequest(requestId, body);
const currentConfig = typeof config === 'function' ? config() : config;
let provider: ProviderConfig;

if (model_group) {
  modelGroup = model_group;
  console.log(`\n📥 [请求] ${requestId} - 模型组：${model_group} - 流式：${!!stream}`);
  
  const resolver = new ModelGroupResolver();
  const modelNames = resolver.resolveModelGroup(currentConfig.modelGroups, model_group);
  console.log(`   ✓ 匹配 model_group: ${model_group} -> [${modelNames.join(', ')}]`);
  
  const result = await resolver.findAvailableModel(modelNames, currentConfig, logDir);
  provider = result.provider;
  actualModel = result.model;
  triedModels = result.triedModels;
  customModel = actualModel;
  
  for (const tried of triedModels) {
    if (tried.exceeded) {
      console.log(`   ⚠️  [跳过] ${tried.model} - ${tried.message}`);
    }
  }
  console.log(`   ✓ 使用模型：${actualModel}`);
} else {
  customModel = model;
  console.log(`\n📥 [请求] ${requestId} - 模型：${model} - 流式：${!!stream}`);
  
  provider = currentConfig.find(p => p.customModel === model)!;
  actualModel = model;
  
  if (!provider) {
    console.log(`   ❌ 未找到模型配置`);
    logger.log({
      timestamp: new Date().toISOString(),
      requestId,
      customModel: model,
      endpoint,
      method: 'POST',
      statusCode: 404,
      durationMs: Date.now() - startTime,
      isStreaming: !!stream,
      userName: currentUser?.name,
      error: { message: 'Model not found' }
    });
    return c.json({ error: { message: 'Model not found' } }, 404);
  }
}
```

- [ ] **Step 4: 修改日志记录**

在所有 `logger.log()` 调用中添加字段：

```typescript
logger.log({
  timestamp: new Date().toISOString(),
  requestId,
  customModel: model_group ? actualModel! : model,
  modelGroup: model_group,
  actualModel: actualModel,
  triedModels: triedModels.length > 0 ? triedModels : undefined,
  realModel: provider.realModel,
  provider: provider.provider,
  endpoint,
  method: 'POST',
  statusCode: response.status,
  durationMs: Date.now() - startTime,
  isStreaming: !!stream,
  userName: currentUser?.name
});
```

- [ ] **Step 5: 对 messages.ts 执行相同修改**

重复 Step 1-4 的步骤修改 `src/routes/messages.ts`

- [ ] **Step 6: 运行类型检查**

```bash
pnpm build
```

- [ ] **Step 7: 提交**

```bash
git add src/routes/chat-completions.ts src/routes/messages.ts
git commit -m "feat: support model_group parameter in routes"
```

---

## Task 5: Admin 管理界面 - 列表页

**Files:**
- Create: `src/admin/views/model-groups.tsx`
- Create: `src/admin/routes/model-groups.tsx`
- Modify: `src/admin/views/models.tsx`
- Modify: `src/server.ts`

- [ ] **Step 1: 创建列表页视图组件**

```tsx
// src/admin/views/model-groups.tsx
import { html } from 'hono/html';
import type { ModelGroup } from '../../config.js';

interface ModelGroupsPageProps {
  modelGroups: ModelGroup[];
  error?: string;
  success?: string;
}

export function ModelGroupsPage(props: ModelGroupsPageProps) {
  const { modelGroups, error, success } = props;

  return html`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Model Groups - LLM Gateway</title>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100">
  <div class="container mx-auto px-4 py-8">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold">Model Groups</h1>
      <div class="space-x-2">
        <a href="/admin/models" class="px-4 py-2 bg-gray-500 text-white rounded">← 返回模型管理</a>
        <a href="/admin/model-groups/new" class="px-4 py-2 bg-blue-500 text-white rounded">+ 新增</a>
      </div>
    </div>

    ${error ? html`<div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">${error}</div>` : ''}

    <div class="bg-white shadow rounded">
      <table class="min-w-full">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">组名</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">模型数</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">描述</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200">
          ${modelGroups.length === 0 ? html`
            <tr><td colspan="4" class="px-6 py-4 text-center text-gray-500">暂无 Model Group</td></tr>
          ` : modelGroups.map(group => html`
            <tr>
              <td class="px-6 py-4">${group.name}</td>
              <td class="px-6 py-4">${group.models.length}</td>
              <td class="px-6 py-4">${group.desc || '-'}</td>
              <td class="px-6 py-4 space-x-2">
                <a href="/admin/model-groups/edit/${encodeURIComponent(group.name)}" class="text-blue-600">编辑</a>
                <form method="POST" action="/admin/model-groups/delete/${encodeURIComponent(group.name)}" class="inline" onsubmit="return confirm('确定删除？')">
                  <button type="submit" class="text-red-600">删除</button>
                </form>
              </td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}
```

- [ ] **Step 2: 创建列表页路由**

```typescript
// src/admin/routes/model-groups.tsx
import { Hono } from 'hono';
import type { ProxyConfig } from '../../config.js';
import { loadFullConfig, saveConfig } from '../../config.js';
import { ModelGroupsPage } from '../views/model-groups.js';

interface RouteDeps {
  configPath: string;
  onConfigChange: (newConfig: ProxyConfig) => void;
}

export function createModelGroupsRoute(deps: RouteDeps) {
  const { configPath, onConfigChange } = deps;
  const app = new Hono();

  app.get('/admin/model-groups', (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      return c.html(<ModelGroupsPage modelGroups={proxyConfig.modelGroups || []} />);
    } catch (error: any) {
      return c.html(<ModelGroupsPage modelGroups={[]} error={`加载失败：${error.message}`} />);
    }
  });

  app.post('/admin/model-groups/delete/:name', async (c) => {
    const name = c.req.param('name');
    try {
      const proxyConfig = loadFullConfig(configPath);
      proxyConfig.modelGroups = (proxyConfig.modelGroups || []).filter(g => g.name !== name);
      saveConfig(proxyConfig, configPath);
      onConfigChange(proxyConfig);
      return c.redirect('/admin/model-groups');
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      return c.html(<ModelGroupsPage modelGroups={proxyConfig.modelGroups || []} error={`删除失败：${error.message}`} />);
    }
  });

  return app;
}
```

- [ ] **Step 3: 修改 ModelsPage 添加导航链接**

在 `src/admin/views/models.tsx` 顶部添加：

```tsx
<div class="flex justify-between items-center mb-6">
  <h1 class="text-2xl font-bold">Models</h1>
  <div class="space-x-2">
    <a href="/admin/model-groups" class="px-4 py-2 bg-purple-500 text-white rounded">管理 Model Groups</a>
    <!-- 原有按钮 -->
  </div>
</div>
```

- [ ] **Step 4: 在 server.ts 注册路由**

```typescript
// src/server.ts - 添加导入
import { createModelGroupsRoute } from './admin/routes/model-groups.js';

// 在现有路由注册后添加
app.route('', createModelGroupsRoute({ configPath, onConfigChange }));
```

- [ ] **Step 5: 运行类型检查**

```bash
pnpm build
```

- [ ] **Step 6: 提交**

```bash
git add src/admin/views/model-groups.tsx src/admin/routes/model-groups.tsx src/admin/views/models.tsx src/server.ts
git commit -m "feat: add Model Groups admin list page"
```

---

## Task 6: Admin 管理界面 - 表单页

**Files:**
- Create: `src/admin/views/model-group-form.tsx`
- Create: `src/admin/routes/model-group-form.tsx`

- [ ] **Step 1: 创建表单视图组件**

```tsx
// src/admin/views/model-group-form.tsx
import { html } from 'hono/html';
import type { ModelGroup, ProviderConfig } from '../../config.js';

interface ModelGroupFormPageProps {
  models: ProviderConfig[];
  group?: ModelGroup;
  isEdit?: boolean;
  error?: string;
}

export function ModelGroupFormPage(props: ModelGroupFormPageProps) {
  const { models, group, isEdit = false, error } = props;

  return html`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${isEdit ? '编辑' : '新增'} Model Group</title>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100">
  <div class="container mx-auto px-4 py-8">
    <div class="max-w-2xl mx-auto">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold">${isEdit ? '编辑' : '新增'} Model Group</h1>
        <a href="/admin/model-groups" class="text-blue-600">返回列表</a>
      </div>

      ${error ? html`<div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">${error}</div>` : ''}

      <form method="POST" class="bg-white shadow rounded p-6">
        <div class="mb-4">
          <label class="block text-gray-700 text-sm font-bold mb-2">组名 *</label>
          <input type="text" name="name" value="${group?.name || ''}" required
            class="shadow border rounded w-full py-2 px-3"
            placeholder="例如：gpt-4-pool" />
          <p class="text-gray-500 text-xs mt-1">只能包含字母、数字、下划线、中划线</p>
        </div>

        <div class="mb-4">
          <label class="block text-gray-700 text-sm font-bold mb-2">选择模型 *</label>
          <div class="border rounded p-4 max-h-64 overflow-y-auto">
            ${models.length === 0 ? html`<p class="text-gray-500">暂无可用模型</p>` : ''}
            ${models.map(model => html`
              <label class="flex items-center mb-2">
                <input type="checkbox" name="models" value="${model.customModel}"
                  ${group?.models?.includes(model.customModel) ? 'checked' : ''} class="mr-2" />
                <span>${model.customModel} ${model.desc ? `(${model.desc})` : ''}</span>
              </label>
            `)}
          </div>
        </div>

        <div class="mb-6">
          <label class="block text-gray-700 text-sm font-bold mb-2">描述</label>
          <textarea name="desc" rows="3" class="shadow border rounded w-full py-2 px-3"
            placeholder="描述这个模型组的用途...">${group?.desc || ''}</textarea>
        </div>

        <div class="flex justify-end space-x-2">
          <a href="/admin/model-groups" class="px-4 py-2 bg-gray-300 rounded">取消</a>
          <button type="submit" class="px-4 py-2 bg-blue-500 text-white rounded">保存</button>
        </div>
      </form>
    </div>
  </div>
</body>
</html>`;
}
```

- [ ] **Step 2: 创建表单路由**

```typescript
// src/admin/routes/model-group-form.tsx
import { Hono } from 'hono';
import type { ProxyConfig } from '../../config.js';
import { loadFullConfig, saveConfig } from '../../config.js';
import { ModelGroupFormPage } from '../views/model-group-form.js';

interface RouteDeps {
  configPath: string;
  onConfigChange: (newConfig: ProxyConfig) => void;
}

export function createModelGroupFormRoute(deps: RouteDeps) {
  const { configPath, onConfigChange } = deps;
  const app = new Hono();

  app.get('/admin/model-groups/new', (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      return c.html(<ModelGroupFormPage models={proxyConfig.models} />);
    } catch (error: any) {
      return c.html(<ModelGroupFormPage models={[]} error={`加载失败：${error.message}`} />);
    }
  });

  app.post('/admin/model-groups', async (c) => {
    const body = await c.req.parseBody();
    const name = body.name as string;
    const desc = body.desc as string;
    let models = body.models as string[] | string | undefined;
    
    if (!Array.isArray(models)) models = models ? [models] : [];

    try {
      const proxyConfig = loadFullConfig(configPath);
      
      if (proxyConfig.modelGroups?.some(g => g.name === name)) {
        return c.html(<ModelGroupFormPage models={proxyConfig.models} error={`组名 "${name}" 已存在`} />);
      }

      if (models.length === 0) {
        return c.html(<ModelGroupFormPage models={proxyConfig.models} error="请至少选择一个模型" />);
      }

      proxyConfig.modelGroups = [...(proxyConfig.modelGroups || []), { name, models, desc: desc || undefined }];
      saveConfig(proxyConfig, configPath);
      onConfigChange(proxyConfig);
      return c.redirect('/admin/model-groups');
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      return c.html(<ModelGroupFormPage models={proxyConfig.models} error={`保存失败：${error.message}`} />);
    }
  });

  app.get('/admin/model-groups/edit/:name', (c) => {
    const name = c.req.param('name');
    try {
      const proxyConfig = loadFullConfig(configPath);
      const group = proxyConfig.modelGroups?.find(g => g.name === name);
      if (!group) return c.html(<ModelGroupFormPage models={proxyConfig.models} error={`未找到：${name}`} />);
      return c.html(<ModelGroupFormPage models={proxyConfig.models} group={group} isEdit />);
    } catch (error: any) {
      return c.html(<ModelGroupFormPage models={[]} error={`加载失败：${error.message}`} />);
    }
  });

  app.post('/admin/model-groups/edit/:name', async (c) => {
    const oldName = c.req.param('name');
    const body = await c.req.parseBody();
    const name = body.name as string;
    const desc = body.desc as string;
    let models = body.models as string[] | string | undefined;
    
    if (!Array.isArray(models)) models = models ? [models] : [];

    try {
      const proxyConfig = loadFullConfig(configPath);
      
      if (proxyConfig.modelGroups?.some(g => g.name === name && g.name !== oldName)) {
        return c.html(<ModelGroupFormPage models={proxyConfig.models} error={`组名 "${name}" 已存在`} isEdit />);
      }

      if (models.length === 0) {
        const group = proxyConfig.modelGroups?.find(g => g.name === oldName);
        return c.html(<ModelGroupFormPage models={proxyConfig.models} group={group} error="请至少选择一个模型" isEdit />);
      }

      const idx = proxyConfig.modelGroups?.findIndex(g => g.name === oldName);
      if (idx !== undefined && idx !== -1) {
        proxyConfig.modelGroups![idx] = { name, models, desc: desc || undefined };
        saveConfig(proxyConfig, configPath);
        onConfigChange(proxyConfig);
      }
      return c.redirect('/admin/model-groups');
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      const group = proxyConfig.modelGroups?.find(g => g.name === oldName);
      return c.html(<ModelGroupFormPage models={proxyConfig.models} group={group} error={`保存失败：${error.message}`} isEdit />);
    }
  });

  return app;
}
```

- [ ] **Step 3: 在 server.ts 注册表单路由**

```typescript
// src/server.ts - 添加导入和注册
import { createModelGroupFormRoute } from './admin/routes/model-group-form.js';
app.route('', createModelGroupFormRoute({ configPath, onConfigChange }));
```

- [ ] **Step 4: 运行类型检查**

```bash
pnpm build
```

- [ ] **Step 5: 提交**

```bash
git add src/admin/views/model-group-form.tsx src/admin/routes/model-group-form.tsx src/server.ts
git commit -m "feat: add Model Group form pages"
```

---

## Task 7: E2E 测试

**Files:**
- Create: `tests/e2e/model-group.e2e.test.ts`

- [ ] **Step 1: 编写 E2E 测试**

```typescript
// tests/e2e/model-group.e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';

describe('Model Group E2E', () => {
  const tempDir = join(tmpdir(), 'llm-gateway-e2e-test');
  const configPath = join(tempDir, 'config.json');

  beforeAll(() => {
    mkdirSync(tempDir, { recursive: true });
    
    const config = {
      models: [
        {
          customModel: 'test-a',
          realModel: 'gpt-3.5-turbo',
          apiKey: 'sk-test-a',
          baseUrl: 'https://api.openai.com',
          provider: 'openai',
          limits: [{ type: 'requests', period: 'day', max: 1 }]
        },
        {
          customModel: 'test-b',
          realModel: 'gpt-3.5-turbo',
          apiKey: 'sk-test-b',
          baseUrl: 'https://api.openai.com',
          provider: 'openai',
          limits: [{ type: 'requests', period: 'day', max: 2 }]
        }
      ],
      modelGroups: [
        {
          name: 'test-pool',
          models: ['test-a', 'test-b'],
          desc: 'Test pool'
        }
      ]
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  });

  afterAll(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it('should reject both model and model_group', async () => {
    const res = await fetch('http://localhost:4000/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'test-a',
        model_group: 'test-pool',
        messages: [{ role: 'user', content: 'hi' }]
      })
    });
    expect(res.status).toBe(400);
  });

  it('should reject neither model nor model_group', async () => {
    const res = await fetch('http://localhost:4000/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }]
      })
    });
    expect(res.status).toBe(400);
  });

  it('should use first available model', async () => {
    const res = await fetch('http://localhost:4000/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_group: 'test-pool',
        messages: [{ role: 'user', content: 'hi' }]
      })
    });
    // 第一次请求应该使用 test-a
    expect(res.status).toBe(200);
  });

  it('should skip to next model when first exceeded', async () => {
    // 先请求一次让 test-a 超限
    await fetch('http://localhost:4000/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_group: 'test-pool',
        messages: [{ role: 'user', content: 'hi' }]
      })
    });

    // 第二次请求应该跳过 test-a 使用 test-b
    const res = await fetch('http://localhost:4000/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_group: 'test-pool',
        messages: [{ role: 'user', content: 'hi' }]
      })
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 运行 E2E 测试**

```bash
pnpm test tests/e2e/model-group.e2e.test.ts
```

- [ ] **Step 3: 提交**

```bash
git add tests/e2e/model-group.e2e.test.ts
git commit -m "test: add Model Group E2E tests"
```

---

## Task 8: 验证与修复

- [ ] **Step 1: 运行所有测试**

```bash
pnpm test
```

- [ ] **Step 2: 运行类型检查**

```bash
pnpm build
```

- [ ] **Step 3: 修复发现的问题**

- [ ] **Step 4: 提交最终代码**

```bash
git add .
git commit -m "chore: fix remaining issues"
```
