# 后台模型使用限制配置功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在后台模型表单中添加使用限制配置功能，支持按请求次数、Token 数、金额限制，以及单条规则的增删改。

**Architecture:** 采用手风琴式 UI，默认简洁只在需要时展开。限制配置作为 ProviderConfig 的一部分保存到 config.json。

**Tech Stack:** Hono + JSX, Vitest (单元测试), Playwright (E2E 测试)

---

## 文件结构

```
src/
├── admin/
│   ├── views/
│   │   └── model-form.tsx        # 修改：添加限制配置 UI
│   └── routes/
│       └── model-form.tsx        # 修改：处理限制配置提交

tests/
├── e2e/
│   └── admin-model-limit.e2e.test.ts  # 新增：E2E 测试
```

---

## Task 1: 修改 ModelFormPage 视图组件

**Files:**
- Modify: `src/admin/views/model-form.tsx:1-100`
- Test: `tests/e2e/admin-model-limit.e2e.test.ts`

- [ ] **Step 1: 添加类型定义和状态管理**

在文件顶部添加限制配置的接口定义和状态管理：

```typescript
import { FC, useState } from 'hono/jsx';

// 限制规则表单数据类型
interface LimitFormData {
  id: string;
  type: 'requests' | 'input_tokens' | 'cost' | '';
  period: 'day' | 'hours' | 'week' | 'month' | '';
  periodValue?: number;
  max?: number;
  inputPricePer1M?: number;
  outputPricePer1M?: number;
  cachedPricePer1M?: number;
}
```

- [ ] **Step 2: 添加限制配置 UI 组件**

在 ModelFormPage 组件的表单底部（在描述字段之后、提交按钮之前）添加：

```tsx
{/* 使用限制配置区域 */}
<h3 style="margin-top: 1.5rem">使用限制</h3>
<button
  type="button"
  onclick={addLimitRule}
  style="margin-bottom: 1rem"
>
  [+] 添加限制规则
</button>

{props.model?.limits?.map((limit, index) => (
  <div class="limit-card" style="border: 1px solid #ccc; padding: 1rem; margin-bottom: 0.5rem">
    <label>
      限制类型
      <select
        name={`limits[${index}].type`}
        value={limit.type}
      >
        <option value="">请选择...</option>
        <option value="requests">按请求次数</option>
        <option value="input_tokens">按 Token 数</option>
        <option value="cost">按金额</option>
      </select>
    </label>
    {/* 根据类型显示/隐藏相应字段 */}
    {limit.type === 'cost' ? (
      <div>
        <label>
          限制金额
          <input name={`limits[${index}].max`} type="number" value={limit.max} />
          美元
        </label>
        {/* 价格配置 */}
        <label>
          输入单价 ($/百万 token)
          <input name={`limits[${index}].inputPricePer1M`} type="number" step="0.01" value={limit.inputPricePer1M} />
        </label>
        {/* ... outputPricePer1M, cachedPricePer1M */}
      </div>
    ) : (
      <div>
        <label>
          时间周期
          <select name={`limits[${index}].period`} value={limit.period}>
            <option value="">请选择...</option>
            <option value="day">按天</option>
            <option value="week">按周</option>
            <option value="month">按月</option>
            <option value="hours">按小时</option>
          </select>
        </label>
        {limit.period === 'hours' && (
          <label>
            小时数
            <input name={`limits[${index}].periodValue`} type="number" value={limit.periodValue} />
          </label>
        )}
        <label>
          限制数值
          <input name={`limits[${index}].max`} type="number" value={limit.max} />
        </label>
      </div>
    )}
  </div>
))}
```

- [ ] **Step 3: 支持 JavaScript 动态添加规则**

添加客户端 JavaScript 用于动态添加/删除限制规则卡片。

---

## Task 2: 修改 ModelFormPage 路由处理

**Files:**
- Modify: `src/admin/routes/model-form.tsx:50-90`
- Test: `tests/e2e/admin-model-limit.e2e.test.ts`

- [ ] **Step 1: 修改创建模型时的限制配置处理**

在 POST `/admin/models` 路由中，解析限制配置字段：

```typescript
// 解析限制配置
const limits: ModelLimit[] = [];
const limitTypes = body['limits[].type'];

// 如果有 limits 参数，解析它们
if (Array.isArray(limitTypes)) {
  for (let i = 0; i < limitTypes.length; i++) {
    const type = body[`limits[${i}].type`] as string;
    if (!type) continue;
    
    const limit: ModelLimit = {
      type: type as 'requests' | 'input_tokens' | 'cost',
      max: parseInt(body[`limits[${i}].max`] as string) || 0
    };
    
    if (type !== 'cost') {
      limit.period = body[`limits[${i}].period`] as any;
      if (limit.period === 'hours') {
        limit.periodValue = parseInt(body[`limits[${i}].periodValue`] as string);
      }
    }
    
    limits.push(limit);
  }
}

// 创建新配置时包含限制
const newConfig: ProviderConfig = {
  customModel,
  realModel,
  apiKey: finalApiKey,
  baseUrl,
  provider,
  desc: desc || undefined,
  limits: limits.length > 0 ? limits : undefined,
  inputPricePer1M: /* 从表单解析 */,
  outputPricePer1M: /* 从表单解析 */,
  cachedPricePer1M: /* 从表单解析 */,
};
```

- [ ] **Step 2: 修改编辑模型时的限制配置处理**

在 POST `/admin/models/edit/:model` 路由中同样解析并保存限制配置。

---

## Task 3: 编写 E2E 测试

**Files:**
- Create: `tests/e2e/admin-model-limit.e2e.test.ts`

- [ ] **Step 1: 编写测试文件结构**

基于 `tests/e2e/admin-models-form.e2e.test.ts` 的模式创建新测试文件。

- [ ] **Step 2: 测试创建模型 - 无限制**

```typescript
it('创建模型 - 无限制', async () => {
  const formData = new FormData();
  formData.append('customModel', 'free-model');
  // ... 基础字段，无 limits 参数

  const response = await app.request('/admin/models', { method: 'POST', body: formData });
  expect(response.status).toBe(302);

  const savedConfig = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
  const model = savedConfig.models.find((m: any) => m.customModel === 'free-model');
  expect(model.limits).toBeUndefined();
});
```

- [ ] **Step 3: 测试创建模型 - 按请求次数限制**

```typescript
it('创建模型 - 按请求次数（按天）', async () => {
  const formData = new FormData();
  formData.append('customModel', 'rate-limited-model');
  // ... 基础字段
  formData.append('limits[0].type', 'requests');
  formData.append('limits[0].period', 'day');
  formData.append('limits[0].max', '1000');

  const response = await app.request('/admin/models', { method: 'POST', body: formData });
  expect(response.status).toBe(302);

  const savedConfig = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
  const model = savedConfig.models.find((m: any) => m.customModel === 'rate-limited-model');
  expect(model.limits).toHaveLength(1);
  expect(model.limits[0].type).toBe('requests');
  expect(model.limits[0].period).toBe('day');
  expect(model.limits[0].max).toBe(1000);
});
```

- [ ] **Step 4: 测试创建模型 - 按 Token 数限制（按小时）**

```typescript
it('创建模型 - 按 Token 数（按小时）', async () => {
  const formData = new FormData();
  formData.append('customModel', 'token-limited-model');
  // ... 基础字段
  formData.append('limits[0].type', 'input_tokens');
  formData.append('limits[0].period', 'hours');
  formData.append('limits[0].periodValue', '24');
  formData.append('limits[0].max', '100000');

  const response = await app.request('/admin/models', { method: 'POST', body: formData });
  // 验证...
});
```

- [ ] **Step 5: 测试创建模型 - 按金额限制**

```typescript
it('创建模型 - 按金额限制', async () => {
  const formData = new FormData();
  formData.append('customModel', 'cost-limited-model');
  // ... 基础字段
  formData.append('limits[0].type', 'cost');
  formData.append('limits[0].max', '100');
  formData.append('limits[0].inputPricePer1M', '3.0');
  formData.append('limits[0].outputPricePer1M', '15.0');

  const response = await app.request('/admin/models', { method: 'POST', body: formData });
  // 验证...
});
```

- [ ] **Step 6: 测试创建模型 - 多条限制**

```typescript
it('创建模型 - 多条限制', async () => {
  const formData = new FormData();
  formData.append('customModel', 'multi-limited-model');
  // ... 基础字段
  formData.append('limits[0].type', 'requests');
  formData.append('limits[0].period', 'day');
  formData.append('limits[0].max', '1000');
  formData.append('limits[1].type', 'input_tokens');
  formData.append('limits[1].period', 'month');
  formData.append('limits[1].max', '100000');

  const response = await app.request('/admin/models', { method: 'POST', body: formData });
  const savedConfig = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
  const model = savedConfig.models.find((m: any) => m.customModel === 'multi-limited-model');
  expect(model.limits).toHaveLength(2);
});
```

- [ ] **Step 7: 测试编辑模型 - 修改限制**

```typescript
it('编辑模型 - 修改限制', async () => {
  // 先创建一个有限制的模型
  // 然后编辑它，修改限制
  // 验证修改成功
});
```

- [ ] **Step 8: 测试编辑模型 - 删除限制**

```typescript
it('编辑模型 - 删除限制', async () => {
  // 先创建一个有限制的模型
  // 然后编辑它，删除限制
  // 验证删除成功
});
```

---

## Task 4: 运行测试验证

- [ ] **Step 1: 运行 E2E 测试**

```bash
pnpm test tests/e2e/admin-model-limit.e2e.test.ts
```

- [ ] **Step 2: 确保所有测试通过**

---

## Task 5: 提交代码

- [ ] **Step 1: 提交更改**

```bash
git add src/admin/views/model-form.tsx src/admin/routes/model-form.tsx tests/e2e/admin-model-limit.e2e.test.ts
git commit -m "feat(admin): 添加模型使用限制配置功能

- 在后台模型表单中添加限制配置 UI（手风琴式展开）
- 支持按请求次数、Token 数、金额限制
- 支持多条限制规则同时生效
- 添加完整的 E2E 测试覆盖"
```