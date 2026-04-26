# Privacy Protection Design

**Date:** 2026-04-26  
**Status:** Draft  

## Problem

When forwarding requests to upstream LLM providers, the gateway may leak user-identifying information in three ways:

1. **Protocol-level fields**: The OpenAI `user` field and metadata extensions (`metadata`, `extra_body`, `extra_headers`) are forwarded verbatim to upstream providers.
2. **File paths in message content**: Coding agents embed full file paths (e.g., `/home/zhangsan/projects/...`, `/Users/lisi/Documents/...`) in prompt messages, which are business data that cannot be stripped.
3. **Uncontrolled field forwarding**: The current `...body` spread forwards all client fields except `model`, including unknown or identity-related fields.

## Goals

- Prevent any user-identifying information from reaching upstream LLM providers.
- Provide an admin UI with a master switch and per-feature toggles.
- Log all filtered-out fields for audit visibility.
- Support both non-streaming and streaming responses for path sanitization.
- All changes must be on a new branch (`feature/privacy-protection`), tests must pass before push.

## Architecture

### Module Structure

```
src/
├── privacy/
│   ├── types.ts                # PrivacySettings config type
│   ├── whitelist-filter.ts     # Whitelist-based field r field filtering with logging
│   ├── sanitizer.ts            # File path username replacement + reverse mapping
│   └── apply.ts                # Orchestration: applies all enabled protections in order
│
└── admin/
    ├── routes/privacy.tsx      # GET/POST handlers for privacy settings page
    └── views/privacy-settings.tsx  # Admin page view (TopbarNav-wrapped)
```

### Config Extension

Add `privacySettings` to `ProxyConfig` (global, not per-provider):

```ts
// In ProxyConfig interface:
privacySettings?: {
  enabled: boolean;               // Master switch
  stripUserField: boolean;        // Remove `user` field from requests
  sanitizeFilePaths: boolean;     // Replace usernames in file paths
  pathPlaceholder: string;        // Placeholder for usernames (default: "__USER__")
  whitelistFilter: boolean;       // Only forward whitelisted fields
}
```

Default values (when not configured): all `false`, `pathPlaceholder: "__USER__"`.

### Integration Points

**Where settings are read:** `privacySettings` is at the `ProxyConfig` level (global config), so it is accessible via `currentConfig.privacySettings` in any route handler.

### Request Data Flow

```
Client request body
  ↓
[1] whitelist-filter (if enabled)
    → Keep only: messages, stream, temperature, max_tokens, top_p,
      presence_penalty, frequency_penalty, stop, response_format,
      tools, tool_choice, seed, stream_options
    → Log filtered-out fields: 🔒 [Privacy] requestId=xxx filtered: user="...", metadata="..."
  ↓
[2] strip-user (if enabled)
    → Delete `user` field (safety net if whitelist filter is off)
    → Log: 🔒 [Privacy] requestId=xxx stripped: user="..."
  ↓
[3] sanitizer (if enabled)
    → Replace /home/xxx/, /Users/xxx/, C:\Users\xxx\ with placeholder
    → Store mapping in per-requestId Map: placeholder → real_path
  ↓
Build upstream request → Send to provider
```

### Response Data Flow

```
Upstream response (non-streaming)
  ↓
[4] sanitizer.reverse (if enabled)
    → Replace placeholder back to real username in response body
    → Clear mapping from per-requestId Map
  ↓
Send to client

Upstream response (streaming)
  ↓
[4a] For each SSE chunk, sanitize content before enqueue
    → Replace placeholder back to real username in delta content
    → Clear mapping when stream ends
  ↓
Send to client
```

## Detailed Design

### 1. Whitelist Filter (`privacy/whitelist-filter.ts`)

```ts
const SAFE_FIELDS = [
  'messages', 'stream', 'temperature', 'max_tokens', 'top_p',
  'presence_penalty', 'frequency_penalty', 'stop', 'response_format',
  'tools', 'tool_choice', 'seed', 'stream_options'
];
```

- Filters body to only include whitelisted fields.
- Logs removed fields with `🔒 [Privacy] requestId=xxx filtered: field1, field2 → {values}` (truncated to 500 chars).
- Returns filtered body (does not mutate original).

### 2. Strip User Field (`privacy/strip-user.ts`)

- Deletes `user` field from body if present.
- Logs: `🔒 [Privacy] requestId=xxx stripped: user="..."`.
- No-op if field doesn't exist.

### 3. Path Sanitizer (`privacy/sanitizer.ts`)

**Patterns:**
- `/home/<username>/` → `/home/__USER__/`
- `/Users/<username>/` → `/Users/__USER__/`
- `C:\Users\<username>\` → `C:\Users\__USER__\`

**Mapping storage:**
```ts
const pathMappings = new Map<string, Map<string, string>>();
// key: requestId, value: Map<placeholder_path, real_path>
```

**Functions:**
- `sanitizePaths(body: any, placeholder: string, requestId: string)`: Recursively walks body strings, replaces usernames, stores mappings.
- `restorePaths(body: any, requestId: string)`: Reverse replaces using stored mappings, clears entry.
- `sanitizeSSEChunk(sseLine: string, requestId: string): string`: For streaming, reverse replaces in each SSE chunk.

**Edge cases:**
- If AI response content happens to contain the placeholder, it will be reverse-replaced incorrectly. Low probability, low impact.
- Mapping is cleaned up after response is fully sent (non-streaming) or stream ends (streaming).

### 4. Orchestration (`privacy/apply.ts`)

```ts
export function applyPrivacyProtection(
  body: any,
  settings: PrivacySettings,
  requestId: string
): any {
  let processed = body;
  
  if (settings.whitelistFilter) {
    processed = filterWhitelistedFields(processed, requestId);
  }
  
  if (settings.stripUserField) {
    stripUserField(processed, requestId);
  }
  
  if (settings.sanitizeFilePaths) {
    sanitizePaths(processed, settings.pathPlaceholder, requestId);
  }
  
  return processed;
}
```

### 5. Integration Points

**`src/routes/chat-completions/upstream-request.ts`:**
```ts
// In buildUpstreamRequest, before building requestBody:
// Read from global config via config getter
const privacySettings = getCurrentConfig().privacySettings;
if (privacySettings?.enabled) {
  body = applyPrivacyProtection(body, privacySettings, requestId);
}
```

**`src/routes/chat-completions/stream-handler.ts`:**
- In the SSE processing loop, before `controller.enqueue()`:
```ts
const privacySettings = getCurrentConfig().privacySettings;
if (privacySettings?.enabled && privacySettings?.sanitizeFilePaths) {
  sseLine = sanitizeSSEChunk(sseLine, requestId);
}
```

**`src/routes/messages/upstream-request.ts`:**
- Same integration as chat-completions.

### 6. Admin Page

**Route:** `GET /admin/privacy`, `POST /admin/privacy`

**View:** `privacy-settings.tsx`

- Wrapped in `<TopbarNav title="隐私保护" activePath="/admin/privacy">`.
- Shows:
  - Master toggle: "启用隐私保护" (checkbox)
  - Sub-toggles (disabled when master is off):
    - "抹掉 user 字段"
    - "文件路径用户名替换" — with input for placeholder (default: `__USER__`)
    - "白名单字段过滤" — with list of whitelisted fields (read-only display)
- POST handler saves to config via `loadFullConfig() → modify → saveConfig() → onConfigChange() → redirect`.

**Nav entry:** Add "隐私保护" to `TopbarNav.tsx` `menuItems`.

### 7. Tests

**Unit tests:**
- `tests/privacy/whitelist-filter.test.ts` — normal body, empty body, all-unknown-fields, all-safe-fields, logging output.
- `tests/privacy/strip-user.test.ts` — with user field, without user field, logging.
- `tests/privacy/sanitizer.test.ts` — Linux paths, macOS paths, Windows paths, no paths, nested objects in body, reverse mapping, SSE chunk sanitization.
- `tests/privacy/apply.test.ts` — all enabled, all disabled, partial enabled.

**TSX view tests:**
- `tests/views/privacy-settings.test.tsx` — render page, verify HTML structure, toggle states, inline JS syntax via `new Function()`.

**Integration tests:**
- `tests/routes/privacy.test.ts` — GET returns 200, POST saves config, config persists.
- `tests/routes/chat-completions-privacy.test.ts` — verify user field stripped, file paths sanitized, whitelist fields removed in actual request flow (via mock upstream).

## Error Handling

- If sanitizer mapping is missing for a requestId (e.g., response arrives after timeout), `restorePaths` and `sanitizeSSEChunk` are no-ops.
- Filter logging truncates field values to 500 chars to avoid log flooding.
- All privacy functions are defensive — they handle missing/undefined/malformed input gracefully without throwing.

## Out of Scope

- Sanitizing `tools` definitions (tool names may contain internal system names). Left for future.
- Model fallback multi-provider forwarding audit. Left for future.
- DetailLogger disk log encryption. Left for future.
