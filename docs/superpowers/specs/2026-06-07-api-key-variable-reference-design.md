# API Key Variable Reference (`$$name$$`) Design

## Problem

When multiple models share the same API key, changing that key requires manually editing every model. Currently, selecting a saved API key in the model form copies the key value directly into the model's `apiKey` field — no persistent reference is maintained.

## Solution

Store `$$api-key-name$$` in the model's `apiKey` field instead of the actual key value. At request time, resolve the reference by looking up the name in `config.apiKeys`. This allows:

- A single point of update when an API key changes
- Both referenced (`$$name$$`) and literal (real key) values to coexist
- Models to be edited through the dropdown, which pre-selects existing references

## Architecture

### Core Resolution Function

Add to `src/config.ts` (alongside existing `getApiKeyOptions`, `addApiKey`, etc.):

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

### Runtime Resolution (centralized in build functions)

In `src/routes/chat-completions/upstream-request.ts` and `src/routes/messages/upstream-request.ts`:

- Accept an optional `apiKeys?: ApiKey[]` parameter
- Inside, call `resolveApiKey(provider.apiKey, apiKeys)` before building headers
- Create a shallow copy of the provider with the resolved key (never mutate the config)
- All downstream code (`buildHeaders`, interceptors) receives the resolved key

### Callers pass apiKeys

Four callers pass `currentConfig.apiKeys` to the build functions:

| Handler | File |
|---------|------|
| Chat completions single model | `handler.ts` |
| Chat completions fallback | `model-fallback.ts` |
| Messages single model | `messages/handler.ts` |
| Messages fallback | `msg-fallback.ts` |

### Model Form Route Changes (`admin/routes/model-form.tsx`)

**Save (POST /admin/models):** When `apiKeySource` is a saved key UUID, look up the name and store `$$name$$`:

```typescript
const selectedKey = proxyConfig.apiKeys?.find(k => k.id === apiKeySource);
finalApiKey = `$$${selectedKey.name}$$`;
```

Manual input (`apiKey`) is stored as-is — can be a real key or a `$$name$$`.

**Edit (POST /admin/models/edit/:model):** Same logic.

**Load (GET /admin/models/edit/:model):** Detect `$$name$$` in existing model's `apiKey` and pass `selectedApiKeyRef` to the view for dropdown pre-selection.

**Test (POST /admin/models/test):** Resolve `$$name$$` references before sending the test request.

### Model Form View Changes (`admin/views/model-form.tsx`)

- **Props**: Add `selectedApiKeyRef?: string`
- **Dropdown**: Pre-select the matching API key by name when `selectedApiKeyRef` matches
- **Manual input**: Disabled when a reference is active, showing hint like `使用引用：$$my-key$$`
- **JS `onchange`**: Existing toggle logic already works — switching to "手动输入..." enables the field, selecting a key disables it

### API Key CRUD Cross-Reference Cleanup (`config-operations.ts` + `admin/routes/api-keys.tsx`)

**New functions in `config-operations.ts`:**

```typescript
export function renameApiKeyRefInConfig(config: ProxyConfig, oldName: string, newName: string): ProxyConfig
```
Updates all `$$oldName$$` references in models to `$$newName$$`.

```typescript
export function removeApiKeyRefFromConfig(config: ProxyConfig, keyName: string): ProxyConfig
```
Clears (sets to `''`) all models referencing `$$keyName$$`.

**API Key edit route:** After updating the key name in `apiKeys[]`, call `renameApiKeyRefInConfig` if the name changed.

**API Key delete route:** Before saving, call `removeApiKeyRefFromConfig` to clear references.

### Duplicate API Key Name Validation

In `config.ts` `addApiKey` and `updateApiKey`, validate that `name` is unique to prevent ambiguity in `$$name$$` resolution.

## File Change Summary

| # | File | Change |
|---|------|--------|
| 1 | `src/config.ts` | Add `isApiKeyRef`, `getApiKeyRefName`, `resolveApiKey`; add name uniqueness validation |
| 2 | `src/config-operations.ts` | Add `renameApiKeyRefInConfig`, `removeApiKeyRefFromConfig` |
| 3 | `src/routes/chat-completions/upstream-request.ts` | Accept `apiKeys` param, resolve before building |
| 4 | `src/routes/messages/upstream-request.ts` | Same as #3 |
| 5 | `src/routes/chat-completions/handler.ts` | Pass `currentConfig.apiKeys` to build function |
| 6 | `src/routes/messages/handler.ts` | Pass `currentConfig.apiKeys` to build function |
| 7 | `src/routes/chat-completions/model-fallback.ts` | Pass apiKeys in fallback loop |
| 8 | `src/routes/messages/msg-fallback.ts` | Pass apiKeys in fallback loop |
| 9 | `src/admin/routes/model-form.tsx` | Save `$$name$$`; detect ref in edit; test endpoint resolve |
| 10 | `src/admin/views/model-form.tsx` | Add `selectedApiKeyRef` prop; pre-select dropdown; show hints |
| 11 | `src/admin/routes/api-keys.tsx` | Call config-operations on rename/delete |

## Edge Cases

1. **Broken reference at request time**: `resolveApiKey` throws a clear error; caller returns 500 with message.
2. **Manual `$$name$$` input**: User can type `$$name$$` directly in manual field — treated same as dropdown selection.
3. **Existing models with literal keys**: `resolveApiKey` returns them unchanged — zero migration needed.
4. **API Key name change**: Models auto-update via `renameApiKeyRefInConfig`.
5. **API Key deletion**: Model references cleared to `''` via `removeApiKeyRefFromConfig`; model form requires new key.
6. **Duplicate API Key names**: Prevented at add/update time with uniqueness validation.
