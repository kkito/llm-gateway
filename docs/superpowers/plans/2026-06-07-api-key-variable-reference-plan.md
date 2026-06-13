# API Key Variable Reference (`$$name$$`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow models to reference API keys by `$$name$$` instead of storing literal key values, so updating one API key propagates to all models referencing it.

**Architecture:** Add `resolveApiKey()` to `config.ts` for runtime resolution in `buildUpstreamRequest`/`buildMessagesUpstreamRequest`. Store `$$name$$` in `ProviderConfig.apiKey` when user selects from dropdown. Add `config-operations.ts` functions to sync model references when API keys are renamed/deleted.

**Tech Stack:** TypeScript, Hono/JSX (admin UI), Vitest (testing)

---

## File Structure

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `src/config.ts` | Modify | Add `isApiKeyRef`, `getApiKeyRefName`, `resolveApiKey`; name uniqueness validation |
| 2 | `src/config.ts` | Test | `src/lib/config-utils.test.ts` — unit tests for above functions |
| 3 | `src/config-operations.ts` | Modify | Add `renameApiKeyRefInConfig`, `removeApiKeyRefFromConfig` |
| 4 | `src/routes/chat-completions/upstream-request.ts` | Modify | Accept `apiKeys` param, resolve before building headers |
| 5 | `src/routes/messages/upstream-request.ts` | Modify | Same as #4 |
| 6 | `src/routes/chat-completions/handler.ts` | Modify | Pass `currentConfig.apiKeys` to build function and fallback context |
| 7 | `src/routes/messages/handler.ts` | Modify | Same as #6 |
| 8 | `src/routes/chat-completions/model-fallback.ts` | Modify | Add `apiKeys` to context, pass to build function |
| 9 | `src/routes/messages/msg-fallback.ts` | Modify | Same as #8 |
| 10 | `src/admin/routes/model-form.tsx` | Modify | Save `$$name$$` instead of key value; detect ref on edit; resolve before test |
| 11 | `src/admin/views/model-form.tsx` | Modify | Add `selectedApiKeyRef` prop; pre-select dropdown; disable manual input when ref active |
| 12 | `src/admin/routes/api-keys.tsx` | Modify | Call `renameApiKeyRefInConfig`/`removeApiKeyRefFromConfig` on edit/delete |

---

### Task 1: Core resolution functions + tests

**Files:**
- Modify: `src/config.ts` (add functions)
- Create: `src/lib/config-utils.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/config-utils.test.ts
import { describe, it, expect } from 'vitest';
import { isApiKeyRef, getApiKeyRefName, resolveApiKey } from '../config.js';
import type { ApiKey } from '../config.js';

describe('isApiKeyRef', () => {
  it('returns true for $$name$$ format', () => {
    expect(isApiKeyRef('$$my-key$$')).toBe(true);
  });

  it('returns false for literal key', () => {
    expect(isApiKeyRef('sk-abc123')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isApiKeyRef('')).toBe(false);
  });
});

describe('getApiKeyRefName', () => {
  it('extracts name from $$name$$', () => {
    expect(getApiKeyRefName('$$my-key$$')).toBe('my-key');
  });

  it('returns null for literal key', () => {
    expect(getApiKeyRefName('sk-abc123')).toBeNull();
  });
});

describe('resolveApiKey', () => {
  const apiKeys: ApiKey[] = [
    { id: '1', name: 'openai-main', key: 'sk-real-1', createdAt: 0, updatedAt: 0 },
    { id: '2', name: 'anthropic-main', key: 'sk-ant-real-2', createdAt: 0, updatedAt: 0 },
  ];

  it('resolves $$name$$ to actual key', () => {
    expect(resolveApiKey('$$openai-main$$', apiKeys)).toBe('sk-real-1');
  });

  it('returns literal key unchanged', () => {
    expect(resolveApiKey('sk-abc123', apiKeys)).toBe('sk-abc123');
  });

  it('returns empty string unchanged', () => {
    expect(resolveApiKey('', apiKeys)).toBe('');
  });

  it('throws when reference name not found', () => {
    expect(() => resolveApiKey('$$nonexistent$$', apiKeys))
      .toThrow('API Key reference $$nonexistent$$ not found in saved API keys');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/config-utils.test.ts`
Expected: FAIL — functions not exported from config.ts

- [ ] **Step 3: Add functions to config.ts**

Add at the end of `src/config.ts` (before any existing exports, or after the `getApiKeyOptions` function):

```typescript
export function isApiKeyRef(apiKey: string): boolean {
  return /^\$\$(.+)\$\$$/.test(apiKey);
}

export function getApiKeyRefName(apiKey: string): string | null {
  const match = apiKey.match(/^\$\$(.+)\$\$$/);
  return match ? match[1] : null;
}

export function resolveApiKey(apiKey: string, apiKeys: ApiKey[]): string {
  if (!isApiKeyRef(apiKey)) return apiKey;
  const name = apiKey.slice(2, -2);
  const found = apiKeys.find(k => k.name === name);
  if (!found) {
    throw new Error(`API Key reference $${name}$$ not found in saved API keys`);
  }
  return found.key;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/config-utils.test.ts`
Expected: PASS

- [ ] **Step 5: Add name uniqueness validation to addApiKey/updateApiKey**

In `src/config.ts`, modify `addApiKey`:

```typescript
export function addApiKey(
  config: ApiKey[],
  name: string,
  key: string
): ApiKey {
  if (config.some(k => k.name === name)) {
    throw new Error(`API Key name "${name}" already exists`);
  }
  const now = Date.now();
  const newKey: ApiKey = {
    id: generateId(),
    name,
    key,
    createdAt: now,
    updatedAt: now
  };
  return newKey;
}
```

Modify `updateApiKey`:

```typescript
export function updateApiKey(
  config: ApiKey[],
  id: string,
  updates: Partial<Omit<ApiKey, 'id' | 'createdAt'>>
): ApiKey[] {
  const index = config.findIndex(k => k.id === id);
  if (index === -1) {
    throw new Error(`API Key not found: ${id}`);
  }
  // Check name uniqueness if name is being changed
  if (updates.name && updates.name !== config[index].name) {
    if (config.some(k => k.name === updates.name && k.id !== id)) {
      throw new Error(`API Key name "${updates.name}" already exists`);
    }
  }
  const updated = { ...config[index], ...updates, updatedAt: Date.now() };
  const newConfig = [...config];
  newConfig[index] = updated;
  return newConfig;
}
```

- [ ] **Step 6: Run tests again**

Run: `pnpm vitest run src/lib/config-utils.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/lib/config-utils.test.ts
git commit -m "feat: add resolveApiKey and related functions for $$name$$ references"
```

---

### Task 2: Config operations for API key rename/delete

**Files:**
- Modify: `src/config-operations.ts`
- Create: `src/config-operations.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/config-operations.test.ts
import { describe, it, expect } from 'vitest';
import { renameApiKeyRefInConfig, removeApiKeyRefFromConfig } from './config-operations.js';
import type { ProxyConfig } from './config.js';

describe('renameApiKeyRefInConfig', () => {
  it('updates $$oldName$$ to $$newName$$ in all models', () => {
    const config: ProxyConfig = {
      models: [
        { customModel: 'm1', realModel: 'gpt-4', apiKey: '$$old-name$$', baseUrl: 'https://api.openai.com', provider: 'openai' },
        { customModel: 'm2', realModel: 'gpt-3.5', apiKey: 'sk-literal', baseUrl: 'https://api.openai.com', provider: 'openai' },
        { customModel: 'm3', realModel: 'claude-3', apiKey: '$$old-name$$', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
      ],
    };
    const result = renameApiKeyRefInConfig(config, 'old-name', 'new-name');
    expect(result.models[0].apiKey).toBe('$$new-name$$');
    expect(result.models[1].apiKey).toBe('sk-literal'); // unchanged
    expect(result.models[2].apiKey).toBe('$$new-name$$');
  });

  it('is idempotent when oldName === newName', () => {
    const config: ProxyConfig = {
      models: [
        { customModel: 'm1', realModel: 'gpt-4', apiKey: '$$same$$', baseUrl: 'https://api.openai.com', provider: 'openai' },
      ],
    };
    const result = renameApiKeyRefInConfig(config, 'same', 'same');
    expect(result.models[0].apiKey).toBe('$$same$$');
  });

  it('does not modify unrelated $$name$$ refs', () => {
    const config: ProxyConfig = {
      models: [
        { customModel: 'm1', realModel: 'gpt-4', apiKey: '$$other-key$$', baseUrl: 'https://api.openai.com', provider: 'openai' },
      ],
    };
    const result = renameApiKeyRefInConfig(config, 'unrelated', 'new-name');
    expect(result.models[0].apiKey).toBe('$$other-key$$');
  });
});

describe('removeApiKeyRefFromConfig', () => {
  it('clears apiKey for models referencing the deleted key', () => {
    const config: ProxyConfig = {
      models: [
        { customModel: 'm1', realModel: 'gpt-4', apiKey: '$$to-delete$$', baseUrl: 'https://api.openai.com', provider: 'openai' },
        { customModel: 'm2', realModel: 'gpt-3.5', apiKey: 'sk-keep', baseUrl: 'https://api.openai.com', provider: 'openai' },
      ],
    };
    const result = removeApiKeyRefFromConfig(config, 'to-delete');
    expect(result.models[0].apiKey).toBe('');
    expect(result.models[1].apiKey).toBe('sk-keep');
  });

  it('does not modify models with different refs', () => {
    const config: ProxyConfig = {
      models: [
        { customModel: 'm1', realModel: 'gpt-4', apiKey: '$$other$$', baseUrl: 'https://api.openai.com', provider: 'openai' },
      ],
    };
    const result = removeApiKeyRefFromConfig(config, 'non-existent');
    expect(result.models[0].apiKey).toBe('$$other$$');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/config-operations.test.ts`
Expected: FAIL — functions not found

- [ ] **Step 3: Implement functions in config-operations.ts**

Add at the end of `src/config-operations.ts`:

```typescript
export function renameApiKeyRefInConfig(
  config: ProxyConfig,
  oldName: string,
  newName: string
): ProxyConfig {
  if (oldName === newName) return config;

  return {
    ...config,
    models: config.models.map(m =>
      m.apiKey === `$$${oldName}$$`
        ? { ...m, apiKey: `$$${newName}$$` }
        : m
    ),
  };
}

export function removeApiKeyRefFromConfig(
  config: ProxyConfig,
  keyName: string
): ProxyConfig {
  return {
    ...config,
    models: config.models.map(m =>
      m.apiKey === `$$${keyName}$$`
        ? { ...m, apiKey: '' }
        : m
    ),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/config-operations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config-operations.ts src/config-operations.test.ts
git commit -m "feat: add API key ref rename/remove operations"
```

---

### Task 3: Build functions resolve $$name$$ references

**Files:**
- Modify: `src/routes/chat-completions/upstream-request.ts`
- Modify: `src/routes/messages/upstream-request.ts`

- [ ] **Step 1: Modify chat completions upstream-request.ts**

Add `resolveApiKey` import, add `apiKeys` param, resolve before building headers:

```typescript
// Add import at top
import { resolveApiKey, type ApiKey } from '../../config.js';

// Change signature — add apiKeys parameter
export async function buildUpstreamRequest(
  provider: ProviderConfig,
  body: any,
  stream: boolean,
  apiKeys?: ApiKey[]
): Promise<UpstreamRequest> {
  let requestBody: any;

  // Resolve $$name$$ reference if present
  const resolvedKey = resolveApiKey(provider.apiKey, apiKeys ?? []);
  const effectiveProvider = resolvedKey !== provider.apiKey
    ? { ...provider, apiKey: resolvedKey }
    : provider;

  if (effectiveProvider.provider === 'openai') {
    requestBody = {
      ...body,
      model: effectiveProvider.realModel,
      ...(stream ? { stream_options: { include_usage: true } } : {})
    };
  } else {
    const anthropicRequest = await convertOpenAIRequestToAnthropic(body);
    requestBody = { ...anthropicRequest, model: effectiveProvider.realModel };
  }

  const requestHeaders = buildHeaders(effectiveProvider);
  const url = buildUrl(effectiveProvider, 'chat');

  // 合并默认参数（用户参数优先级更高）
  requestBody = mergeModelParams(effectiveProvider.defaultParams, requestBody);

  return {
    url,
    headers: requestHeaders,
    body: requestBody
  };
}
```

- [ ] **Step 2: Modify messages upstream-request.ts**

Same pattern — add `resolveApiKey` import, add `apiKeys` param, resolve:

```typescript
// Add import
import { resolveApiKey, type ApiKey } from '../../config.js';

export async function buildMessagesUpstreamRequest(
  provider: ProviderConfig,
  body: any,
  _stream: boolean,
  apiKeys?: ApiKey[]
): Promise<UpstreamRequest> {
  let requestBody: any;

  const resolvedKey = resolveApiKey(provider.apiKey, apiKeys ?? []);
  const effectiveProvider = resolvedKey !== provider.apiKey
    ? { ...provider, apiKey: resolvedKey }
    : provider;

  if (effectiveProvider.provider === 'anthropic') {
    requestBody = { ...body, model: effectiveProvider.realModel };
  } else {
    const openaiRequest = convertAnthropicRequestToOpenAI(body);
    requestBody = { ...openaiRequest, model: effectiveProvider.realModel };
  }

  const requestHeaders = buildHeaders(effectiveProvider);
  const url = buildUrl(effectiveProvider, 'chat');

  requestBody = mergeModelParams(effectiveProvider.defaultParams, requestBody);

  return {
    url,
    headers: requestHeaders,
    body: requestBody
  };
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `pnpm build` or `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/chat-completions/upstream-request.ts src/routes/messages/upstream-request.ts
git commit -m "feat: resolve $$name$$ references in upstream request builders"
```

---

### Task 4: Handlers pass apiKeys to build functions

**Files:**
- Modify: `src/routes/chat-completions/handler.ts`
- Modify: `src/routes/messages/handler.ts`
- Modify: `src/routes/chat-completions/model-fallback.ts`
- Modify: `src/routes/messages/msg-fallback.ts`

- [ ] **Step 1: Modify chat-completions handler.ts**

Find line 160 (`const upstream = await buildUpstreamRequest(provider, body, stream);`) and pass apiKeys:

```typescript
const upstream = await buildUpstreamRequest(provider, body, stream, currentConfig.apiKeys ?? []);
```

Find the fallback context (lines 80-85) and add `apiKeys`:

```typescript
const ctx: any = {
  c, modelNames, allProviders: currentConfig.models, body, stream,
  rateLimiter, logger, detailLogger, requestId, startTime,
  currentUser, modelGroupName: model_group, timeoutMs, logDir,
  privacySettings: currentConfig.privacySettings,
  apiKeys: currentConfig.apiKeys ?? [],  // ADD THIS
};
```

Find the second fallback context (lines 110-115, smart recognition) and add apiKeys there too:

```typescript
const ctx: any = {
  c, modelNames, allProviders: currentConfig.models, body, stream,
  rateLimiter, logger, detailLogger, requestId, startTime,
  currentUser, modelGroupName: model, timeoutMs, logDir,
  privacySettings: currentConfig.privacySettings,
  apiKeys: currentConfig.apiKeys ?? [],  // ADD THIS
};
```

- [ ] **Step 2: Modify messages handler.ts**

Find line 155 (`const upstream = await buildMessagesUpstreamRequest(provider, body, stream);`) and pass apiKeys:

```typescript
const upstream = await buildMessagesUpstreamRequest(provider, body, stream, currentConfig.apiKeys ?? []);
```

Find the fallback context (lines 77-82) and add `apiKeys`:

```typescript
const fallbackResult = await tryMessagesFallback({
  c, modelNames, allProviders: currentConfig.models, body, stream,
  rateLimiter, logger, detailLogger, requestId, startTime,
  currentUser, modelGroupName: model_group, timeoutMs, logDir,
  privacySettings: currentConfig.privacySettings,
  apiKeys: currentConfig.apiKeys ?? [],  // ADD THIS
});
```

Find the second fallback context (lines 106-111, smart recognition) and add apiKeys:

```typescript
const fallbackResult = await tryMessagesFallback({
  c, modelNames, allProviders: currentConfig.models, body, stream,
  rateLimiter, logger, detailLogger, requestId, startTime,
  currentUser, modelGroupName: model, timeoutMs, logDir,
  privacySettings: currentConfig.privacySettings,
  apiKeys: currentConfig.apiKeys ?? [],  // ADD THIS
});
```

- [ ] **Step 3: Modify model-fallback.ts**

Add `apiKeys` to the `FallbackContext` interface:

```typescript
export interface FallbackContext {
  c: any;
  modelNames: string[];
  allProviders: ProviderConfig[];
  body: any;
  stream: boolean;
  rateLimiter: RateLimiter;
  logger: Logger;
  detailLogger: DetailLogger;
  requestId: string;
  startTime: number;
  currentUser: any;
  modelGroupName: string;
  timeoutMs: number;
  logDir: string;
  privacySettings?: PrivacySettings;
  apiKeys?: ApiKey[];  // ADD THIS
}
```

Add the import:
```typescript
import type { ProviderConfig, PrivacySettings, ApiKey } from '../../config.js';
```

Find line 56 (`const upstream = await buildUpstreamRequest(provider, body, stream);`) and pass apiKeys:

```typescript
const upstream = await buildUpstreamRequest(provider, body, stream, ctx.apiKeys);
```

- [ ] **Step 4: Modify msg-fallback.ts**

Add `apiKeys` to the `MsgFallbackContext` interface:

```typescript
export interface MsgFallbackContext {
  c: any;
  modelNames: string[];
  allProviders: ProviderConfig[];
  body: any;
  stream: boolean;
  rateLimiter: RateLimiter;
  logger: Logger;
  detailLogger: DetailLogger;
  requestId: string;
  startTime: number;
  currentUser: any;
  modelGroupName: string;
  timeoutMs: number;
  logDir: string;
  privacySettings?: PrivacySettings;
  apiKeys?: ApiKey[];  // ADD THIS
}
```

Add the import:
```typescript
import type { ProviderConfig, PrivacySettings, ApiKey } from '../../config.js';
```

Find line 55 (`const upstream = await buildMessagesUpstreamRequest(provider, body, stream);`) and pass apiKeys:

```typescript
const upstream = await buildMessagesUpstreamRequest(provider, body, stream, ctx.apiKeys);
```

- [ ] **Step 5: Verify TypeScript compilation**

Run: `pnpm build` or `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add src/routes/chat-completions/handler.ts src/routes/messages/handler.ts src/routes/chat-completions/model-fallback.ts src/routes/messages/msg-fallback.ts
git commit -m "feat: pass apiKeys through handlers and fallback contexts"
```

---

### Task 5: Model form route stores $$name$$ references

**Files:**
- Modify: `src/admin/routes/model-form.tsx`

- [ ] **Step 1: Modify save handler to store $$name$$**

Find the POST /admin/models handler (line 203), change the API key resolution logic (lines 228-248):

```typescript
// 处理 API Key：优先使用下拉框选择的，其次使用手动输入的
let finalApiKey: string;
if (apiKeySource && apiKeySource !== 'manual') {
  // 从配置中查找选中的 API Key，存为 $$name$$ 引用
  try {
    const proxyConfig = loadFullConfig(configPath);
    const selectedKey = proxyConfig.apiKeys?.find(k => k.id === apiKeySource);
    if (!selectedKey) {
      return c.html(<ModelFormPage error={`未找到 API Key：${apiKeySource}`} apiKeyOptions={getApiKeyOptions(proxyConfig.apiKeys || [])} />);
    }
    finalApiKey = `$$${selectedKey.name}$$`;
  } catch (error: any) {
    return c.html(<ModelFormPage error={`加载配置失败：${error.message}`} />);
  }
} else if (apiKey) {
  // 使用手动输入的 API Key（可以是真实 key 或 $$name$$）
  finalApiKey = apiKey;
} else {
  const proxyConfig = loadFullConfig(configPath);
  return c.html(<ModelFormPage error="请填写所有必填字段" apiKeyOptions={getApiKeyOptions(proxyConfig.apiKeys || [])} />);
}
```

- [ ] **Step 2: Modify edit handler to store $$name$$**

Find the POST /admin/models/edit/:model handler (line 317), change the API key resolution logic (lines 354-370):

```typescript
// 处理 API Key：优先使用下拉框选择的，其次使用手动输入的，最后使用原值
let finalApiKey: string = oldEntry.apiKey; // 默认使用原值

if (apiKeySource && apiKeySource !== 'manual') {
  // 从配置中查找选中的 API Key，存为 $$name$$ 引用
  try {
    const proxyConfig = loadFullConfig(configPath);
    const selectedKey = proxyConfig.apiKeys?.find(k => k.id === apiKeySource);
    if (selectedKey) {
      finalApiKey = `$$${selectedKey.name}$$`;
    }
  } catch (error: any) {
    // 加载失败则使用原值
  }
} else if (apiKey && apiKey !== '') {
  // 使用手动输入的 API Key
  finalApiKey = apiKey;
}
// 如果两者都没有，使用原值（finalApiKey 已初始化为原值）
```

- [ ] **Step 3: Modify load handler to detect $$name$$ reference**

Find the GET /admin/models/edit/:model handler (line 298), import `isApiKeyRef`/`getApiKeyRefName` at top of file:

```typescript
import { saveConfig, updateConfigEntry, loadFullConfig, getApiKeyOptions, isApiKeyRef, getApiKeyRefName } from '../../config.js';
```

Then modify the handler to detect `$$name$$` and pass it to the view:

```typescript
app.get('/admin/models/edit/:model', (c) => {
  const modelParam = c.req.param('model');
  const currentConfig = typeof config === 'function' ? config() : config;
  const model = currentConfig.models.find(p => p.customModel === modelParam);

  if (!model) {
    return c.html(<ModelFormPage error={`未找到模型：${modelParam}`} />);
  }

  try {
    const proxyConfig = loadFullConfig(configPath);
    const apiKeyOptions = getApiKeyOptions(proxyConfig.apiKeys || []);

    // 检测模型是否使用 $$name$$ 引用
    const selectedApiKeyRef = getApiKeyRefName(model.apiKey);

    return c.html(<ModelFormPage model={model} apiKeyOptions={apiKeyOptions} selectedApiKeyRef={selectedApiKeyRef} />);
  } catch (error: any) {
    return c.html(<ModelFormPage model={model} error={`加载配置失败：${error.message}`} />);
  }
});
```

- [ ] **Step 4: Modify test endpoint to resolve $$name$$ references**

Find the POST /admin/models/test handler (line 145), add resolution for `$$name$$` after resolving `apiKeyId`:

```typescript
// 解析 API Key：优先手动输入 > 下拉框 ID > 从已保存的模型配置中读取
let resolvedApiKey = apiKey || '';

if (!resolvedApiKey && apiKeyId) {
  try {
    const proxyConfig = loadFullConfig(configPath);
    const selectedKey = proxyConfig.apiKeys?.find(k => k.id === apiKeyId);
    if (selectedKey) {
      resolvedApiKey = selectedKey.key;
    }
  } catch {
    // 加载失败则继续
  }
}

// 如果 API Key 是 $$name$$ 引用，解析为真实 key
if (resolvedApiKey) {
  try {
    const proxyConfig = loadFullConfig(configPath);
    resolvedApiKey = resolveApiKey(resolvedApiKey, proxyConfig.apiKeys ?? []);
  } catch {
    // 引用不存在时继续使用原值（会得到错误提示）
  }
}
```

Add `resolveApiKey` to imports:
```typescript
import { saveConfig, updateConfigEntry, loadFullConfig, getApiKeyOptions, isApiKeyRef, getApiKeyRefName, resolveApiKey } from '../../config.js';
```

- [ ] **Step 5: Verify TypeScript compilation**

Run: `pnpm build` or `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add src/admin/routes/model-form.tsx
git commit -m "feat: store $$name$$ in model config, detect ref on edit, resolve before test"
```

---

### Task 6: Model form view pre-selects dropdown

**Files:**
- Modify: `src/admin/views/model-form.tsx`

- [ ] **Step 1: Add selectedApiKeyRef to Props**

```typescript
interface Props {
  model?: ProviderConfig;
  error?: string;
  apiKeyOptions?: { id: string; name: string }[];
  selectedApiKeyRef?: string;  // ADD THIS
}
```

- [ ] **Step 2: Modify dropdown to pre-select matching key**

Find the `<select id="apiKeySource">` element (line 262), change to:

```tsx
<select
  class="form-select"
  id="apiKeySource"
  name="apiKeySource"
  onchange="const manualInput = document.getElementById('apiKeyManual'); if (this.value === 'manual') { manualInput.disabled = false; manualInput.required = true; manualInput.focus(); } else { manualInput.disabled = true; manualInput.value = ''; manualInput.required = false; }"
>
  <option value="manual" selected={!props.selectedApiKeyRef}>手动输入...</option>
  {props.apiKeyOptions?.map((opt) => (
    <option value={opt.id} selected={props.selectedApiKeyRef === opt.name}>
      {opt.name}
    </option>
  ))}
</select>
```

- [ ] **Step 3: Modify manual input to disable when ref is active**

Find the `<input id="apiKeyManual">` element (line 274), change to:

```tsx
<input
  class="form-input"
  id="apiKeyManual"
  name="apiKey"
  type="password"
  disabled={!!props.selectedApiKeyRef}
  placeholder={props.selectedApiKeyRef
    ? `使用引用：$$${escapeHtml(props.selectedApiKeyRef) || ''}$$`
    : (isEdit ? '留空则保持原密钥不变' : '请输入 API Key')}
  value={isEdit ? '' : safeValue(props.model?.apiKey)}
  required={!isEdit || !props.selectedApiKeyRef}
/>
```

- [ ] **Step 4: Update hint text**

Find the `<span class="form-hint">` near the API key section (line 283), replace:

```tsx
<span class="form-hint">
  {props.selectedApiKeyRef
    ? `引用 API Key「${escapeHtml(props.selectedApiKeyRef)}」，修改后将全局生效`
    : '可以选择已保存的 API Key，或手动输入'}
</span>
```

- [ ] **Step 5: Verify build**

Run: `pnpm build` or `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add src/admin/views/model-form.tsx
git commit -m "feat: pre-select API key dropdown when editing model with $$name$$ reference"
```

---

### Task 7: API key routes use config-operations for cross-reference cleanup

**Files:**
- Modify: `src/admin/routes/api-keys.tsx`

- [ ] **Step 1: Update edit route to rename model references**

Find the POST /admin/api-keys/edit/:id handler (line 103), before `saveConfig`, detect name change and call `renameApiKeyRefInConfig`:

```typescript
app.post('/admin/api-keys/edit/:id', requireAuth, async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.parseBody();
    const name = body.name as string;
    const key = body.key as string;

    const proxyConfig = loadFullConfig(configPath);
    const currentApiKey = getApiKey(proxyConfig.apiKeys || [], id);

    if (!name) {
      // ...existing error handling...
    }

    const updates: Partial<ApiKey> = { name };
    if (key) {
      updates.key = key;
    }

    // 记录旧名称，用于更新模型的 $$name$$ 引用
    const oldName = currentApiKey?.name;

    const apiKeys = updateApiKey(proxyConfig.apiKeys || [], id, updates);

    let updatedConfig: ProxyConfig = { ...proxyConfig, apiKeys };

    // 如果 API Key 名称变了，更新所有模型的 $$oldName$$ -> $$newName$$
    if (oldName && oldName !== name) {
      updatedConfig = renameApiKeyRefInConfig(updatedConfig, oldName, name);
    }

    saveConfig(updatedConfig, configPath);

    const updatedApiKeys = getApiKeyOptions(apiKeys);
    return c.html(<ApiKeysPage apiKeys={updatedApiKeys} success="API Key 更新成功" />);
  } catch (error: any) {
    const proxyConfig = loadFullConfig(configPath);
    const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
    return c.html(<ApiKeysPage apiKeys={apiKeys} error={`更新失败：${error.message}`} />);
  }
});
```

Add imports at top:
```typescript
import { renameApiKeyRefInConfig } from '../../config-operations.js';
import type { ProxyConfig } from '../../config.js';
```

- [ ] **Step 2: Update delete route to clear model references**

Find the POST /admin/api-keys/delete/:id handler (line 141), before `saveConfig`, detect key name and call `removeApiKeyRefFromConfig`:

```typescript
app.post('/admin/api-keys/delete/:id', requireAuth, async (c) => {
  try {
    const id = c.req.param('id');
    const proxyConfig = loadFullConfig(configPath);

    // 获取要删除的 key 的名称，用于清理模型的引用
    const keyToDelete = getApiKey(proxyConfig.apiKeys || [], id);
    const keyName = keyToDelete?.name;

    const apiKeys = deleteApiKey(proxyConfig.apiKeys || [], id);

    let updatedConfig: ProxyConfig = { ...proxyConfig, apiKeys };

    // 清理所有模型中对该 key 的 $$name$$ 引用
    if (keyName) {
      updatedConfig = removeApiKeyRefFromConfig(updatedConfig, keyName);
    }

    saveConfig(updatedConfig, configPath);

    const updatedApiKeys = getApiKeyOptions(apiKeys);
    return c.html(<ApiKeysPage apiKeys={updatedApiKeys} success="API Key 已删除" />);
  } catch (error: any) {
    const proxyConfig = loadFullConfig(configPath);
    const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
    return c.html(<ApiKeysPage apiKeys={apiKeys} error={`删除失败：${error.message}`} />);
  }
});
```

Add import:
```typescript
import { renameApiKeyRefInConfig, removeApiKeyRefFromConfig } from '../../config-operations.js';
```

- [ ] **Step 3: Verify build**

Run: `pnpm build` or `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: All tests pass (existing + new)

- [ ] **Step 5: Commit**

```bash
git add src/admin/routes/api-keys.tsx
git commit -m "feat: update model $$name$$ refs when API key renamed or deleted"
```
