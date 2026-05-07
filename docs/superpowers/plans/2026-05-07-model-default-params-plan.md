# 模型默认参数配置 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个模型添加默认参数配置功能，请求时自动与用户参数深度合并（用户优先级更高）。

**Architecture:** 新增 `defaultParams` 字段到 `ProviderConfig`，创建 Web Component `<json-editor>` 用于后台配置，在请求处理链路中转换后合并参数。

**Tech Stack:** TypeScript, Hono JSX, Web Components (Custom Elements API), Vitest

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/config.ts` | 修改 | `ProviderConfig` 新增 `defaultParams` 字段，增加验证 |
| `src/lib/params-merger.ts` | 新增 | 深度合并逻辑（`deepMerge`、`mergeModelParams`） |
| `src/admin/components/JsonEditor.ts` | 新增 | Web Component `<json-editor>` 定义 |
| `src/admin/views/model-form.tsx` | 修改 | 引入 `<json-editor>` 组件到表单 |
| `src/admin/routes/model-form.tsx` | 修改 | 保存/编辑时处理 `defaultParams` |
| `src/routes/chat-completions/upstream-request.ts` | 修改 | 集成参数合并 |
| `src/routes/messages/upstream-request.ts` | 修改 | 集成参数合并 |
| `tests/lib/params-merger.test.ts` | 新增 | 合并逻辑单元测试 |
| `tests/components/json-editor.test.tsx` | 新增 | Web Component 测试 |
| `tests/routes/upstream-request.test.ts` | 修改 | 补充带默认参数的测试 |
| `tests/routes/messages-upstream-request.test.ts` | 修改 | 补充带默认参数的测试 |

---

### Task 1: 参数合并逻辑

**Files:**
- Create: `src/lib/params-merger.ts`
- Test: `tests/lib/params-merger.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
// tests/lib/params-merger.test.ts
import { describe, it, expect } from 'vitest';
import { deepMerge, mergeModelParams } from '../../src/lib/params-merger.js';

describe('deepMerge', () => {
  it('should override primitive values', () => {
    const base = { temperature: 0.7, max_tokens: 4096 };
    const override = { temperature: 0.9 };
    expect(deepMerge(base, override)).toEqual({ temperature: 0.9, max_tokens: 4096 });
  });

  it('should recursively merge objects', () => {
    const base = { extra_body: { top_k: 50, thinking: { type: 'disabled' } } };
    const override = { extra_body: { thinking: { type: 'enabled' } } };
    expect(deepMerge(base, override)).toEqual({
      extra_body: { top_k: 50, thinking: { type: 'enabled' } }
    });
  });

  it('should replace arrays entirely', () => {
    const base = { stop: ['\n\n', '```'] };
    const override = { stop: ['\n'] };
    expect(deepMerge(base, override)).toEqual({ stop: ['\n'] });
  });

  it('should handle null override values', () => {
    const base = { temperature: 0.7, max_tokens: 4096 };
    const override = { max_tokens: null };
    expect(deepMerge(base, override)).toEqual({ temperature: 0.7, max_tokens: null });
  });

  it('should handle empty override', () => {
    const base = { temperature: 0.7 };
    expect(deepMerge(base, {})).toEqual({ temperature: 0.7 });
  });
});

describe('mergeModelParams', () => {
  it('should return userBody when defaultParams is undefined', () => {
    const userBody = { temperature: 0.8, messages: [] };
    expect(mergeModelParams(undefined, userBody)).toEqual(userBody);
  });

  it('should merge defaultParams with userBody (user wins)', () => {
    const defaultParams = { temperature: 0.7, max_tokens: 4096, extra_body: { top_k: 50 } };
    const userBody = { temperature: 0.9, messages: [] };
    const result = mergeModelParams(defaultParams, userBody);
    expect(result).toEqual({
      temperature: 0.9,
      max_tokens: 4096,
      extra_body: { top_k: 50 },
      messages: []
    });
  });

  it('should deeply merge extra_body', () => {
    const defaultParams = { extra_body: { thinking: { type: 'disabled' }, top_k: 50 } };
    const userBody = { extra_body: { thinking: { type: 'enabled' } } };
    const result = mergeModelParams(defaultParams, userBody);
    expect(result).toEqual({
      extra_body: { thinking: { type: 'enabled' }, top_k: 50 }
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/lib/params-merger.test.ts
```

预期：失败，因为模块不存在

- [ ] **Step 3: 实现合并逻辑**

```typescript
// src/lib/params-merger.ts

/**
 * 深度递归合并对象
 * - 基本类型：override 覆盖 base
 * - 对象类型：递归合并
 * - 数组类型：override 整体替换 base
 */
export function deepMerge(base: any, override: any): any {
  if (override === null || typeof override !== 'object' || Array.isArray(override)) {
    return override;
  }
  if (base === null || typeof base !== 'object' || Array.isArray(base)) {
    return override;
  }

  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (key in base) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

/**
 * 合并默认参数和用户参数
 * 用户参数优先级更高
 */
export function mergeModelParams(
  defaultParams: Record<string, any> | undefined,
  userBody: any
): any {
  if (defaultParams === undefined || defaultParams === null) {
    return userBody;
  }
  // defaultParams 作为 base，userBody 作为 override（用户优先级更高）
  return deepMerge(defaultParams, userBody);
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/components/json-editor.test.tsx
```

- [ ] **Step 5: 提交**

```bash
git add src/admin/components/JsonEditor.ts tests/components/json-editor.test.tsx
git commit -m "feat: add JsonEditor web component with live validation"
```

---

### Task 4: 模型表单视图集成

**Files:**
- Modify: `src/admin/views/model-form.tsx`（在描述字段后添加默认参数区域）

- [ ] **Step 1: 修改模型表单**

在 `src/admin/views/model-form.tsx` 中，找到描述字段（约第 250-260 行），在其后添加默认参数配置区域：

首先，在文件顶部导入 `JsonEditor`：

```typescript
import { FC } from 'hono/jsx';
import { TopbarNav } from '../components/TopbarNav.js';
import type { ProviderConfig } from '../../config.js';
import { ModelTest } from './model-test.js';
import { JsonEditor } from '../components/JsonEditor.js';  // 新增
```

然后，在描述字段之后、隐藏模型 checkbox 之前，添加默认参数区域。找到这段代码：

```tsx
              <div class="form-group">
                <label class="form-label" for="desc">
                  描述
                  <textarea
                    class="form-textarea"
                    id="desc"
                    name="desc"
                    placeholder="请输入模型描述（可选）"
                    rows={3}
                  >
                    {props.model?.desc || ''}
                  </textarea>
                  <span class="form-hint">用于记录模型的用途或备注</span>
                </label>
              </div>

              {/* 隐藏模型（仅编辑模式） */}
```

在两者之间插入：

```tsx
              <div class="form-group">
                <label class="form-label">
                  默认参数（可选）
                  <JsonEditor
                    name="defaultParams"
                    value={props.model?.defaultParams ? JSON.stringify(props.model.defaultParams, null, 2) : ''}
                  />
                  <span class="form-hint">
                    配置模型的默认参数，请求时与用户参数合并（用户优先级更高）。
                    参考：
                    <a href="https://api-docs.deepseek.com/zh-cn/guides/thinking_mode" target="_blank">DeepSeek</a>
                    {' '}|{' '}
                    <a href="https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create" target="_blank">OpenAI</a>
                  </span>
                </label>
              </div>
```

- [ ] **Step 2: 运行构建确认无编译错误**

```bash
pnpm build
```

- [ ] **Step 3: 提交**

```bash
git add src/admin/views/model-form.tsx
git commit -m "feat: integrate JsonEditor into model form view"
```

---

### Task 5: 模型表单路由处理

**Files:**
- Modify: `src/admin/routes/model-form.tsx`（新增和编辑逻辑中添加 `defaultParams` 处理）

- [ ] **Step 1: 修改新增模型逻辑**

找到保存新配置的 POST 处理（约第 135-180 行），在解析表单字段后添加 `defaultParams` 解析：

在现有代码：
```typescript
    const customModel = body.customModel as string;
    const realModel = body.realModel as string;
    const baseUrl = body.baseUrl as string;
    const provider = body.provider as 'openai' | 'anthropic';
    const desc = body.desc as string;
    const apiKeySource = body.apiKeySource as string;
    const apiKey = body.apiKey as string;
```

之后添加：

```typescript
    // 解析 defaultParams
    let defaultParams: Record<string, any> | undefined;
    if (body.defaultParams && typeof body.defaultParams === 'string' && body.defaultParams.trim()) {
      try {
        defaultParams = JSON.parse(body.defaultParams);
      } catch {
        // JSON 解析失败，忽略
      }
    }
```

然后，在创建新配置的代码中（约第 175 行），添加 `defaultParams` 字段：

```typescript
      const newConfig: ProviderConfig = {
        customModel,
        realModel,
        apiKey: finalApiKey,
        baseUrl,
        provider,
        desc: desc || undefined,
        defaultParams,  // 新增
      };
```

- [ ] **Step 2: 修改编辑模型逻辑**

找到保存编辑的 POST 处理（约第 215-280 行），同样添加 `defaultParams` 解析：

在解析表单字段后添加相同的 `defaultParams` 解析代码。

然后，在更新配置的代码中（约第 260 行），添加 `defaultParams` 字段：

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
        cachedPricePer1M: oldEntry.cachedPricePer1M,
        hidden: hidden || undefined,
        defaultParams,  // 新增
      };
```

- [ ] **Step 3: 运行构建确认**

```bash
pnpm build
```

- [ ] **Step 4: 提交**

```bash
git add src/admin/routes/model-form.tsx
git commit -m "feat: handle defaultParams in model form routes"
```

---

### Task 6: 请求处理链路集成

**Files:**
- Modify: `src/routes/chat-completions/upstream-request.ts`
- Modify: `src/routes/messages/upstream-request.ts`
- Test: `tests/routes/upstream-request.test.ts`
- Test: `tests/routes/messages-upstream-request.test.ts`

- [ ] **Step 1: 修改 OpenAI 格式路由的 upstream-request**

在 `src/routes/chat-completions/upstream-request.ts` 中：

首先添加导入：

```typescript
import type { ProviderConfig } from '../../config.js';
import { buildHeaders, buildUrl } from '../../providers/index.js';
import { convertOpenAIRequestToAnthropic } from '../../converters/openai-to-anthropic.js';
import { DetailLogger } from '../../detail-logger.js';
import { mergeModelParams } from '../../lib/params-merger.js';  // 新增
```

然后，修改 `buildUpstreamRequest` 函数。找到这段代码（约第 25-35 行）：

```typescript
  if (provider.provider === 'openai') {
    requestBody = {
      ...body,
      model: provider.realModel,
      ...(stream ? { stream_options: { include_usage: true } } : {})
    };
  } else {
    const anthropicRequest = await convertOpenAIRequestToAnthropic(body);
    requestBody = { ...anthropicRequest, model: provider.realModel };
  }
```

在其后、return 之前添加：

```typescript
  // 合并默认参数（用户参数优先级更高）
  requestBody = mergeModelParams(provider.defaultParams, requestBody);
```

- [ ] **Step 2: 修改 Anthropic 格式路由的 upstream-request**

在 `src/routes/messages/upstream-request.ts` 中：

首先添加导入：

```typescript
import type { ProviderConfig } from '../../config.js';
import { buildHeaders, buildUrl } from '../../providers/index.js';
import { convertAnthropicRequestToOpenAI } from '../../converters/anthropic-to-openai.js';
import { DetailLogger } from '../../detail-logger.js';
import { mergeModelParams } from '../../lib/params-merger.js';  // 新增
```

然后，修改 `buildMessagesUpstreamRequest` 函数。找到这段代码（约第 25-32 行）：

```typescript
  if (provider.provider === 'anthropic') {
    requestBody = { ...body, model: provider.realModel };
  } else {
    const openaiRequest = convertAnthropicRequestToOpenAI(body);
    requestBody = { ...openaiRequest, model: provider.realModel };
  }
```

在其后、return 之前添加：

```typescript
  // 合并默认参数（用户参数优先级更高）
  requestBody = mergeModelParams(provider.defaultParams, requestBody);
```

- [ ] **Step 3: 添加测试**

在 `tests/routes/upstream-request.test.ts` 中添加测试用例：

```typescript
  describe('with defaultParams', () => {
    it('should merge defaultParams into request body for OpenAI provider', async () => {
      const providerWithDefaults = {
        ...mockProvider,
        defaultParams: { temperature: 0.5, max_tokens: 2048 }
      };
      const result = await buildUpstreamRequest(providerWithDefaults, mockBody, false);

      expect(result.body.temperature).toBe(0.5);  // 默认值覆盖用户值
      expect(result.body.max_tokens).toBe(2048);
    });

    it('should deeply merge extra_body', async () => {
      const providerWithDefaults = {
        ...mockProvider,
        defaultParams: {
          extra_body: { thinking: { type: 'disabled' }, top_k: 50 }
        }
      };
      const bodyWithExtra = {
        ...mockBody,
        extra_body: { thinking: { type: 'enabled' } }
      };
      const result = await buildUpstreamRequest(providerWithDefaults, bodyWithExtra, false);

      expect(result.body.extra_body).toEqual({
        thinking: { type: 'enabled' },  // 用户值优先
        top_k: 50                        // 默认值保留
      });
    });
  });
```

同样，在 `tests/routes/messages-upstream-request.test.ts` 中添加类似测试。

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/routes/upstream-request.test.ts tests/routes/messages-upstream-request.test.ts
```

- [ ] **Step 5: 运行完整测试套件**

```bash
pnpm test
```

- [ ] **Step 6: 提交**

```bash
git add src/routes/chat-completions/upstream-request.ts src/routes/messages/upstream-request.ts tests/routes/upstream-request.test.ts tests/routes/messages-upstream-request.test.ts
git commit -m "feat: integrate defaultParams merging into request pipelines"
```

---

### Task 7: 端到端测试

**Files:**
- Create: `tests/e2e/default-params.e2e.test.ts`

- [ ] **Step 1: 编写 E2E 测试**

```typescript
// tests/e2e/default-params.e2e.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../src/server.js';
import type { ProviderConfig, ProxyConfig } from '../../src/config.js';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Default Params E2E', () => {
  const testDir = join(tmpdir(), 'llm-gateway-e2e-default-params');
  const configPath = join(testDir, 'config.json');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      unlinkSync(configPath);
    } catch {}
  });

  it('should merge defaultParams with user request params', async () => {
    const testModels: ProviderConfig[] = [
      {
        customModel: 'test-gpt',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai',
        defaultParams: { temperature: 0.5, max_tokens: 2048 }
      }
    ];

    const config: ProxyConfig = { models: testModels };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const app = createApp(configPath);

    // Mock fetch to capture the upstream request
    const originalFetch = global.fetch;
    let capturedBody: any;
    global.fetch = async (url: string, options: any) => {
      capturedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        id: 'test',
        choices: [{ message: { content: 'test' } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 }
      }));
    };

    const response = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'test-gpt',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.8  // 用户参数
      })
    });

    expect(response.status).toBe(200);
    expect(capturedBody.temperature).toBe(0.8);  // 用户参数优先
    expect(capturedBody.max_tokens).toBe(2048);  // 默认参数生效

    global.fetch = originalFetch;
  });
});
```

- [ ] **Step 2: 运行 E2E 测试**

```bash
npx vitest run tests/e2e/default-params.e2e.test.ts
```

- [ ] **Step 3: 提交**

```bash
git add tests/e2e/default-params.e2e.test.ts
git commit -m "test: add E2E test for default params merging"
```

---

## 自审检查

**1. 规范覆盖检查**

| 需求 | 实现 Task |
|------|-----------|
| 每个模型独立配置默认参数 | Task 2 (config.ts), Task 5 (routes) |
| 支持任意 JSON 对象 | Task 1 (mergeModelParams), Task 3 (JsonEditor) |
| 双栏 JSON 编辑器 + 红绿提示 | Task 3 (JsonEditor) |
| 深度递归合并，用户优先级更高 | Task 1 (deepMerge) |
| 转换后合并 | Task 6 (upstream-request 中转换后调用 mergeModelParams) |
| 配置验证 | Task 2 (validateProviderConfig) |
| 测试覆盖 | Task 1, 3, 6, 7 |

**2. Placeholder 扫描** ✅
- 无 "TBD"、"TODO" 或未完成的步骤

**3. 类型一致性** ✅
- `ProviderConfig.defaultParams` 类型在所有文件中统一为 `Record<string, any> | undefined`
- `mergeModelParams` 签名与调用处匹配

**4. 步骤独立性** ✅
- 每个 Task 可独立编译、测试、提交
- 按依赖顺序排列：合并逻辑 → 类型 → 组件 → 视图 → 路由 → 集成 → E2E

---

## 执行方式

计划已完成。两个执行选项：

**1. Subagent-Driven（推荐）** - 每个 Task 独立子代理执行，中间审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 批量执行，带检查点

你倾向哪种方式？

```bash
npx vitest run tests/lib/params-merger.test.ts
```

预期：全部通过

- [ ] **Step 5: 提交**

```bash
git add src/lib/params-merger.ts tests/lib/params-merger.test.ts
git commit -m "feat: add params merger with deep merge support"
```

---

### Task 2: 配置类型和验证

**Files:**
- Modify: `src/config.ts`（约第 29-45 行，`ProviderConfig` 接口）
- Modify: `src/config.ts`（约第 130-150 行，`validateModelsArray` 函数内）
- Test: `tests/config.test.ts`（现有文件，追加测试）

- [ ] **Step 1: 编写测试**

在 `tests/config.test.ts` 的 `describe('loadConfig')` 块中添加：

```typescript
    it('should accept valid defaultParams object', () => {
      unlinkSync(testConfigPath);
      const configWithParams = [
        {
          customModel: 'test-model',
          realModel: 'gpt-4',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com',
          provider: 'openai',
          defaultParams: { temperature: 0.7, max_tokens: 4096 }
        }
      ];
      writeFileSync(testConfigPath, JSON.stringify(configWithParams, null, 2));
      const result = loadConfig(testConfigPath);
      expect(result[0].defaultParams).toEqual({ temperature: 0.7, max_tokens: 4096 });
    });

    it('should reject defaultParams as array', () => {
      unlinkSync(testConfigPath);
      const configWithArray = [
        {
          customModel: 'test-model',
          realModel: 'gpt-4',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com',
          provider: 'openai',
          defaultParams: ['temperature', 0.7]
        }
      ];
      writeFileSync(testConfigPath, JSON.stringify(configWithArray, null, 2));
      expect(() => loadConfig(testConfigPath)).toThrow('defaultParams must be an object');
    });

    it('should accept missing defaultParams (optional field)', () => {
      // 使用 beforeEach 创建的默认配置（没有 defaultParams）
      const result = loadConfig(testConfigPath);
      expect(result[0].defaultParams).toBeUndefined();
    });
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/config.test.ts -t "defaultParams"
```

- [ ] **Step 3: 修改 ProviderConfig 接口**

在 `src/config.ts` 中找到 `ProviderConfig` 接口（约第 29-45 行），添加 `defaultParams` 字段：

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
  hidden?: boolean;
  defaultParams?: Record<string, any>;  // 新增：默认参数
}
```

- [ ] **Step 4: 添加验证逻辑**

在 `src/config.ts` 的 `validateModelsArray` 函数中，找到验证 `limits` 的代码块之后（约第 145 行），添加 `defaultParams` 验证：

```typescript
    // 验证 limits
    if (item.limits) {
      if (!Array.isArray(item.limits)) {
        throw new Error(`limits must be an array at model ${index}`);
      }
      item.limits.forEach((limit: any, limitIndex: number) => {
        validateModelLimit(limit, limitIndex, index);
      });
    }

    // 验证 defaultParams（新增）
    if (item.defaultParams !== undefined) {
      if (typeof item.defaultParams !== 'object' || Array.isArray(item.defaultParams) || item.defaultParams === null) {
        throw new Error(`defaultParams must be an object at model ${index}`);
      }
    }
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npx vitest run tests/config.test.ts
```

- [ ] **Step 6: 提交**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add defaultParams field to ProviderConfig with validation"
```

---

### Task 3: Web Component `<json-editor>`

**Files:**
- Create: `src/admin/components/JsonEditor.ts`
- Test: `tests/components/json-editor.test.tsx`

- [ ] **Step 1: 编写测试**

```typescript
// tests/components/json-editor.test.tsx
import { describe, it, expect } from 'vitest';
import { JsonEditor } from '../../src/admin/components/JsonEditor.js';

describe('JsonEditor component', () => {
  it('should render with textarea and preview pre', () => {
    const html = String(<JsonEditor name="defaultParams" value="" />);
    expect(html).toContain('<textarea');
    expect(html).toContain('<pre');
    expect(html).toContain('json-editor-preview');
  });

  it('should render format and clear buttons', () => {
    const html = String(<JsonEditor name="defaultParams" value="" />);
    expect(html).toContain('格式化');
    expect(html).toContain('清空');
  });

  it('should have valid inline JavaScript', () => {
    const html = String(<JsonEditor name="defaultParams" value="" />);
    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    expect(scriptMatch).not.toBeNull();
    expect(() => {
      new Function(scriptMatch![1]);
    }).not.toThrow();
  });

  it('should render initial value if provided', () => {
    const initialValue = JSON.stringify({ temperature: 0.7 }, null, 2);
    const html = String(<JsonEditor name="testParams" value={initialValue} />);
    expect(html).toContain('temperature');
    expect(html).toContain('0.7');
  });

  it('should include hidden input with correct name', () => {
    const html = String(<JsonEditor name="defaultParams" value="" />);
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="defaultParams"');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/components/json-editor.test.tsx
```

- [ ] **Step 3: 实现 Web Component**

```typescript
// src/admin/components/JsonEditor.ts
import { FC } from 'hono/jsx';

interface Props {
  name: string;
  value?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const JsonEditor: FC<Props> = (props) => {
  const safeValue = props.value || '';
  const uniqueId = `json-editor-${props.name}-${Math.random().toString(36).slice(2, 8)}`;

  const jsCode = `
(function() {
  window.jsonEditorValidate = function(id) {
    var textarea = document.getElementById(id + '-input');
    var preview = document.getElementById(id + '-preview');
    var hidden = document.getElementById(id + '-hidden');
    try {
      var obj = JSON.parse(textarea.value);
      var formatted = JSON.stringify(obj, null, 2);
      preview.textContent = formatted;
      preview.setAttribute('data-valid', 'true');
      preview.style.background = '#dcfce7';
      hidden.value = formatted;
    } catch (e) {
      preview.textContent = 'JSON 格式错误：' + e.message;
      preview.setAttribute('data-valid', 'false');
      preview.style.background = '#fef2f2';
      hidden.value = textarea.value;
    }
  };
  window.jsonEditorFormat = function(id) {
    var textarea = document.getElementById(id + '-input');
    try {
      var obj = JSON.parse(textarea.value);
      textarea.value = JSON.stringify(obj, null, 2);
      window.jsonEditorValidate(id);
    } catch (e) {
      alert('JSON 格式错误：' + e.message);
    }
  };
  window.jsonEditorClear = function(id) {
    var textarea = document.getElementById(id + '-input');
    var preview = document.getElementById(id + '-preview');
    var hidden = document.getElementById(id + '-hidden');
    textarea.value = '';
    preview.textContent = '等待输入...';
    preview.setAttribute('data-valid', 'true');
    preview.style.background = '#dcfce7';
    hidden.value = '';
  };
})();
  `.trim();

  return (
    <div style="display: flex; gap: 1rem; margin-bottom: 0.5rem;">
      <div style="flex: 1;">
        <textarea
          id={`${uniqueId}-input`}
          style={{
            width: '100%',
            minHeight: '180px',
            padding: '0.75rem',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            border: '1.5px solid var(--border-color)',
            borderRadius: '8px',
            resize: 'vertical',
            background: 'var(--bg-page)'
          }}
          placeholder='{"temperature": 0.7, "max_tokens": 4096, "extra_body": {"thinking": {"type": "disabled"}}}'
          oninput={`jsonEditorValidate('${uniqueId}')`}
        >{safeValue}</textarea>
        <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
          <button
            type="button"
            class="btn btn-secondary"
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
            onclick={`jsonEditorFormat('${uniqueId}')`}
          >格式化</button>
          <button
            type="button"
            class="btn btn-secondary"
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
            onclick={`jsonEditorClear('${uniqueId}')`}
          >清空</button>
        </div>
      </div>
      <div style="flex: 1;">
        <pre
          id={`${uniqueId}-preview`}
          data-valid="true"
          style={{
            width: '100%',
            minHeight: '180px',
            padding: '0.75rem',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            border: '1.5px solid var(--border-color)',
            borderRadius: '8px',
            overflow: 'auto',
            background: '#dcfce7'
          }}
        >{safeValue || '等待输入...'}</pre>
      </div>
      <input type="hidden" name={props.name} id={`${uniqueId}-hidden`} value={safeValue} />
      <script>{jsCode}</script>
    </div>
  );
};
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/components/json-editor.test.tsx
```

- [ ] **Step 5: 提交**

```bash
git add src/admin/components/JsonEditor.ts tests/components/json-editor.test.tsx
git commit -m "feat: add JsonEditor web component with live validation"
```

---

### Task 4: 模型表单视图集成

**Files:**
- Modify: `src/admin/views/model-form.tsx`（在描述字段后添加默认参数区域）

- [ ] **Step 1: 修改模型表单**

在 `src/admin/views/model-form.tsx` 中，找到描述字段（约第 250-260 行），在其后添加默认参数配置区域：

首先，在文件顶部导入 `JsonEditor`：

```typescript
import { FC } from 'hono/jsx';
import { TopbarNav } from '../components/TopbarNav.js';
import type { ProviderConfig } from '../../config.js';
import { ModelTest } from './model-test.js';
import { JsonEditor } from '../components/JsonEditor.js';  // 新增
```

然后，在描述字段之后、隐藏模型 checkbox 之前，添加默认参数区域。找到这段代码：

```tsx
              <div class="form-group">
                <label class="form-label" for="desc">
                  描述
                  <textarea
                    class="form-textarea"
                    id="desc"
                    name="desc"
                    placeholder="请输入模型描述（可选）"
                    rows={3}
                  >
                    {props.model?.desc || ''}
                  </textarea>
                  <span class="form-hint">用于记录模型的用途或备注</span>
                </label>
              </div>

              {/* 隐藏模型（仅编辑模式） */}
```

在两者之间插入：

```tsx
              <div class="form-group">
                <label class="form-label">
                  默认参数（可选）
                  <JsonEditor
                    name="defaultParams"
                    value={props.model?.defaultParams ? JSON.stringify(props.model.defaultParams, null, 2) : ''}
                  />
                  <span class="form-hint">
                    配置模型的默认参数，请求时与用户参数合并（用户优先级更高）。
                    参考：
                    <a href="https://api-docs.deepseek.com/zh-cn/guides/thinking_mode" target="_blank">DeepSeek</a>
                    {' '}|{' '}
                    <a href="https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create" target="_blank">OpenAI</a>
                  </span>
                </label>
              </div>
```

- [ ] **Step 2: 运行构建确认无编译错误**

```bash
pnpm build
```

- [ ] **Step 3: 提交**

```bash
git add src/admin/views/model-form.tsx
git commit -m "feat: integrate JsonEditor into model form view"
```

---

### Task 5: 模型表单路由处理

**Files:**
- Modify: `src/admin/routes/model-form.tsx`（新增和编辑逻辑中添加 `defaultParams` 处理）

- [ ] **Step 1: 修改新增模型逻辑**

找到保存新配置的 POST 处理（约第 135-180 行），在解析表单字段后添加 `defaultParams` 解析：

在现有代码：
```typescript
    const customModel = body.customModel as string;
    const realModel = body.realModel as string;
    const baseUrl = body.baseUrl as string;
    const provider = body.provider as 'openai' | 'anthropic';
    const desc = body.desc as string;
    const apiKeySource = body.apiKeySource as string;
    const apiKey = body.apiKey as string;
```

之后添加：

```typescript
    // 解析 defaultParams
    let defaultParams: Record<string, any> | undefined;
    if (body.defaultParams && typeof body.defaultParams === 'string' && body.defaultParams.trim()) {
      try {
        defaultParams = JSON.parse(body.defaultParams);
      } catch {
        // JSON 解析失败，忽略
      }
    }
```

然后，在创建新配置的代码中（约第 175 行），添加 `defaultParams` 字段：

```typescript
      const newConfig: ProviderConfig = {
        customModel,
        realModel,
        apiKey: finalApiKey,
        baseUrl,
        provider,
        desc: desc || undefined,
        defaultParams,  // 新增
      };
```

- [ ] **Step 2: 修改编辑模型逻辑**

找到保存编辑的 POST 处理（约第 215-280 行），同样添加 `defaultParams` 解析：

在解析表单字段后添加相同的 `defaultParams` 解析代码。

然后，在更新配置的代码中（约第 260 行），添加 `defaultParams` 字段：

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
        cachedPricePer1M: oldEntry.cachedPricePer1M,
        hidden: hidden || undefined,
        defaultParams,  // 新增
      };
```

- [ ] **Step 3: 运行构建确认**

```bash
pnpm build
```

- [ ] **Step 4: 提交**

```bash
git add src/admin/routes/model-form.tsx
git commit -m "feat: handle defaultParams in model form routes"
```

---

### Task 6: 请求处理链路集成

**Files:**
- Modify: `src/routes/chat-completions/upstream-request.ts`
- Modify: `src/routes/messages/upstream-request.ts`
- Test: `tests/routes/upstream-request.test.ts`
- Test: `tests/routes/messages-upstream-request.test.ts`

- [ ] **Step 1: 修改 OpenAI 格式路由的 upstream-request**

在 `src/routes/chat-completions/upstream-request.ts` 中：

首先添加导入：

```typescript
import type { ProviderConfig } from '../../config.js';
import { buildHeaders, buildUrl } from '../../providers/index.js';
import { convertOpenAIRequestToAnthropic } from '../../converters/openai-to-anthropic.js';
import { DetailLogger } from '../../detail-logger.js';
import { mergeModelParams } from '../../lib/params-merger.js';  // 新增
```

然后，修改 `buildUpstreamRequest` 函数。找到这段代码（约第 25-35 行）：

```typescript
  if (provider.provider === 'openai') {
    requestBody = {
      ...body,
      model: provider.realModel,
      ...(stream ? { stream_options: { include_usage: true } } : {})
    };
  } else {
    const anthropicRequest = await convertOpenAIRequestToAnthropic(body);
    requestBody = { ...anthropicRequest, model: provider.realModel };
  }
```

在其后、return 之前添加：

```typescript
  // 合并默认参数（用户参数优先级更高）
  requestBody = mergeModelParams(provider.defaultParams, requestBody);
```

- [ ] **Step 2: 修改 Anthropic 格式路由的 upstream-request**

在 `src/routes/messages/upstream-request.ts` 中：

首先添加导入：

```typescript
import type { ProviderConfig } from '../../config.js';
import { buildHeaders, buildUrl } from '../../providers/index.js';
import { convertAnthropicRequestToOpenAI } from '../../converters/anthropic-to-openai.js';
import { DetailLogger } from '../../detail-logger.js';
import { mergeModelParams } from '../../lib/params-merger.js';  // 新增
```

然后，修改 `buildMessagesUpstreamRequest` 函数。找到这段代码（约第 25-32 行）：

```typescript
  if (provider.provider === 'anthropic') {
    requestBody = { ...body, model: provider.realModel };
  } else {
    const openaiRequest = convertAnthropicRequestToOpenAI(body);
    requestBody = { ...openaiRequest, model: provider.realModel };
  }
```

在其后、return 之前添加：

```typescript
  // 合并默认参数（用户参数优先级更高）
  requestBody = mergeModelParams(provider.defaultParams, requestBody);
```

- [ ] **Step 3: 添加测试**

在 `tests/routes/upstream-request.test.ts` 中添加测试用例：

```typescript
  describe('with defaultParams', () => {
    it('should merge defaultParams into request body for OpenAI provider', async () => {
      const providerWithDefaults = {
        ...mockProvider,
        defaultParams: { temperature: 0.5, max_tokens: 2048 }
      };
      const result = await buildUpstreamRequest(providerWithDefaults, mockBody, false);

      expect(result.body.temperature).toBe(0.5);  // 默认值覆盖用户值
      expect(result.body.max_tokens).toBe(2048);
    });

    it('should deeply merge extra_body', async () => {
      const providerWithDefaults = {
        ...mockProvider,
        defaultParams: {
          extra_body: { thinking: { type: 'disabled' }, top_k: 50 }
        }
      };
      const bodyWithExtra = {
        ...mockBody,
        extra_body: { thinking: { type: 'enabled' } }
      };
      const result = await buildUpstreamRequest(providerWithDefaults, bodyWithExtra, false);

      expect(result.body.extra_body).toEqual({
        thinking: { type: 'enabled' },  // 用户值优先
        top_k: 50                        // 默认值保留
      });
    });
  });
```

同样，在 `tests/routes/messages-upstream-request.test.ts` 中添加类似测试。

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/routes/upstream-request.test.ts tests/routes/messages-upstream-request.test.ts
```

- [ ] **Step 5: 运行完整测试套件**

```bash
pnpm test
```

- [ ] **Step 6: 提交**

```bash
git add src/routes/chat-completions/upstream-request.ts src/routes/messages/upstream-request.ts tests/routes/upstream-request.test.ts tests/routes/messages-upstream-request.test.ts
git commit -m "feat: integrate defaultParams merging into request pipelines"
```

---

### Task 7: 端到端测试

**Files:**
- Create: `tests/e2e/default-params.e2e.test.ts`

- [ ] **Step 1: 编写 E2E 测试**

```typescript
// tests/e2e/default-params.e2e.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../src/server.js';
import type { ProviderConfig, ProxyConfig } from '../../src/config.js';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Default Params E2E', () => {
  const testDir = join(tmpdir(), 'llm-gateway-e2e-default-params');
  const configPath = join(testDir, 'config.json');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      unlinkSync(configPath);
    } catch {}
  });

  it('should merge defaultParams with user request params', async () => {
    const testModels: ProviderConfig[] = [
      {
        customModel: 'test-gpt',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai',
        defaultParams: { temperature: 0.5, max_tokens: 2048 }
      }
    ];

    const config: ProxyConfig = { models: testModels };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const app = createApp(configPath);

    // Mock fetch to capture the upstream request
    const originalFetch = global.fetch;
    let capturedBody: any;
    global.fetch = async (url: string, options: any) => {
      capturedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        id: 'test',
        choices: [{ message: { content: 'test' } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 }
      }));
    };

    const response = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'test-gpt',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.8  // 用户参数
      })
    });

    expect(response.status).toBe(200);
    expect(capturedBody.temperature).toBe(0.8);  // 用户参数优先
    expect(capturedBody.max_tokens).toBe(2048);  // 默认参数生效

    global.fetch = originalFetch;
  });
});
```

- [ ] **Step 2: 运行 E2E 测试**

```bash
npx vitest run tests/e2e/default-params.e2e.test.ts
```

- [ ] **Step 3: 提交**

```bash
git add tests/e2e/default-params.e2e.test.ts
git commit -m "test: add E2E test for default params merging"
```

---

## 自审检查

**1. 规范覆盖检查**

| 需求 | 实现 Task |
|------|-----------|
| 每个模型独立配置默认参数 | Task 2 (config.ts), Task 5 (routes) |
| 支持任意 JSON 对象 | Task 1 (mergeModelParams), Task 3 (JsonEditor) |
| 双栏 JSON 编辑器 + 红绿提示 | Task 3 (JsonEditor) |
| 深度递归合并，用户优先级更高 | Task 1 (deepMerge) |
| 转换后合并 | Task 6 (upstream-request 中转换后调用 mergeModelParams) |
| 配置验证 | Task 2 (validateProviderConfig) |
| 测试覆盖 | Task 1, 3, 6, 7 |

**2. Placeholder 扫描** ✅
- 无 "TBD"、"TODO" 或未完成的步骤

**3. 类型一致性** ✅
- `ProviderConfig.defaultParams` 类型在所有文件中统一为 `Record<string, any> | undefined`
- `mergeModelParams` 签名与调用处匹配

**4. 步骤独立性** ✅
- 每个 Task 可独立编译、测试、提交
- 按依赖顺序排列：合并逻辑 → 类型 → 组件 → 视图 → 路由 → 集成 → E2E

---

## 执行方式

计划已完成。两个执行选项：

**1. Subagent-Driven（推荐）** - 每个 Task 独立子代理执行，中间审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 批量执行，带检查点

你倾向哪种方式？
