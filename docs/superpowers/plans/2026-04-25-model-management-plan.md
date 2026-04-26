# 模型管理功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 LLM Gateway 后台新增模型复制、模型隐藏功能，首页新增模型列表表格

**Architecture:** 在现有 `model-form.tsx` 路由中新增复制和隐藏接口，在 `ProviderConfig` 接口中新增 `hidden` 字段，修改现有视图和首页展示逻辑。

**Tech Stack:** Hono (TSX), TypeScript, Vitest

---

## 文件结构

| 类型 | 文件 | 职责 |
|---|---|---|
| 修改 | `src/config.ts:28-40` | `ProviderConfig` 新增 `hidden?: boolean` 字段 |
| 修改 | `src/admin/routes/model-form.tsx` | 新增 `POST /admin/models/copy/:model` 和 `POST /admin/models/toggle-hidden/:model` 路由，编辑表单保存时处理 hidden 状态和排序 |
| 修改 | `src/admin/views/models.tsx` | 列表页操作栏新增"复制"按钮和"隐藏"开关，渲染样式 |
| 修改 | `src/admin/views/model-form.tsx` | 编辑/新增表单新增"隐藏模型"复选框 |
| 修改 | `src/user/views/home.tsx` | 新增紧凑模型列表表格，仅展示未隐藏模型 |
| 新增 | `tests/routes/model-management.test.ts` | 单元测试：复制、隐藏、排序逻辑 |
| 新增 | `tests/e2e/admin-model-management.e2e.test.ts` | E2E 测试：复制、隐藏的完整流程 |

---

### Task 1: 为 ProviderConfig 新增 hidden 字段

**Files:**
- Modify: `src/config.ts:28-40`

- [ ] **Step 1: 在 ProviderConfig 接口中新增 hidden 字段**

在 `src/config.ts` 中 `ProviderConfig` 接口新增 `hidden?: boolean` 字段，放在 `limits` 之后：

```typescript
export interface ProviderConfig {
  customModel: string;
  realModel: string;
  apiKey: string;
  baseUrl: string;
  provider: ProviderType;
  desc?: string;
  inputPricePer1M?: number;
  outputPricePer1M?: number;
  cachedPricePer1M?: number;
  limits?: ModelLimit[];
  hidden?: boolean;       // 新增：模型是否在首页隐藏
}
```

- [ ] **Step 2: 运行类型检查确认无报错**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add src/config.ts
git commit -m "feat: add hidden field to ProviderConfig"
```

---

### Task 2: 新增模型复制路由

**Files:**
- Modify: `src/admin/routes/model-form.tsx`
- Test: `tests/routes/model-management.test.ts`

- [ ] **Step 1: 编写测试 - 复制模型**

创建 `tests/routes/model-management.test.ts`，编写复制路由的单元测试：

```typescript
import { describe, it, expect } from 'vitest';
import type { ProviderConfig } from '../../src/config.js';

describe('Model Copy Logic', () => {
  function copyModel(models: ProviderConfig[], modelName: string, timestamp: string): ProviderConfig[] {
    const source = models.find(m => m.customModel === modelName);
    if (!source) throw new Error(`Model not found: ${modelName}`);

    const newModelName = `${modelName}-${timestamp}`;
    const copied: ProviderConfig = {
      ...source,
      customModel: newModelName,
      hidden: false,
    };

    return [copied, ...models];
  }

  it('should copy model with timestamp suffix and place it first', () => {
    const models: ProviderConfig[] = [
      { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key1', baseUrl: 'https://api.openai.com', provider: 'openai' },
      { customModel: 'claude', realModel: 'claude-3', apiKey: 'key2', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
    ];

    const result = copyModel(models, 'gpt-4', '20260425143022');

    expect(result[0].customModel).toBe('gpt-4-20260425143022');
    expect(result[0].realModel).toBe('gpt-4');
    expect(result[0].hidden).toBe(false);
    expect(result.length).toBe(3);
    // 新模型排第一
    expect(result[0].customModel).toBe('gpt-4-20260425143022');
    // 原模型保持不变
    expect(result[1].customModel).toBe('gpt-4');
    expect(result[2].customModel).toBe('claude');
  });

  it('should copy all config fields including limits and prices', () => {
    const models: ProviderConfig[] = [
      {
        customModel: 'gpt-4',
        realModel: 'gpt-4',
        apiKey: 'key1',
        baseUrl: 'https://api.openai.com',
        provider: 'openai',
        desc: '测试模型',
        inputPricePer1M: 10,
        outputPricePer1M: 30,
        cachedPricePer1M: 1,
        limits: [{ type: 'requests', period: 'day', max: 100 }],
      },
    ];

    const result = copyModel(models, 'gpt-4', '20260425143022');

    expect(result[0].desc).toBe('测试模型');
    expect(result[0].inputPricePer1M).toBe(10);
    expect(result[0].outputPricePer1M).toBe(30);
    expect(result[0].cachedPricePer1M).toBe(1);
    expect(result[0].limits).toHaveLength(1);
    expect(result[0].hidden).toBe(false);
  });

  it('should throw if model not found', () => {
    const models: ProviderConfig[] = [];
    expect(() => copyModel(models, 'nonexistent', '20260425143022')).toThrow('Model not found: nonexistent');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/routes/model-management.test.ts`
Expected: PASS（纯函数测试，逻辑内联在测试文件中，用于验证排序逻辑正确性）

- [ ] **Step 3: 在 model-form.tsx 中实现复制路由**

在 `src/admin/routes/model-form.tsx` 中，删除路由之后、`return app` 之前，新增复制路由：

```typescript
  // 复制模型
  app.post('/admin/models/copy/:model', async (c) => {
    const modelParam = c.req.param('model');
    const currentConfig = typeof config === 'function' ? config() : config;
    const source = currentConfig.models.find(p => p.customModel === modelParam);

    if (!source) {
      return c.html(<ModelsPage models={currentConfig.models} error={`未找到模型：${modelParam}`} />);
    }

    // 生成新名称：原名 + 时间戳
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 14); // 20260425143022
    const newModelName = `${modelParam}-${timestamp}`;

    try {
      // 复制配置，新模型 hidden=false
      const newEntry: ProviderConfig = {
        ...source,
        customModel: newModelName,
        hidden: false,
      };

      // 插入到数组第一个位置
      const proxyConfig = loadFullConfig(configPath);
      proxyConfig.models = [newEntry, ...proxyConfig.models];
      saveConfig(proxyConfig, configPath);

      // 触发配置更新回调
      onConfigChange(proxyConfig);

      // 重定向到新模型的编辑页
      return c.redirect(`/admin/models/edit/${newModelName}`);
    } catch (error: any) {
      return c.html(<ModelsPage models={currentConfig.models} error={`复制失败：${error.message}`} />);
    }
  });
```

- [ ] **Step 4: 提交**

```bash
git add src/admin/routes/model-form.tsx tests/routes/model-management.test.ts
git commit -m "feat: add model copy route with timestamp suffix"
```

---

### Task 3: 新增模型隐藏/切换路由

**Files:**
- Modify: `src/admin/routes/model-form.tsx`
- Test: `tests/routes/model-management.test.ts`（追加测试）

- [ ] **Step 1: 编写测试 - 隐藏模型和切换排序**

在 `tests/routes/model-management.test.ts` 末尾追加：

```typescript
describe('Model Hidden/Toggle Logic', () => {
  function toggleHidden(models: ProviderConfig[], modelName: string): ProviderConfig[] {
    const source = models.find(m => m.customModel === modelName);
    if (!source) throw new Error(`Model not found: ${modelName}`);

    const isHidden = !source.hidden;
    const updated = { ...source, hidden: isHidden };
    const others = models.filter(m => m.customModel !== modelName);

    if (isHidden) {
      // 隐藏：排到最后
      return [...others, updated];
    } else {
      // 取消隐藏：排到第一
      return [updated, ...others];
    }
  }

  it('should hide model and move it to the end', () => {
    const models: ProviderConfig[] = [
      { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key1', baseUrl: 'https://api.openai.com', provider: 'openai' },
      { customModel: 'claude', realModel: 'claude-3', apiKey: 'key2', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
      { customModel: 'gemini', realModel: 'gemini', apiKey: 'key3', baseUrl: 'https://ai.google.dev', provider: 'openai' },
    ];

    const result = toggleHidden(models, 'gpt-4');

    expect(result[2].customModel).toBe('gpt-4');
    expect(result[2].hidden).toBe(true);
    expect(result[0].customModel).toBe('claude');
    expect(result[1].customModel).toBe('gemini');
  });

  it('should unhide model and move it to first', () => {
    const models: ProviderConfig[] = [
      { customModel: 'claude', realModel: 'claude-3', apiKey: 'key2', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
      { customModel: 'gemini', realModel: 'gemini', apiKey: 'key3', baseUrl: 'https://ai.google.dev', provider: 'openai' },
      { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key1', baseUrl: 'https://api.openai.com', provider: 'openai', hidden: true },
    ];

    const result = toggleHidden(models, 'gpt-4');

    expect(result[0].customModel).toBe('gpt-4');
    expect(result[0].hidden).toBe(false);
    expect(result[1].customModel).toBe('claude');
    expect(result[2].customModel).toBe('gemini');
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run tests/routes/model-management.test.ts`
Expected: 全部 PASS

- [ ] **Step 3: 在 model-form.tsx 中实现隐藏切换路由**

在复制路由之后、`return app` 之前，新增隐藏切换路由：

```typescript
  // 切换模型隐藏状态
  app.post('/admin/models/toggle-hidden/:model', async (c) => {
    const modelParam = c.req.param('model');
    const currentConfig = typeof config === 'function' ? config() : config;
    const source = currentConfig.models.find(p => p.customModel === modelParam);

    if (!source) {
      return c.html(<ModelsPage models={currentConfig.models} error={`未找到模型：${modelParam}`} />);
    }

    try {
      const newHidden = !source.hidden;
      const updated = { ...source, hidden: newHidden };
      const others = currentConfig.models.filter(p => p.customModel !== modelParam);

      // 隐藏：排到最后；取消隐藏：排到第一
      const newModels = newHidden
        ? [...others, updated]
        : [updated, ...others];

      const proxyConfig = loadFullConfig(configPath);
      proxyConfig.models = newModels;
      saveConfig(proxyConfig, configPath);

      onConfigChange(proxyConfig);

      return c.redirect('/admin/models');
    } catch (error: any) {
      return c.html(<ModelsPage models={currentConfig.models} error={`操作失败：${error.message}`} />);
    }
  });
```

- [ ] **Step 4: 提交**

```bash
git add src/admin/routes/model-form.tsx tests/routes/model-management.test.ts
git commit -m "feat: add model toggle hidden route"
```

---

### Task 4: 更新编辑表单处理 hidden 状态和排序

**Files:**
- Modify: `src/admin/routes/model-form.tsx`（修改编辑表单保存逻辑）
- Modify: `src/admin/views/model-form.tsx`（视图新增隐藏复选框）

- [ ] **Step 1: 修改编辑表单保存逻辑 - 处理 hidden 状态和排序**

在 `model-form.tsx` 中，找到 `POST /admin/models/edit/:model` 路由的保存逻辑，修改 `newEntry` 构建部分：

原代码：
```typescript
      const newEntry: ProviderConfig = {
        customModel,
        realModel,
        apiKey: finalApiKey,
        baseUrl,
        provider,
        desc: desc || undefined,
        limits: oldEntry.limits,
        inputPricePer1M: oldEntry.inputPricePer1M,
        outputPricePer1M: oldEntry.outputPricePer1M,
        cachedPricePer1M: oldEntry.cachedPricePer1M
      };
```

修改为：
```typescript
      // 从表单获取 hidden 状态
      const hidden = body.hidden === 'on';

      const newEntry: ProviderConfig = {
        customModel,
        realModel,
        apiKey: finalApiKey,
        baseUrl,
        provider,
        desc: desc || undefined,
        limits: oldEntry.limits,
        inputPricePer1M: oldEntry.inputPricePer1M,
        outputPricePer1M: oldEntry.outputPricePer1M,
        cachedPricePer1M: oldEntry.cachedPricePer1M,
        hidden: hidden || undefined,
      };

      const newConfigList = updateConfigEntry(currentConfig.models, oldModel, newEntry);

      // 处理排序：隐藏→排最后，显示→排第一
      let finalList = newConfigList;
      if (hidden && !oldEntry.hidden) {
        // 从显示变为隐藏：移到末尾
        const others = newConfigList.filter(p => p.customModel !== customModel);
        const target = newConfigList.find(p => p.customModel === customModel);
        finalList = [...others, target];
      } else if (!hidden && oldEntry.hidden) {
        // 从隐藏变为显示：移到开头
        const others = newConfigList.filter(p => p.customModel !== customModel);
        const target = newConfigList.find(p => p.customModel === customModel);
        finalList = [target, ...others];
      }

      // 保存到文件 - 保留 apiKeys 等其他配置
      const proxyConfig = loadFullConfig(configPath);
      proxyConfig.models = finalList;
```

- [ ] **Step 2: 在 model-form 视图中新增"隐藏模型"复选框**

读取 `src/admin/views/model-form.tsx`，找到表单提交按钮之前的位置，在 `desc` 字段之后、提交按钮之前新增隐藏复选框。

在 `desc` 字段 HTML 块之后（`<textarea name="desc">...</textarea>` 之后），新增：

```tsx
          {/* 隐藏模型 */}
          <div style="margin-bottom: 1.25rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.85rem; color: var(--text-secondary);">
              <input
                type="checkbox"
                name="hidden"
                value="on"
                checked={isEdit && props.model?.hidden === true}
                style="width: 16px; height: 16px; accent-color: var(--accent-color);"
              />
              <span>隐藏此模型（首页不展示，后台列表排到最后）</span>
            </label>
          </div>
```

- [ ] **Step 3: 提交**

```bash
git add src/admin/routes/model-form.tsx src/admin/views/model-form.tsx
git commit -m "feat: add hidden toggle to model edit form with sort logic"
```

---

### Task 5: 在后台模型列表页新增复制按钮和隐藏开关

**Files:**
- Modify: `src/admin/views/models.tsx`

- [ ] **Step 1: 在操作栏新增"复制"按钮和"隐藏"开关**

在 `src/admin/views/models.tsx` 中，找到操作栏 `<div class="actions-cell">` 内的"编辑"链接之前，新增复制按钮和隐藏开关：

在现有的 `<a href={\`/admin/models/edit/...}>编辑</a>` 之前，新增：

```tsx
                          {/* 复制按钮 */}
                          <button
                            type="button"
                            class="btn btn-secondary btn-sm"
                            data-copy-url={`/admin/models/copy/${model.customModel}`}
                            title="复制"
                          >
                            复制
                          </button>
                          {/* 隐藏开关 */}
                          <button
                            type="button"
                            class={`order-btn ${model.hidden ? 'is-hidden' : ''}`}
                            data-toggle-url={`/admin/models/toggle-hidden/${model.customModel}`}
                            title={model.hidden ? '取消隐藏' : '隐藏'}
                          >
                            {model.hidden ? '👁' : '👁‍🗨'}
                          </button>
```

- [ ] **Step 2: 为隐藏模型行新增视觉标识（置灰背景）**

在 `models.tsx` 的 `<tr>` 标签上，为隐藏模型新增行内样式：

```tsx
                  {props.models.map((model, index) => (
                    <tr style={model.hidden ? 'opacity: 0.5; background: #f9fafb;' : ''}>
```

- [ ] **Step 3: 在 JavaScript 脚本中新增复制和隐藏的事件处理**

在视图底部的 `<script>` 标签中，现有删除和移动逻辑之后，新增：

```javascript
                // 复制功能
                document.querySelectorAll('button[data-copy-url]').forEach(function(btn) {
                  btn.addEventListener('click', function() {
                    var url = this.getAttribute('data-copy-url');
                    var modelName = url.split('/').pop();
                    if (confirm('确定要复制模型 "' + modelName + '" 吗？\n复制后名称将添加时间戳后缀。')) {
                      var form = document.createElement('form');
                      form.method = 'POST';
                      form.action = url;
                      document.body.appendChild(form);
                      form.submit();
                    }
                  });
                });

                // 切换隐藏状态
                document.querySelectorAll('button[data-toggle-url]').forEach(function(btn) {
                  btn.addEventListener('click', function() {
                    var url = this.getAttribute('data-toggle-url');
                    var form = document.createElement('form');
                    form.method = 'POST';
                    form.action = url;
                    document.body.appendChild(form);
                    form.submit();
                  });
                });
```

- [ ] **Step 4: 新增隐藏按钮样式**

在 `<style>` 标签中，为 `.order-btn.is-hidden` 新增样式：

```css
          .order-btn.is-hidden {
            background: #fef3c7;
            border-color: #f59e0b;
            color: #d97706;
          }
          .order-btn.is-hidden:hover {
            background: #f59e0b;
            color: #fff;
          }
```

- [ ] **Step 5: 提交**

```bash
git add src/admin/views/models.tsx
git commit -m "feat: add copy button and hidden toggle to admin models list"
```

---

### Task 6: 在首页新增模型列表表格

**Files:**
- Modify: `src/user/views/home.tsx`
- Modify: `src/user/routes/home.tsx`（确认路由传递数据）

- [ ] **Step 1: 在首页视图中新增模型列表表格**

读取 `src/user/views/home.tsx`，找到 "参考信息区域"（`<div class="reference-section">`）之前，插入新的模型列表表格卡片：

在 `</div>  <!-- API Key 卡片 -->` 之后、`<div class="reference-section">` 之前，新增：

```tsx
      {/* 可用模型列表 */}
      <div class="card">
        <div class="card-header">
          <span class="card-icon">📋</span>
          <h2>可用模型列表</h2>
        </div>
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.78rem;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border);">
                <th style="text-align: left; padding: 0.4rem 0.6rem; color: var(--text-secondary); font-weight: 600;">模型名称</th>
                <th style="text-align: left; padding: 0.4rem 0.6rem; color: var(--text-secondary); font-weight: 600;">真实模型</th>
                <th style="text-align: left; padding: 0.4rem 0.6rem; color: var(--text-secondary); font-weight: 600;">描述</th>
              </tr>
            </thead>
            <tbody>
              {props.models
                .filter(m => !m.hidden)
                .map((model) => (
                  <tr style="border-bottom: 1px solid #f3f4f6;">
                    <td style="padding: 0.35rem 0.6rem; font-weight: 600;">{model.customModel}</td>
                    <td style="padding: 0.35rem 0.6rem; color: var(--text-secondary);">{model.realModel}</td>
                    <td style="padding: 0.35rem 0.6rem; color: var(--text-secondary);">{model.desc || '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
```

注意：`.filter(m => !m.hidden)` 确保隐藏模型不在首页展示。

- [ ] **Step 2: 确认首页路由传递了完整的 models 数据**

读取 `src/user/routes/home.tsx`，确认 `models` prop 已经包含完整数据（包含 hidden 字段）。如果已有，无需修改。

- [ ] **Step 3: 提交**

```bash
git add src/user/views/home.tsx
git commit -m "feat: add models list table to home page, filter hidden models"
```

---

### Task 7: E2E 测试 - 复制和隐藏完整流程

**Files:**
- Create: `tests/e2e/admin-model-management.e2e.test.ts`

- [ ] **Step 1: 编写 E2E 测试**

创建 `tests/e2e/admin-model-management.e2e.test.ts`：

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import type { ProxyConfig } from '../../src/config.js';

describe('Admin Model Management E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;

  const testConfig: ProxyConfig = {
    models: [
      { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key1', baseUrl: 'https://api.openai.com', provider: 'openai' },
      { customModel: 'claude', realModel: 'claude-3', apiKey: 'key2', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
    ],
    adminPassword: undefined,
    apiKeys: [],
  };

  beforeAll(() => {
    testLogDir = join(tmpdir(), 'test-model-mgmt-' + Date.now());
    testConfigPath = join(testLogDir, 'config.json');
    mkdirSync(testLogDir, { recursive: true });
    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);
    app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);
  });

  afterAll(() => {
    rmSync(testLogDir, { recursive: true, force: true });
  });

  describe('Model Copy', () => {
    it('should copy a model and redirect to edit page', async () => {
      const response = await app.request('/admin/models/copy/gpt-4', { method: 'POST' });
      expect(response.status).toBe(302);

      const location = response.headers.get('Location');
      expect(location).toContain('/admin/models/edit/gpt-4-');

      // 验证配置文件中模型数量变为 3
      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      expect(config.models.length).toBe(3);
      expect(config.models[0].customModel).toContain('gpt-4-');
      expect(config.models[0].hidden).toBe(false);
    });
  });

  describe('Model Hidden/Toggle', () => {
    it('should hide a model and move it to the end', async () => {
      const response = await app.request('/admin/models/toggle-hidden/gpt-4', { method: 'POST' });
      expect(response.status).toBe(302);

      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      const lastModel = config.models[config.models.length - 1];
      expect(lastModel.customModel).toBe('gpt-4');
      expect(lastModel.hidden).toBe(true);
    });

    it('should unhide a model and move it to first', async () => {
      const response = await app.request('/admin/models/toggle-hidden/gpt-4', { method: 'POST' });
      expect(response.status).toBe(302);

      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      const firstModel = config.models[0];
      expect(firstModel.customModel).toBe('gpt-4');
      expect(firstModel.hidden).toBe(false);
    });
  });
});
```

- [ ] **Step 2: 运行 E2E 测试确认通过**

Run: `npx vitest run tests/e2e/admin-model-management.e2e.test.ts -v`
Expected: 3 个测试全部 PASS

- [ ] **Step 3: 提交**

```bash
git add tests/e2e/admin-model-management.e2e.test.ts
git commit -m "test: add E2E tests for model copy and hidden"
```

---

### Task 8: 全量测试和最终检查

- [ ] **Step 1: 运行全量测试**

Run: `npx vitest run`
Expected: 全部测试 PASS

- [ ] **Step 2: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 提交最终代码**

```bash
git add -A
git commit -m "feat: complete model management - copy, hidden, home page list"
```
