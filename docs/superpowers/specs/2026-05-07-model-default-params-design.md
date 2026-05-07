# 模型默认参数配置 — 设计文档

## 背景

当前系统支持多模型代理，但无法为每个模型设置默认参数（如 `temperature`、`max_tokens`、`thinking` 等）。用户需要在每次请求时手动传递这些参数。

本功能允许管理员在后台为每个模型配置默认参数，请求时自动合并（用户参数优先级更高）。

---

## 需求概述

1. 每个模型独立配置默认参数
2. 支持任意 JSON 对象格式的参数
3. 双栏 JSON 编辑器：左栏输入，右栏实时格式化 + 红绿背景提示有效性
4. 合并策略：深度递归合并，用户参数优先级更高
5. 合并时机：**格式转换之后**合并（确保参数格式与目标 provider 一致）

---

## 设计

### 1. 数据模型

`ProviderConfig` 新增字段：

```typescript
export interface ProviderConfig {
  // ... 现有字段
  defaultParams?: Record<string, any>;  // 默认参数（任意 JSON 对象）
}
```

**配置示例**：
```json
{
  "customModel": "my-claude",
  "realModel": "claude-sonnet-4-20250514",
  "provider": "anthropic",
  "defaultParams": {
    "temperature": 0.7,
    "max_tokens": 4096,
    "thinking": { "type": "disabled" }
  }
}
```

---

### 2. Web Component: `<json-editor>`

**位置**：`src/admin/components/JsonEditor.ts`

**属性**：
| 属性 | 类型 | 说明 |
|------|------|------|
| `value` | string | 初始 JSON 字符串（可空） |
| `name` | string | 表单字段名（用于提交） |

**内部结构**：
```
┌──────────────────────────────────────────┐
│  左栏（输入）          右栏（预览）        │
│  ┌──────────────┐      ┌──────────────┐  │
│  │  <textarea>  │      │    <pre>     │  │
│  │  (原始JSON)  │ ──>  │  (格式化输出) │  │
│  │              │      │  绿背景=有效  │  │
│  │              │      │  红背景=无效  │  │
│  └──────────────┘      └──────────────┘  │
│                                          │
│  [格式化] [清空]   提示文字（参考文档链接）│
└──────────────────────────────────────────┘
```

**行为**：
- `textarea` 监听 `input` 事件，实时解析 JSON
- 解析成功 → 右栏绿色背景，显示 `JSON.stringify(obj, null, 2)`
- 解析失败 → 右栏红色背景，显示错误信息
- "格式化"按钮 → 解析并美化左栏内容
- "清空"按钮 → 清空左右栏
- 表单提交 → 通过隐藏 `<input type="hidden" name="{name}">` 提交 JSON 字符串
- 右栏 `<pre>` 区域添加 `data-valid="true|false"` 属性，便于 CSS 样式控制

**CSS 样式**：
```css
.json-editor-preview[data-valid="true"] {
  background: #dcfce7;  /* 绿色 */
}
.json-editor-preview[data-valid="false"] {
  background: #fef2f2;  /* 红色 */
}
```

---

### 3. 参数合并逻辑

**位置**：`src/lib/params-merger.ts`

```typescript
/**
 * 深度递归合并对象
 * - 基本类型：override 覆盖 base
 * - 对象类型：递归合并
 * - 数组类型：override 整体替换 base
 */
export function deepMerge(base: any, override: any): any

/**
 * 合并默认参数和用户参数
 * @param defaultParams 后台配置的默认参数
 * @param userBody 用户请求体
 * @returns 合并后的请求体
 */
export function mergeModelParams(
  defaultParams: Record<string, any> | undefined,
  userBody: any
): any
```

**合并规则示例**：
```
默认: { temperature: 0.7, max_tokens: 4096, extra_body: { top_k: 50, thinking: { type: "disabled" } } }
用户: { temperature: 0.9, extra_body: { thinking: { type: "enabled" } } }
结果: { temperature: 0.9, max_tokens: 4096, extra_body: { top_k: 50, thinking: { type: "enabled" } } }
```

---

### 4. 集成点

#### 4.1 请求处理链路修改

**OpenAI 格式路由**（`src/routes/chat-completions/upstream-request.ts`）：

```typescript
// 原流程
let requestBody: any;
if (provider.provider === 'openai') {
  requestBody = { ...body, model: provider.realModel, ... };
} else {
  const anthropicRequest = await convertOpenAIRequestToAnthropic(body);
  requestBody = { ...anthropicRequest, model: provider.realModel };
}

// 新流程：合并默认参数
let requestBody: any;
if (provider.provider === 'openai') {
  requestBody = { ...body, model: provider.realModel, ... };
} else {
  const anthropicRequest = await convertOpenAIRequestToAnthropic(body);
  requestBody = { ...anthropicRequest, model: provider.realModel };
}
// 在转换后合并默认参数
requestBody = mergeModelParams(provider.defaultParams, requestBody);
```

**Anthropic 格式路由**（`src/routes/messages/upstream-request.ts`）：

```typescript
let requestBody: any;
if (provider.provider === 'anthropic') {
  requestBody = { ...body, model: provider.realModel };
} else {
  const openaiRequest = convertAnthropicRequestToOpenAI(body);
  requestBody = { ...openaiRequest, model: provider.realModel };
}
// 在转换后合并默认参数
requestBody = mergeModelParams(provider.defaultParams, requestBody);
```

#### 4.2 配置验证（`src/config.ts`）

`validateProviderConfig` 增加 `defaultParams` 校验：
- 如果存在，必须是对象类型（`typeof === 'object' && !Array.isArray`）

#### 4.3 模型表单（`src/admin/views/model-form.tsx`）

在描述字段下方添加默认参数配置区域：

```tsx
<div class="form-group">
  <label class="form-label">默认参数（可选）</label>
  <json-editor name="defaultParams" value={safeValue(props.model?.defaultParams ? JSON.stringify(props.model.defaultParams, null, 2) : '')}></json-editor>
  <span class="form-hint">
    配置模型的默认参数，请求时与用户参数合并（用户优先级更高）。
    参考：
    <a href="https://api-docs.deepseek.com/zh-cn/guides/thinking_mode" target="_blank">DeepSeek</a>,
    <a href="https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create" target="_blank">OpenAI</a>
  </span>
</div>
```

#### 4.4 模型表单路由（`src/admin/routes/model-form.tsx`）

**新增**：
- 解析 `body.defaultParams`（如果非空字符串，JSON.parse）
- 保存到 `ProviderConfig.defaultParams`

**编辑时**：
- 保留原有的 `defaultParams`，除非用户修改

---

### 5. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/config.ts` | 修改 | `ProviderConfig` 新增 `defaultParams` 字段，增加验证 |
| `src/lib/params-merger.ts` | 新增 | 深度合并逻辑 |
| `src/admin/components/JsonEditor.ts` | 新增 | Web Component 定义 |
| `src/admin/views/model-form.tsx` | 修改 | 引入 `<json-editor>` 组件 |
| `src/admin/routes/model-form.tsx` | 修改 | 保存/编辑时处理 `defaultParams` |
| `src/routes/chat-completions/upstream-request.ts` | 修改 | 集成参数合并 |
| `src/routes/messages/upstream-request.ts` | 修改 | 集成参数合并 |

---

### 6. 测试计划

| 测试文件 | 测试内容 |
|----------|----------|
| `tests/lib/params-merger.test.ts` | 合并逻辑：基本类型覆盖、对象递归合并、数组整体替换、空默认参数、无默认参数 |
| `tests/components/json-editor.test.tsx` | Web Component 渲染、有效/无效 JSON 样式、格式化按钮、清空按钮 |
| `tests/e2e/default-params.e2e.test.ts` | 端到端：配置默认参数 → 发送请求 → 验证上游请求包含合并后的参数 |

---

### 7. 注意事项

1. **合并时机**：格式转换 **之后** 合并，确保参数格式与目标 provider 一致
2. **向后兼容**：`defaultParams` 为可选字段，不影响现有配置
3. **安全性**：JSON 编辑器使用 `try/catch` 解析，不执行任何 eval
4. **Web Component**：使用原生 Custom Elements API，无外部依赖
