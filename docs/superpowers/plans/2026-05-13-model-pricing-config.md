# 模型价格配置功能实现计划

&gt; **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在后台模型配置页面添加价格配置功能，支持设置每百万 token 的输入、输出、缓存价格。

**Architecture:** 创建独立的 PricingConfig 组件，在 model-form.tsx 中引入使用，在 model-form.tsx 路由中处理价格字段的保存。

**Tech Stack:** TypeScript, Hono, JSX

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/admin/components/PricingConfig.tsx` | 新增，价格配置表单组件 |
| `src/admin/views/model-form.tsx` | 修改，引入并使用新组件 |
| `src/admin/routes/model-form.tsx` | 修改，处理表单提交的价格字段 |
| `tests/components/pricing-config.test.tsx` | 新增，PricingConfig 组件测试 |

---

## 任务分解

### Task 1: 创建 PricingConfig 组件

**Files:**
- Create: `src/admin/components/PricingConfig.tsx`

- [ ] **Step 1: 创建 PricingConfig 组件文件**

```tsx
import { FC } from 'hono/jsx';

interface Props {
  inputPricePer1M?: number;
  outputPricePer1M?: number;
  cachedPricePer1M?: number;
}

export const PricingConfig: FC&lt;Props&gt; = ({ 
  inputPricePer1M, 
  outputPricePer1M, 
  cachedPricePer1M 
}) =&gt; {
  const safeValue = (val: number | undefined) =&gt; val !== undefined ? val : '';

  return (
    &lt;div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)' }}&gt;
      &lt;h2 style={{ 
        fontFamily: 'system-ui, -apple-system, sans-serif', 
        fontWeight: '700', 
        fontSize: '1.25rem', 
        marginBottom: '1rem' 
      }}&gt;
        价格配置
      &lt;/h2&gt;
      &lt;p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}&gt;
        配置模型的 token 计费价格，用于费用统计（单位：元/每百万 token）
      &lt;/p&gt;

      &lt;div className="form-group"&gt;
        &lt;label className="form-label" for="inputPricePer1M"&gt;
          输入 Token 价格
          &lt;input
            className="form-input"
            id="inputPricePer1M"
            name="inputPricePer1M"
            type="number"
            min="0"
            step="any"
            placeholder="例如：0.15"
            value={safeValue(inputPricePer1M)}
          /&gt;
          &lt;span className="form-hint"&gt;每百万输入 token 的价格（元）&lt;/span&gt;
        &lt;/label&gt;
      &lt;/div&gt;

      &lt;div className="form-group"&gt;
        &lt;label className="form-label" for="outputPricePer1M"&gt;
          输出 Token 价格
          &lt;input
            className="form-input"
            id="outputPricePer1M"
            name="outputPricePer1M"
            type="number"
            min="0"
            step="any"
            placeholder="例如：0.30"
            value={safeValue(outputPricePer1M)}
          /&gt;
          &lt;span className="form-hint"&gt;每百万输出 token 的价格（元）&lt;/span&gt;
        &lt;/label&gt;
      &lt;/div&gt;

      &lt;div className="form-group"&gt;
        &lt;label className="form-label" for="cachedPricePer1M"&gt;
          缓存 Token 价格
          &lt;input
            className="form-input"
            id="cachedPricePer1M"
            name="cachedPricePer1M"
            type="number"
            min="0"
            step="any"
            placeholder="例如：0.05"
            value={safeValue(cachedPricePer1M)}
          /&gt;
          &lt;span className="form-hint"&gt;每百万缓存 token 的价格（元）&lt;/span&gt;
        &lt;/label&gt;
      &lt;/div&gt;
    &lt;/div&gt;
  );
};
```

- [ ] **Step 2: 验证文件创建成功**

---

### Task 2: 修改 model-form.tsx 视图引入新组件

**Files:**
- Modify: `src/admin/views/model-form.tsx`

- [ ] **Step 1: 在文件顶部添加 PricingConfig 组件的导入**

在现有 import 语句后面添加：
```tsx
import { PricingConfig } from '../components/PricingConfig.js';
```

- [ ] **Step 2: 在表单中添加 PricingConfig 组件**

找到 `&lt;ModelTest defaultParams={props.model?.defaultParams} /&gt;` 这一行，在它**之前**插入：
```tsx
&lt;PricingConfig 
  inputPricePer1M={props.model?.inputPricePer1M}
  outputPricePer1M={props.model?.outputPricePer1M}
  cachedPricePer1M={props.model?.cachedPricePer1M}
/&gt;
```

---

### Task 3: 修改路由处理价格字段的保存（新增模型）

**Files:**
- Modify: `src/admin/routes/model-form.tsx`

- [ ] **Step 1: 在保存新配置的 POST 路由中添加价格字段解析**

找到第 202-294 行（保存新配置的 `app.post('/admin/models', ...)`），在解析 `defaultParams` 之后添加价格字段解析：

```ts
// 解析价格字段
const parsePrice = (val: unknown): number | undefined =&gt; {
  if (val === undefined || val === null || val === '') return undefined;
  const num = Number(val);
  if (!isNaN(num) &amp;&amp; num &gt;= 0) return num;
  return undefined;
};

const inputPricePer1M = parsePrice(body.inputPricePer1M);
const outputPricePer1M = parsePrice(body.outputPricePer1M);
const cachedPricePer1M = parsePrice(body.cachedPricePer1M);
```

- [ ] **Step 2: 在创建新配置时添加价格字段**

找到第 270-278 行的 `newConfig` 对象，添加价格字段：

```ts
const newConfig: ProviderConfig = {
  customModel,
  realModel,
  apiKey: finalApiKey,
  baseUrl,
  provider,
  desc: desc || undefined,
  defaultParams,
  inputPricePer1M,
  outputPricePer1M,
  cachedPricePer1M,
};
```

---

### Task 4: 修改路由处理价格字段的保存（编辑模型）

**Files:**
- Modify: `src/admin/routes/model-form.tsx`

- [ ] **Step 1: 在编辑配置的 POST 路由中添加价格字段解析**

找到第 316-444 行（保存编辑的 `app.post('/admin/models/edit/:model', ...)`），在解析 `defaultParams` 之后添加价格字段解析（复用上面的 parsePrice 逻辑）：

```ts
// 解析价格字段
const parsePrice = (val: unknown): number | undefined =&gt; {
  if (val === undefined || val === null || val === '') return undefined;
  const num = Number(val);
  if (!isNaN(num) &amp;&amp; num &gt;= 0) return num;
  return undefined;
};

const inputPricePer1M = parsePrice(body.inputPricePer1M);
const outputPricePer1M = parsePrice(body.outputPricePer1M);
const cachedPricePer1M = parsePrice(body.cachedPricePer1M);
```

- [ ] **Step 2: 在更新配置时使用新的价格字段**

找到第 390-403 行的 `newEntry` 对象，修改价格字段：

```ts
const newEntry: ProviderConfig = {
  customModel,
  realModel,
  apiKey: finalApiKey,
  baseUrl,
  provider,
  desc: desc || undefined,
  limits: oldEntry.limits,
  inputPricePer1M,
  outputPricePer1M,
  cachedPricePer1M,
  hidden: hidden || undefined,
  defaultParams,
};
```

---

### Task 5: 创建 PricingConfig 组件的测试

**Files:**
- Create: `tests/components/pricing-config.test.tsx`

- [ ] **Step 1: 创建测试文件**

```tsx
import { describe, it, expect } from 'vitest';
import { PricingConfig } from '../../src/admin/components/PricingConfig.js';

describe('PricingConfig', () =&gt; {
  it('should render without errors when no props are provided', () =&gt; {
    const html = String(&lt;PricingConfig /&gt;);
    expect(html).toContain('价格配置');
    expect(html).toContain('inputPricePer1M');
    expect(html).toContain('outputPricePer1M');
    expect(html).toContain('cachedPricePer1M');
  });

  it('should render with provided price values', () =&gt; {
    const html = String(
      &lt;PricingConfig 
        inputPricePer1M={0.15}
        outputPricePer1M={0.30}
        cachedPricePer1M={0.05}
      /&gt;,
    );
    expect(html).toContain('0.15');
    expect(html).toContain('0.30');
    expect(html).toContain('0.05');
  });

  it('should have number inputs with min="0"', () =&gt; {
    const html = String(&lt;PricingConfig /&gt;);
    expect(html).toContain('type="number"');
    expect(html).toContain('min="0"');
    expect(html).toContain('step="any"');
  });
});
```

---

### Task 6: 运行测试验证

**Files:**
- Run: 项目的测试命令

- [ ] **Step 1: 查看项目的 package.json 找到测试命令**
- [ ] **Step 2: 运行测试确保没有错误**
