# OpenCode Session 指纹 + UA 统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** opencode.ai 全模型加 session 头，指纹三档 + user/realModel，TTL 20min，出站 UA 统一。

**Architecture:** 只改 `opencode-session.ts`（指纹+拦截器）、`openai.ts`/`anthropic.ts`（UA），新建一个单测文件。`VERSION` 复用 `src/lib/version.ts`。

**Tech Stack:** TypeScript, vitest, node:crypto (createHash/sha256, randomBytes 保留）。

---

### Task 1: opencode-session 指纹与拦截器重写

**Files:**
- Modify: `src/interceptor/opencode-session.ts`
- Test: `src/interceptor/opencode-session.test.ts` (新建，参考 `src/interceptor/user-model-access.test.ts` 的 makeCtx 写法）

**指纹规则（spec §2）：**
- 第 1 档：客户端请求头名小写含 `session` 的首个非空值（黑名单跳过 `authorization/cookie/set-cookie/apikey/*token*`，trim），材料 = `session头值 + 远程IP + user + realModel`
- 第 2 档：无 session 头但有 `x-stainless-*`，材料 = `stainless拼接 + 远程IP + user-agent + user + realModel`
- 第 3 档：`远程IP + user-agent + user + realModel`
- user = `ctx.currentUser?.name ?? ''`，realModel 取 `ctx.provider.realModel` 小写归一，header 取自 `ctx.c.req.header(name)` / `ctx.c.req.raw.headers`，三档统一 sha256 hex
- `shouldIntercept` 去掉 `TARGET_MODELS`，只看 baseUrl 含 `opencode.ai`
- 池 `Map<fingerprint, {sessionId, expiresAt}>`，TTL 20 分钟滑动续期，保留惰性清理
- `generateOpenCodeId` 原样保留，只在新建 session 时调用

- [ ] **Step 1: 写 failing test（新建单测文件）**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { opencodeSessionInterceptor, resetSessionCache } from './opencode-session.js'
import type { UpstreamRequest } from '../routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from './types.js'

function makeCtx(overrides?: Partial<UpstreamInterceptorContext>): UpstreamInterceptorContext {
  return {
    provider: {
      customModel: 'test-kimi',
      realModel: 'kimi-k2',
      apiKey: 'sk-test',
      baseUrl: 'https://api.opencode.ai/v1',
      provider: 'openai',
    },
    c: {
      req: {
        header: (name: string) => {
          const h: Record<string, string> = { 'user-agent': 'test-ua/1.0' }
          return h[name.toLowerCase()] ?? null
        },
        raw: { headers: {} },
      },
    } as any,
    currentUser: null,
    clientIp: '1.2.3.4',
    requestId: 'test-001',
    customModel: 'test-kimi',
    stream: false,
    ...overrides,
  }
}

const baseUpstream: UpstreamRequest = {
  url: 'https://api.opencode.ai/v1/chat/completions',
  headers: { Authorization: 'Bearer test-key' },
  body: { model: 'kimi-k2', messages: [] },
}

describe('opencodeSessionInterceptor', () => {
  beforeEach(() => resetSessionCache())

  it('非 opencode 域名直接透传', async () => {
    const ctx = makeCtx({
      provider: { ...makeCtx().provider, baseUrl: 'https://api.openai.com/v1' },
    })
    const result = await opencodeSessionInterceptor(baseUpstream, ctx)
    expect(result).toBe(baseUpstream)
  })

  it('opencode 全模型都加头（非 kimi/glm 也加）', async () => {
    const ctx = makeCtx({
      provider: { ...makeCtx().provider, realModel: 'some-other-model' },
    })
    const result = await opencodeSessionInterceptor(baseUpstream, ctx)
    expect(result.headers['x-opencode-session']).toMatch(/^ses_/)
    expect(result.body.prompt_cache_key).toBe(result.headers['x-opencode-session'])
  })

  it('同指纹 20 分钟内复用 session', async () => {
    const ctx = makeCtx()
    const r1 = await opencodeSessionInterceptor(baseUpstream, ctx)
    const r2 = await opencodeSessionInterceptor(baseUpstream, ctx)
    expect(r2.headers['x-opencode-session']).toBe(r1.headers['x-opencode-session'])
  })

  it('不同 realModel 不串 session', async () => {
    const ctx = makeCtx()
    const r1 = await opencodeSessionInterceptor(baseUpstream, ctx)
    const ctx2 = makeCtx({
      provider: { ...makeCtx().provider, realModel: 'glm-4' },
    })
    const r2 = await opencodeSessionInterceptor(baseUpstream, ctx2)
    expect(r2.headers['x-opencode-session']).not.toBe(r1.headers['x-opencode-session'])
  })
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/interceptor/opencode-session.test.ts`
Expected: FAIL（`opencode-session.ts` 还是旧逻辑：`some-other-model` 不加头）

- [ ] **Step 3: 实现指纹 + 拦截器最小改动**

```ts
import { createHash, randomBytes } from 'node:crypto'
import type { UpstreamInterceptor, UpstreamInterceptorContext } from './types.js'

// generateOpenCodeId 原样保留（ses_ 时间戳+随机，仅新建 session 时调用）
// ... existing generateOpenCodeId + state ...

const SESSION_TTL_MS = 20 * 60 * 1000

interface SessionEntry {
  sessionId: string
  expiresAt: number
}

const sessionMap = new Map<string, SessionEntry>()

const SESSION_HEADER_BLACKLIST = ['authorization', 'cookie', 'set-cookie', 'apikey', 'token']

function getClientHeader(ctx: UpstreamInterceptorContext, name: string): string | null {
  try {
    const v = ctx.c?.req?.header?.(name) ?? ctx.c?.req?.header?.(name.toLowerCase())
    if (typeof v === 'string' && v.trim()) return v
  } catch { /* ignore */ }
  try {
    const raw = ctx.c?.req?.raw?.headers
    const get = (k: string) => {
      if (!raw) return null
      if (typeof raw.get === 'function') return raw.get(k) ?? raw.get(k.toLowerCase())
      return raw[k] ?? raw[k.toLowerCase()] ?? null
    }
    const v = get(name)
    if (typeof v === 'string' && v.trim()) return v
  } catch { /* ignore */ }
  return null
}

function listClientHeaderNames(ctx: UpstreamInterceptorContext): string[] {
  try {
    const raw = ctx.c?.req?.raw?.headers
    if (raw && typeof raw.keys === 'function') return [...raw.keys()]
    if (raw && typeof raw === 'object') return Object.keys(raw)
  } catch { /* ignore */ }
  return []
}

function findSessionHeaderValue(ctx: UpstreamInterceptorContext): string | null {
  for (const name of listClientHeaderNames(ctx)) {
    const lower = name.toLowerCase()
    if (!lower.includes('session')) continue
    if (SESSION_HEADER_BLACKLIST.some(b => lower.includes(b))) continue
    const v = getClientHeader(ctx, name)
    if (v && v.trim()) return v.trim()
  }
  // raw 不可枚举时兜底常见名
  for (const name of ['session-id', 'x-session-id', 'x-opencode-session']) {
    const v = getClientHeader(ctx, name)
    if (v && v.trim()) return v.trim()
  }
  return null
}

function stainlessFingerprint(ctx: UpstreamInterceptorContext): string | null {
  const parts = ['x-stainless-lang', 'x-stainless-package-version', 'x-stainless-runtime', 'x-stainless-runtime-version']
    .map(n => getClientHeader(ctx, n) ?? '')
  return parts.some(p => p) ? parts.join('|') : null
}

function computeFingerprint(ctx: UpstreamInterceptorContext): string {
  const ip = ctx.clientIp ?? 'unknown'
  const user = ctx.currentUser?.name ?? ''
  const realModel = (ctx.provider.realModel ?? '').toLowerCase()
  const sessionHead = findSessionHeaderValue(ctx)
  if (sessionHead) {
    return createHash('sha256').update([sessionHead, ip, user, realModel].join('\n')).digest('hex')
  }
  const ua = getClientHeader(ctx, 'user-agent') ?? ''
  const stainless = stainlessFingerprint(ctx)
  const material = stainless
    ? [stainless, ip, ua, user, realModel].join('\n')
    : [ip, ua, user, realModel].join('\n')
  return createHash('sha256').update(material).digest('hex')
}

function getOrCreateSession(key: string): string {
  const now = Date.now()
  const existing = sessionMap.get(key)
  if (existing && existing.expiresAt > now) {
    existing.expiresAt = now + SESSION_TTL_MS
    return existing.sessionId
  }
  const sessionId = generateOpenCodeId('ses', 'descending')
  sessionMap.set(key, { sessionId, expiresAt: now + SESSION_TTL_MS })
  lazyCleanup()
  return sessionId
}

const OPENCODE_DOMAINS = ['opencode.ai']

function shouldIntercept(ctx: UpstreamInterceptorContext): boolean {
  const baseUrl = ctx.provider.baseUrl?.toLowerCase() ?? ''
  return OPENCODE_DOMAINS.some(d => baseUrl.includes(d))
}

export const opencodeSessionInterceptor: UpstreamInterceptor = async (upstream, ctx) => {
  if (!shouldIntercept(ctx)) return upstream
  const sessionId = getOrCreateSession(computeFingerprint(ctx))
  return {
    ...upstream,
    headers: { ...upstream.headers, 'x-opencode-session': sessionId },
    body: { ...upstream.body, prompt_cache_key: sessionId },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/interceptor/opencode-session.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/interceptor/opencode-session.ts src/interceptor/opencode-session.test.ts
git commit -m "feat(session): opencode 全模型 session 指纹三档 + 20min TTL"
```

---

### Task 2: 出站 UA 统一（openai + anthropic）

**Files:**
- Modify: `src/providers/openai.ts`
- Modify: `src/providers/anthropic.ts`
- `VERSION` 复用 `src/lib/version.ts`（已存在：`require('../../package.json').version`，不要手写读包）

- [ ] **Step 1: openai.ts 加 UA**

```ts
import { BaseProvider } from './base.js'
import { VERSION } from '../lib/version.js'

// buildHeaders 内追加：
'User-Agent': `kkito-llm-agent/${VERSION}`,
```

完整 buildHeaders：

```ts
buildHeaders(apiKey: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'User-Agent': `kkito-llm-agent/${VERSION}`,
  }
}
```

注意 `ResponseApiProvider extends OpenAIProvider`，继承即覆盖 responses 路由。

- [ ] **Step 2: anthropic.ts 加 UA**

```ts
import { VERSION } from '../lib/version.js'

buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'X-API-Key': apiKey,
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'anthropic-version': this.version,
    'User-Agent': `kkito-llm-agent/${VERSION}`,
  }
  // beta 逻辑保留
}
```

- [ ] **Step 3: 跑全量测试 + 类型检查**

Run: `npx vitest run src/providers/ src/interceptor/opencode-session.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 4: Commit**

```bash
git add src/providers/openai.ts src/providers/anthropic.ts
git commit -m "feat(ua): 出站统一 User-Agent kkito-llm-agent/<version>"
```

---

## Self-Review

- spec §1 全模型（去 TARGET_MODELS）→ Task 1 shouldIntercept ✔
- spec §2 三档 + user + realModel + sha256 → Task 1 computeFingerprint ✔（第1档 session头+IP+user+realModel；第2档 stainless+IP+UA+user+realModel；第3档 IP+UA+user+realModel）
- spec §3 池按 fingerprint（含 realModel 自然隔离）+ 20min 滑动 → Task 1 ✔
- spec §4 UA 全局（openai + anthropic，VERSION 复用 version.ts，三路由×流式/非流式/透传经 buildHeaders 全覆盖）→ Task 2 ✔
- 无占位符；类型/签名与现有 `UpstreamInterceptor`、`Provider.buildHeaders` 一致。
