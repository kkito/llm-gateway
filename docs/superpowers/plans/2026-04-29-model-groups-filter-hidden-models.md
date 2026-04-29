# Model Groups 过滤隐藏模型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Model Groups 的新增/编辑流程中，过滤掉 `hidden: true` 的模型，仅显示可见模型。

**Architecture:** 在路由层 `src/admin/routes/model-group-form.tsx` 中添加 `getVisibleModels` 辅助函数，统一过滤逻辑。所有将 `proxyConfig.models` 传给视图的地方，替换为过滤后的列表。采用 TDD 方式，先编写测试验证过滤逻辑。

**Tech Stack:** TypeScript, Hono, Vitest, JSX (Hono JSX)

---

## File Structure

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/admin/routes/model-group-form.tsx` | Modify | 添加 `getVisibleModels` 函数，修改所有路由处理函数 |
| `tests/routes/model-group-form.test.tsx` | Create | 测试路由层的模型过滤逻辑 |

---

### Task 1: 编写路由层过滤逻辑的测试

**Files:**
- Create: `tests/routes/model-group-form.test.tsx`

- [ ] **Step 1: 创建测试文件，编写 `getVisibleModels` 函数的单元测试**

```typescript
import { describe, it, expect } from 'vitest';
import type { ProviderConfig } from '../../src/config.js';

// 模拟 getVisibleModels 函数（将在实现中添加）
function getVisibleModels(config: { models: ProviderConfig[] }): ProviderConfig[] {
  return config.models.filter(m => m.hidden !== true);
}

describe('getVisibleModels', () => {
  it('should return all models when no hidden field is set', () => {
    const models: ProviderConfig[] = [
      { customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'url', provider: 'openai' },
      { customModel: 'model-b', realModel: 'real-b', apiKey: 'key', baseUrl: 'url', provider: 'openai' },
    ];
    const result = getVisibleModels({ models });
    expect(result).toHaveLength(2);
    expect(result.map(m => m.customModel)).toEqual(['model-a', 'model-b']);
  });

  it('should filter out models with hidden: true', () => {
    const models: ProviderConfig[] = [
      { customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'url', provider: 'openai' },
      { customModel: 'model-b', realModel: 'real-b', apiKey: 'key', baseUrl: 'url', provider: 'openai', hidden: true },
      { customModel: 'model-c', realModel: 'real-c', apiKey: 'key', baseUrl: 'url', provider: 'openai' },
    ];
    const result = getVisibleModels({ models });
    expect(result).toHaveLength(2);
    expect(result.map(m => m.customModel)).toEqual(['model-a', 'model-c']);
  });

  it('should keep models with hidden: false', () => {
    const models: ProviderConfig[] = [
      { customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'url', provider: 'openai', hidden: false },
      { customModel: 'model-b', realModel: 'real-b', apiKey: 'key', baseUrl: 'url', provider: 'openai', hidden: true },
    ];
    const result = getVisibleModels({ models });
    expect(result).toHaveLength(1);
    expect(result[0].customModel).toBe('model-a');
  });

  it('should return empty array when all models are hidden', () => {
    const models: ProviderConfig[] = [
      { customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'url', provider: 'openai', hidden: true },
    ];
    const result = getVisibleModels({ models });
    expect(result).toHaveLength(0);
  });

  it('should return empty array when models is empty', () => {
    const result = getVisibleModels({ models: [] });
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试验证（预期失败，因为函数还未在路由文件中实现）**

Run: `cd /Users/kkito/proj/github/llm-gateway && npx vitest run tests/routes/model-group-form.test.tsx`
Expected: PASS (因为测试文件中有独立的函数定义，实际实现后会导入真实函数)

- [ ] **Step 3: 修改测试文件，导入真实的 `getVisibleModels`（将在 Task 2 中实现）**

```typescript
import { describe, it, expect } from 'vitest';
import { getVisibleModels } from '../../src/admin/routes/model-group-form.js';
import type { ProviderConfig } from '../../src/config.js';

describe('getVisibleModels', () => {
  it('should return all models when no hidden field is set', () => {
    const models: ProviderConfig[] = [
      { customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'url', provider: 'openai' },
      { customModel: 'model-b', realModel: 'real-b', apiKey: 'key', baseUrl: 'url', provider: 'openai' },
    ];
    const result = getVisibleModels({ models });
    expect(result).toHaveLength(2);
    expect(result.map(m => m.customModel)).toEqual(['model-a', 'model-b']);
  });

  it('should filter out models with hidden: true', () => {
    const models: ProviderConfig[] = [
      { customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'url', provider: 'openai' },
      { customModel: 'model-b', realModel: 'real-b', apiKey: 'key', baseUrl: 'url', provider: 'openai', hidden: true },
      { customModel: 'model-c', realModel: 'real-c', apiKey: 'key', baseUrl: 'url', provider: 'openai' },
    ];
    const result = getVisibleModels({ models });
    expect(result).toHaveLength(2);
    expect(result.map(m => m.customModel)).toEqual(['model-a', 'model-c']);
  });

  it('should keep models with hidden: false', () => {
    const models: ProviderConfig[] = [
      { customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'url', provider: 'openai', hidden: false },
      { customModel: 'model-b', realModel: 'real-b', apiKey: 'key', baseUrl: 'url', provider: 'openai', hidden: true },
    ];
    const result = getVisibleModels({ models });
    expect(result).toHaveLength(1);
    expect(result[0].customModel).toBe('model-a');
  });

  it('should return empty array when all models are hidden', () => {
    const models: ProviderConfig[] = [
      { customModel: 'model-a', realModel: 'real-a', apiKey: 'key', baseUrl: 'url', provider: 'openai', hidden: true },
    ];
    const result = getVisibleModels({ models });
    expect(result).toHaveLength(0);
  });

  it('should return empty array when models is empty', () => {
    const result = getVisibleModels({ models: [] });
    expect(result).toHaveLength(0);
  });
});
```

---

### Task 2: 在路由文件中实现 `getVisibleModels` 函数

**Files:**
- Modify: `src/admin/routes/model-group-form.tsx:1-15`

- [ ] **Step 1: 在路由文件顶部添加 `getVisibleModels` 函数**

在 `import { Hono } from 'hono';` 之后添加：

```typescript
import { Hono } from 'hono';
import type { ProxyConfig, ProviderConfig } from '../../config.js';
import { loadFullConfig, saveConfig } from '../../config.js';
import { ModelGroupFormPage } from '../views/model-group-form.js';

/**
 * 过滤出可见的模型（hidden !== true）
 */
function getVisibleModels(config: ProxyConfig): ProviderConfig[] {
  return config.models.filter(m => m.hidden !== true);
}
```

- [ ] **Step 2: 运行测试验证函数实现正确**

Run: `cd /Users/kkito/proj/github/llm-gateway && npx vitest run tests/routes/model-group-form.test.tsx`
Expected: PASS

---

### Task 3: 修改所有路由处理函数，使用 `getVisibleModels`

**Files:**
- Modify: `src/admin/routes/model-group-form.tsx`

需要修改以下位置，将 `proxyConfig.models` 替换为 `getVisibleModels(proxyConfig)`：

- [ ] **Step 1: 修改 GET /admin/model-groups/new（新增表单）**

找到约第14行：
```typescript
// 原代码
return c.html(<ModelGroupFormPage models={proxyConfig.models} />);
// 改为
return c.html(<ModelGroupFormPage models={getVisibleModels(proxyConfig)} />);
```

- [ ] **Step 2: 修改 POST /admin/model-groups（新增保存 - 组名格式错误回显）**

找到约第36行：
```typescript
// 原代码
return c.html(<ModelGroupFormPage models={proxyConfig.models} error="组名只能包含字母、数字、下划线、中划线、点" />);
// 改为
return c.html(<ModelGroupFormPage models={getVisibleModels(proxyConfig)} error="组名只能包含字母、数字、下划线、中划线、点" />);
```

- [ ] **Step 3: 修改 POST /admin/model-groups（新增保存 - JSON 格式错误回显）**

找到约第46行：
```typescript
// 原代码
return c.html(<ModelGroupFormPage models={proxyConfig.models} error="模型数据格式错误" />);
// 改为
return c.html(<ModelGroupFormPage models={getVisibleModels(proxyConfig)} error="模型数据格式错误" />);
```

- [ ] **Step 4: 修改 POST /admin/model-groups（新增保存 - 组名已存在回显）**

找到约第53行：
```typescript
// 原代码
return c.html(<ModelGroupFormPage models={proxyConfig.models} error={`组名 "${name}" 已存在`} />);
// 改为
return c.html(<ModelGroupFormPage models={getVisibleModels(proxyConfig)} error={`组名 "${name}" 已存在`} />);
```

- [ ] **Step 5: 修改 POST /admin/model-groups（新增保存 - 未选择模型回显）**

找到约第57行：
```typescript
// 原代码
return c.html(<ModelGroupFormPage models={proxyConfig.models} error="请至少选择一个模型" />);
// 改为
return c.html(<ModelGroupFormPage models={getVisibleModels(proxyConfig)} error="请至少选择一个模型" />);
```

- [ ] **Step 6: 修改 POST /admin/model-groups（新增保存 - 保存失败回显）**

找到约第64行：
```typescript
// 原代码
return c.html(<ModelGroupFormPage models={proxyConfig.models} error={`保存失败：${error.message}`} />);
// 改为
return c.html(<ModelGroupFormPage models={getVisibleModels(proxyConfig)} error={`保存失败：${error.message}`} />);
```

- [ ] **Step 7: 修改 GET /admin/model-groups/edit/:name（编辑表单 - 未找到组）**

找到约第78行：
```typescript
// 原代码
return c.html(<ModelGroupFormPage models={proxyConfig.models} error={`未找到 Model Group：${name}`} isEdit />);
// 改为
return c.html(<ModelGroupFormPage models={getVisibleModels(proxyConfig)} error={`未找到 Model Group：${name}`} isEdit />);
```

- [ ] **Step 8: 修改 GET /admin/model-groups/edit/:name（编辑表单 - 正常显示）**

找到约第81行：
```typescript
// 原代码
return c.html(<ModelGroupFormPage models={proxyConfig.models} group={group} isEdit />);
// 改为
return c.html(<ModelGroupFormPage models={getVisibleModels(proxyConfig)} group={group} isEdit />);
```

- [ ] **Step 9: 修改 GET /admin/model-groups/edit/:name（编辑表单 - 加载失败）**

找到约第76行：
```typescript
// 原代码
return c.html(<ModelGroupFormPage models={[]} error={`加载配置失败：${error.message}`} isEdit />);
// 改为（保持原样，因为加载失败时没有 proxyConfig）
// 此处的 models={[]} 保持不变，因为无法获取配置
```

- [ ] **Step 10: 修改 POST /admin/model-groups/edit/:name（编辑保存 - 组名格式错误回显）**

找到约第94行：
```typescript
// 原代码
return c.html(<ModelGroupFormPage models={proxyConfig.models} group={group} error="组名只能包含字母、数字、下划线、中划线、点" isEdit />);
// 改为
return c.html(<ModelGroupFormPage models={getVisibleModels(proxyConfig)} group={group} error="组名只能包含字母、数字、下划线、中划线、点" isEdit />);
```

- [ ] **Step 11: 修改 POST /admin/model-groups/edit/:name（编辑保存 - 组名冲突回显）**

找到约第111行：
```typescript
// 原代码
return c.html(<ModelGroupFormPage models={proxyConfig.models} group={group} error={`组名 "${name}" 已存在`} isEdit />);
// 改为
return c.html(<ModelGroupFormPage models={getVisibleModels(proxyConfig)} group={group} error={`组名 "${name}" 已存在`} isEdit />);
```

- [ ] **Step 12: 修改 POST /admin/model-groups/edit/:name（编辑保存 - 保存失败回显）**

找到约第120行：
```typescript
// 原代码
return c.html(<ModelGroupFormPage models={proxyConfig.models} group={group} error={`保存失败：${error.message}`} isEdit />);
// 改为
return c.html(<ModelGroupFormPage models={getVisibleModels(proxyConfig)} group={group} error={`保存失败：${error.message}`} isEdit />);
```

---

### Task 4: 运行完整测试验证

- [ ] **Step 1: 运行所有测试**

Run: `cd /Users/kkito/proj/github/llm-gateway && pnpm test`
Expected: All tests pass

- [ ] **Step 2: 运行构建验证**

Run: `cd /Users/kkito/proj/github/llm-gateway && pnpm build`
Expected: Build succeeds with no errors

---

### Task 5: 手动验证

- [ ] **Step 1: 启动开发服务器**

Run: `cd /Users/kkito/proj/github/llm-gateway && pnpm dev`
Expected: Server starts successfully

- [ ] **Step 2: 验证新增表单过滤**

访问 `http://localhost:3000/admin/model-groups/new`，确认可选模型列表不包含 `hidden: true` 的模型

- [ ] **Step 3: 验证编辑表单过滤**

访问 `http://localhost:3000/admin/model-groups/edit/<group-name>`，确认可用模型列表已过滤

---

### Task 6: 提交更改

- [ ] **Step 1: 检查 git 状态**

Run: `cd /Users/kkito/proj/github/llm-gateway && git status`
Expected: 显示修改的文件

- [ ] **Step 2: 添加文件到暂存区**

Run: `cd /Users/kkito/proj/github/llm-gateway && git add src/admin/routes/model-group-form.tsx tests/routes/model-group-form.test.tsx docs/superpowers/specs/2026-04-29-model-groups-filter-hidden-models-design.md docs/superpowers/plans/2026-04-29-model-groups-filter-hidden-models.md`

- [ ] **Step 3: 提交**

Run: `cd /Users/kkito/proj/github/llm-gateway && git commit -m "feat: filter hidden models in model-groups form

- Add getVisibleModels helper to filter out hidden: true models
- Update all route handlers in model-group-form to use filtered models
- Add tests for getVisibleModels function
- Add design and implementation plan docs"`

- [ ] **Step 4: 验证提交成功**

Run: `cd /Users/kkito/proj/github/llm-gateway && git status`
Expected: Working tree clean
