# OpenAI 兼容 /v1/models 接口实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 OpenAI 兼容的 `/v1/models` 与 `/models` JSON 接口，返回标准 list 结构，并把原 HTML 管理页面收敛到 `/admin/models`。

**Architecture:** 新建 `src/routes/models.ts` 提供只读 Hono 路由（`/models` 与 `/v1/models`），由 `buildModelsList` 把 `ProxyConfig` 转换为标准 OpenAI 模型列表。模型配置 `ProviderConfig` 增加可选 `maxContextLength` 字段（默认 200000），在 `loadConfig`/`loadFullConfig` 读入后补全默认值。原 `models.tsx` 页面改为由独立路由挂到 `/admin/models`。

**Tech Stack:** TypeScript、Hono、Vitest（node 环境，globals 开启）。

---

## 文件结构

- Modify: `src/config.ts` — `ProviderConfig` 增加 `maxContextLength?`，在 `loadConfig`/`loadFullConfig` 读入 models 后填充默认值 200000。
- Create: `src/routes/models.ts` — `createModelsRoute` 路由 + `buildModelsList` 纯函数。
- Modify: `src/server.ts` — import 改为 `./routes/models.js`；新增 `/admin/models` 页面路由（从 `models.tsx` 迁出的页面路由）。
- Test: `src/routes/models.test.ts` — `buildModelsList` 单测 + 路由集成测试。

> 说明：`src/admin/routes/models.tsx` 是页面组件（非路由），保留不动；只需在 `server.ts` 里用新的页面路由函数把它挂到 `/admin/models`，替换原先 `createModelsRoute`（来自 `./admin/routes/models.js`，该文件实际不存在）占用的路径。

---

## Task 1: ProviderConfig 增加 maxContextLength 字段并补默认值

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: 给 ProviderConfig 接口增加字段**

在 `src/config.ts` 的 `ProviderConfig` 接口中，`hidden?: boolean;` 之后增加：

```ts
  hidden?: boolean;            // 是否隐藏该模型（不对外展示）
  maxContextLength?: number;   // 最大上下文窗口（token 数），未配置时默认 200000
  defaultParams?: Record<string, any>; // 默认参数配置
```

- [ ] **Step 2: 在读取 models 后填充默认值**

在 `validateModelsArray` 函数 return 之前，增加默认值填充（作用于两种入口共用的 `models`）：

```ts
function validateModelsArray(models: any): ProviderConfig[] {
  if (!Array.isArray(models)) {
    throw new Error('models must be an array');
  }

  models.forEach((item: any, index: number) => {
    validateProviderConfig(item, index);
    // ... 现有 limits / defaultParams 校验 ...
  });

  // 补全 maxContextLength 默认值
  models.forEach((item: any) => {
    if (item.maxContextLength == null) {
      item.maxContextLength = 200000;
    }
  });

  return models as ProviderConfig[];
}
```

- [ ] **Step 3: 类型检查确认**

Run: `npx tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 4: 提交**

```bash
git add src/config.ts
git commit -m "feat: ProviderConfig 增加 maxContextLength 字段，默认 200000"
```

---

## Task 2: buildModelsList 纯函数 + 路由

**Files:**
- Create: `src/routes/models.ts`

- [ ] **Step 1: 创建文件，实现 buildModelsList 与 createModelsRoute**

创建 `src/routes/models.ts`：

```ts
import { Hono } from 'hono';
import type { ProxyConfig, ProviderConfig, ModelGroup } from '../config.js';

export interface OpenAIModelObject {
  id: string;
  object: 'model';
  created: number;
  max_context_length: number;
  status: 'active' | 'deprecated';
  owned_by: string;
}

export interface OpenAIModelsList {
  object: 'list';
  data: OpenAIModelObject[];
  has_more: boolean;
}

function toModelEntry(p: ProviderConfig, created: number): OpenAIModelObject {
  return {
    id: p.customModel,
    object: 'model',
    created,
    max_context_length: p.maxContextLength ?? 200000,
    status: p.hidden ? 'deprecated' : 'active',
    owned_by: 'llmgateway-model'
  };
}

function toGroupEntry(
  group: ModelGroup,
  models: ProviderConfig[],
  created: number
): OpenAIModelObject {
  const firstModelName = group.models[0];
  const firstModel = models.find(m => m.customModel === firstModelName);
  const maxContextLength = firstModel?.maxContextLength ?? 200000;
  return {
    id: group.name,
    object: 'model',
    created,
    max_context_length: maxContextLength,
    status: 'active',
    owned_by: 'llmgateway-group'
  };
}

export function buildModelsList(config: ProxyConfig): OpenAIModelsList {
  const created = Math.floor(Date.now() / 1000);
  const data: OpenAIModelObject[] = [];

  for (const model of config.models) {
    data.push(toModelEntry(model, created));
  }

  for (const group of config.modelGroups ?? []) {
    data.push(toGroupEntry(group, config.models, created));
  }

  return {
    object: 'list',
    data,
    has_more: false
  };
}

export function createModelsRoute(config: ProxyConfig | (() => ProxyConfig)) {
  const router = new Hono();
  const handler = (c: any) => {
    const currentConfig = typeof config === 'function' ? config() : config;
    return c.json(buildModelsList(currentConfig));
  };
  router.get('/models', handler);
  router.get('/v1/models', handler);
  return router;
}
```

- [ ] **Step 2: 类型检查确认**

Run: `npx tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 3: 提交（测试在 Task 3 补，本步先建文件）**

```bash
git add src/routes/models.ts
git commit -m "feat: 新增 /v1/models 与 /models JSON 路由及 buildModelsList"
```

---

## Task 3: 测试 buildModelsList 与路由

**Files:**
- Create: `src/routes/models.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/routes/models.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { buildModelsList, createModelsRoute } from './models.js';
import type { ProxyConfig } from '../config.js';

function makeConfig(): ProxyConfig {
  return {
    models: [
      { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'sk', baseUrl: 'https://api.openai.com', provider: 'openai', maxContextLength: 128000 },
      { customModel: 'legacy', realModel: 'legacy', apiKey: 'sk', baseUrl: 'https://api.openai.com', provider: 'openai', hidden: true },
      { customModel: 'no-max', realModel: 'nm', apiKey: 'sk', baseUrl: 'https://api.openai.com', provider: 'openai' }
    ],
    modelGroups: [
      { name: 'pool-a', models: ['gpt-4', 'legacy'] }
    ]
  };
}

describe('buildModelsList', () => {
  it('返回标准 list 外壳', () => {
    const list = buildModelsList(makeConfig());
    expect(list.object).toBe('list');
    expect(list.has_more).toBe(false);
    expect(Array.isArray(list.data)).toBe(true);
  });

  it('模型条目字段映射正确', () => {
    const list = buildModelsList(makeConfig());
    const gpt4 = list.data.find(d => d.id === 'gpt-4')!;
    expect(gpt4.object).toBe('model');
    expect(gpt4.max_context_length).toBe(128000);
    expect(gpt4.status).toBe('active');
    expect(gpt4.owned_by).toBe('llmgateway-model');
    expect(typeof gpt4.created).toBe('number');
  });

  it('hidden 模型 status 为 deprecated', () => {
    const list = buildModelsList(makeConfig());
    const legacy = list.data.find(d => d.id === 'legacy')!;
    expect(legacy.status).toBe('deprecated');
  });

  it('未配置 maxContextLength 时使用默认值 200000', () => {
    const list = buildModelsList(makeConfig());
    const noMax = list.data.find(d => d.id === 'no-max')!;
    expect(noMax.max_context_length).toBe(200000);
  });

  it('模型组作为条目返回，owned_by 为 llmgateway-group，取第一个模型的上下文长度', () => {
    const list = buildModelsList(makeConfig());
    const group = list.data.find(d => d.id === 'pool-a')!;
    expect(group.owned_by).toBe('llmgateway-group');
    expect(group.max_context_length).toBe(128000); // 取 gpt-4 的值
    expect(group.status).toBe('active');
  });

  it('data 顺序：先模型后组', () => {
    const list = buildModelsList(makeConfig());
    expect(list.data[list.data.length - 1].id).toBe('pool-a');
  });

  it('无 modelGroups 时不应报错', () => {
    const cfg = makeConfig();
    delete (cfg as any).modelGroups;
    const list = buildModelsList(cfg);
    expect(list.data.every(d => d.owned_by === 'llmgateway-model')).toBe(true);
  });
});

describe('createModelsRoute', () => {
  function buildApp(): Hono {
    const cfg = makeConfig();
    const app = new Hono();
    app.route('', createModelsRoute(() => cfg));
    return app;
  }

  it('GET /v1/models 返回 200 和标准结构', async () => {
    const res = await buildApp().request('/v1/models');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe('list');
    expect(body.data.length).toBe(4);
  });

  it('GET /models 返回与 /v1/models 相同结构', async () => {
    const res = await buildApp().request('/models');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe('list');
    expect(body.data.length).toBe(4);
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run src/routes/models.test.ts`
Expected: 所有用例 PASS。

- [ ] **Step 3: 提交**

```bash
git add src/routes/models.test.ts
git commit -m "test: 覆盖 buildModelsList 字段映射与 /v1/models、/models 路由"
```

---

## Task 4: server.ts 接线（路由注册迁移 + /admin/models 页面）

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: 修改 createModelsRoute 的 import 路径**

将 `src/server.ts` 第 12 行：

```ts
import { createModelsRoute } from './admin/routes/models.js';
```

改为：

```ts
import { createModelsRoute } from './routes/models.js';
```

- [ ] **Step 2: 新增 /admin/models 页面路由**

在 `src/server.ts` 顶部 import 区，参考 `models.tsx` 现有页面导出名 `createModelsRoute`（来自 `../views/models.js` 的 `ModelsPage` 组件）。由于 `models.tsx` 当前导出的函数也叫 `createModelsRoute`，为避免与 JSON 路由冲突，新增一个页面路由函数。

先确认 `src/admin/routes/models.tsx` 的导出：它导出 `createModelsRoute(config)`，内部 `app.get('/admin/models', ...)` 渲染 `ModelsPage`。

为避免命名冲突，将 `src/admin/routes/models.tsx` 的导出名改为 `createModelsPageRoute`：

修改 `src/admin/routes/models.tsx`：

```ts
export function createModelsPageRoute(config: ProxyConfig | (() => ProxyConfig)) {
  const app = new Hono();

  app.get('/admin/models', (c) => {
    const currentConfig = typeof config === 'function' ? config() : config;
    return c.html(<ModelsPage models={currentConfig.models} />);
  });

  return app;
}
```

在 `src/server.ts` 顶部 import 区增加：

```ts
import { createModelsPageRoute } from './admin/routes/models.js';
```

- [ ] **Step 3: 注册页面路由**

在 `src/server.ts` 中，将原来的模型列表路由注册：

```ts
  // 模型列表路由
  app.route('', createModelsRoute(() => currentConfig));
```

改为（JSON 接口 + 页面分别注册）：

```ts
  // 模型列表 JSON 接口（OpenAI 兼容，/models 与 /v1/models）
  app.route('', createModelsRoute(() => currentConfig));

  // 模型管理页面（仅 /admin/models 可访问）
  app.route('', createModelsPageRoute(() => currentConfig));
```

- [ ] **Step 4: 类型检查确认**

Run: `npx tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 5: 运行全部测试确认无回归**

Run: `npx vitest run`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/server.ts src/admin/routes/models.tsx
git commit -m "feat: 将 /models 改为 JSON 接口，原管理页面收敛到 /admin/models"
```

---

## 自审对照 Spec

- Spec「数据结构 / 响应外壳 / Model 对象」→ Task 2 `OpenAIModelObject` + `buildModelsList` 实现。✓
- Spec「max_context_length 默认 200000」→ Task 1 默认值填充 + Task 2 `?? 200000` 兜底。✓
- Spec「status 由 hidden 派生，组恒为 active」→ Task 2 `toModelEntry` / `toGroupEntry`。✓
- Spec「模型组 owned_by=llmgateway-group，取第一个模型上下文长度」→ Task 2 `toGroupEntry`。✓
- Spec「/models 与 /v1/models 均返回 JSON」→ Task 2 `createModelsRoute` 两个 GET。✓
- Spec「原 HTML 页仅 /admin/models 可访问」→ Task 4 页面路由改名并挂 `/admin/models`。✓
- Spec「/models 跳过认证，/v1/models 走 /v1/* 认证」→ `/models` 不在 `createUserAuthMiddleware` 注册列表（server.ts 现有只注册 `/v1/*`、`/chat/completions`、`/messages`），无需额外改动即满足；`/v1/models` 自然被 `/v1/*` 覆盖。✓
- Spec「测试」→ Task 3 单测 + 集成测试。✓
