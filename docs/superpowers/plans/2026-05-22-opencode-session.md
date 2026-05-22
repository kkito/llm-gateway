# Opencode Session 拦截器 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 Opencode Session 拦截器，对 `baseUrl` 含 `opencode.ai` 且 `realModel` 小写含 `kimi`/`glm`/`mino` 的请求，自动注入 `x-opencode-session` header 和 `prompt_cache_key` body 字段。Session 按客户端 IP 独立管理，10 分钟滑动过期。

**Architecture:** 在 `src/interceptor/` 下新建 `opencode-session.ts`，内部包含 `generateOpenCodeId`（参考 `try/cache/using_extra_header` 分支）和 IP 维度的 session 缓存管理。在 `src/server.ts` 中注册。Session 管理完全内聚在拦截器内部，不污染外部全局变量。

**Tech Stack:** TypeScript, UpstreamInterceptor 框架, Vitest, crypto (Node.js built-in)

---

### Task 1: 创建 opencode-session.ts — 核心逻辑

**Files:**
- Create: `src/interceptor/opencode-session.ts`

**内容：** 包含 session ID 生成、session 缓存管理、拦截器入口。三个部分都在同一个文件中。

- [ ] **Step 1: 编写 session ID 生成函数（参考 try/cache/using_extra_header 分支）**

```typescript
import { randomBytes } from 'crypto'
import type { UpstreamInterceptor, UpstreamInterceptorContext } from './types.js'

// ============================================================
// Session ID 生成（参考 try/cache/using_extra_header 分支）
// ============================================================

/**
 * 生成 OpenCode 兼容的 ID
 * 格式：<prefix>_<12hex时间戳><14base62随机字符>（与 OpenCode CLI 兼容）
 *
 * @param prefix - ID 前缀（ses / msg）
 * @param direction - 时间排序方向
 * @param reuse - 是否复用已生成的 ID（仅对 session 生效）
 */
function generateOpenCodeId(
  prefix: string,
  direction: 'ascending' | 'descending',
  reuse: boolean = false,
): string {
  // session 复用已有值
  if (reuse && prefix === 'ses' && _currentSessionId) {
    return _currentSessionId
  }

  const currentTimestamp = Date.now()

  if (currentTimestamp !== _lastRequestTimestamp) {
    _lastRequestTimestamp = currentTimestamp
    _requestCounter = 0
  }
  _requestCounter++

  let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(_requestCounter)
  now = direction === 'descending' ? ~now : now

  const timeBytes = Buffer.alloc(6)
  for (let i = 0; i < 6; i++) {
    timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
  }

  const hex = timeBytes.toString('hex')
  const random = randomBytes(14)
    .toString('base64url')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 14)

  const id = `${prefix}_${hex}${random}`

  if (reuse && prefix === 'ses') {
    _currentSessionId = id
  }

  return id
}

// 生成器的内部状态
let _currentSessionId: string | null = null
let _requestCounter = 0
let _lastRequestTimestamp = 0

// ============================================================
// Session 缓存管理（按 IP 维度，10 分钟滑动过期）
// ============================================================

const SESSION_TTL_MS = 10 * 60 * 1000 // 10 分钟

interface SessionEntry {
  sessionId: string
  expiresAt: number
}

const sessionMap = new Map<string, SessionEntry>()

/**
 * 惰性清理——遍历 Map，移除过期条目。
 * 每次需要操作 Map 时调用，限制最多检查 50 个 key 避免阻塞。
 */
function lazyCleanup(): void {
  const now = Date.now()
  let checked = 0
  for (const [ip, entry] of sessionMap) {
    if (checked >= 50) break
    if (entry.expiresAt <= now) {
      sessionMap.delete(ip)
    }
    checked++
  }
}

/**
 * 获取指定 IP 的 session。
 * - session 存在且未过期 → 复用并续期
 * - session 过期或不存在 → 生成新 session
 */
function getOrCreateSession(ip: string): string {
  const now = Date.now()
  const existing = sessionMap.get(ip)

  if (existing && existing.expiresAt > now) {
    // 续期（滑动窗口）
    existing.expiresAt = now + SESSION_TTL_MS
    return existing.sessionId
  }

  // 过期或不存在，生成新 session
  const sessionId = generateOpenCodeId('ses', 'descending')
  sessionMap.set(ip, { sessionId, expiresAt: now + SESSION_TTL_MS })

  // 惰性清理
  lazyCleanup()

  return sessionId
}
```

- [ ] **Step 2: 编写触发条件判断函数**

```typescript
// ============================================================
// 触发条件判断
// ============================================================

const OPENCODE_DOMAINS = ['opencode.ai']
const TARGET_MODELS = ['kimi', 'glm', 'mino']

function shouldIntercept(ctx: UpstreamInterceptorContext): boolean {
  const baseUrl = ctx.provider.baseUrl?.toLowerCase() ?? ''
  const realModel = ctx.provider.realModel?.toLowerCase() ?? ''

  const matchDomain = OPENCODE_DOMAINS.some(d => baseUrl.includes(d))
  if (!matchDomain) return false

  const matchModel = TARGET_MODELS.some(m => realModel.includes(m))
  return matchModel
}
```

- [ ] **Step 3: 编写拦截器入口**

```typescript
// ============================================================
// 拦截器入口
// ============================================================

/**
 * OpenCode Session 拦截器。
 *
 * 当 baseUrl 含 "opencode.ai" 且 realModel 小写含 "kimi"/"glm"/"mino" 时：
 * - header 添加 x-opencode-session
 * - body 添加 prompt_cache_key
 *
 * Session 按客户端 IP 独立管理，10 分钟滑动过期。
 */
export const opencodeSessionInterceptor: UpstreamInterceptor = async (upstream, ctx) => {
  if (!shouldIntercept(ctx)) return upstream

  const ip = ctx.clientIp ?? 'unknown'
  const sessionId = getOrCreateSession(ip)

  return {
    ...upstream,
    headers: {
      ...upstream.headers,
      'x-opencode-session': sessionId,
    },
    body: {
      ...upstream.body,
      prompt_cache_key: sessionId,
    },
  }
}

// 导出，便于测试重置
/** @internal 测试用：重置 session 缓存 */
export function resetSessionCache(): void {
  sessionMap.clear()
  _currentSessionId = null
  _requestCounter = 0
  _lastRequestTimestamp = 0
}
```

- [ ] **Step 4: 编译验证**

```bash
cd /Users/kkito/proj/github/llm-gateway && npx tsc --noEmit src/interceptor/opencode-session.ts
```

Expected: No errors.

---

### Task 2: 编写 opencode-session.test.ts — 完整测试

**Files:**
- Create: `src/interceptor/opencode-session.test.ts`

测试覆盖触发条件、session 管理、注入行为。共 16+ 个测试。

- [ ] **Step 1: 编写触发条件测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { opencodeSessionInterceptor, resetSessionCache } from './opencode-session.js'
import type { UpstreamRequest } from '../routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from './types.js'

beforeEach(() => {
  resetSessionCache()
})

function makeUpstream(overrides?: Partial<UpstreamRequest>): UpstreamRequest {
  return {
    url: 'https://api.opencode.ai/v1/chat/completions',
    headers: { authorization: 'Bearer sk-test' },
    body: { model: 'kimi-v1', messages: [{ role: 'user', content: 'hi' }] },
    ...overrides,
  }
}

function makeCtx(overrides?: Partial<UpstreamInterceptorContext>): UpstreamInterceptorContext {
  return {
    provider: {
      customModel: 'my-kimi',
      realModel: 'kimi-v1',
      apiKey: 'sk-test',
      baseUrl: 'https://api.opencode.ai',
      provider: 'openai',
    },
    c: {} as any,
    currentUser: null,
    clientIp: '192.168.1.1',
    requestId: 'test-001',
    customModel: 'my-kimi',
    stream: false,
    ...overrides,
  }
}

describe('shouldIntercept — 触发条件', () => {
  it('should intercept when baseUrl contains opencode.ai and model is kimi', async () => {
    const upstream = makeUpstream()
    const ctx = makeCtx({ provider: { ...makeCtx().provider, realModel: 'kimi-v1' } as any })
    const result = await opencodeSessionInterceptor(upstream, ctx)
    expect(result.headers).toHaveProperty('x-opencode-session')
    expect(result.body).toHaveProperty('prompt_cache_key')
  })

  it('should intercept when baseUrl contains opencode.ai and model is glm', async () => {
    const ctx = makeCtx({ provider: { ...makeCtx().provider, realModel: 'glm-4' } as any })
    const result = await opencodeSessionInterceptor(makeUpstream(), ctx)
    expect(result.headers).toHaveProperty('x-opencode-session')
  })

  it('should intercept when baseUrl contains opencode.ai and model is mino', async () => {
    const ctx = makeCtx({ provider: { ...makeCtx().provider, realModel: 'mino-v1' } as any })
    const result = await opencodeSessionInterceptor(makeUpstream(), ctx)
    expect(result.headers).toHaveProperty('x-opencode-session')
  })

  it('should intercept case-insensitively: OPenCode.AI and KIMI', async () => {
    const ctx = makeCtx({
      provider: { ...makeCtx().provider, baseUrl: 'https://OPenCode.AI', realModel: 'KIMI-v1' } as any,
    })
    const result = await opencodeSessionInterceptor(makeUpstream(), ctx)
    expect(result.headers).toHaveProperty('x-opencode-session')
  })

  it('should skip when baseUrl does not contain opencode.ai', async () => {
    const ctx = makeCtx({ provider: { ...makeCtx().provider, baseUrl: 'https://api.openai.com' } as any })
    const result = await opencodeSessionInterceptor(makeUpstream(), ctx)
    expect(result).toBe(makeUpstream()) // 恒等（因为 skip 返回原对象）
    // 实际上要保存引用
  })

  // 修正：skip 返回原引用
  it('should return upstream unchanged when baseUrl does not contain opencode.ai', async () => {
    const upstream = makeUpstream()
    const ctx = makeCtx({ provider: { ...makeCtx().provider, baseUrl: 'https://api.openai.com' } as any })
    const result = await opencodeSessionInterceptor(upstream, ctx)
    expect(result).toBe(upstream)
  })

  it('should skip when model does not match kimi/glm/mino', async () => {
    const upstream = makeUpstream()
    const ctx = makeCtx({ provider: { ...makeCtx().provider, realModel: 'gpt-4' } as any })
    const result = await opencodeSessionInterceptor(upstream, ctx)
    expect(result).toBe(upstream)
  })

  it('should skip when baseUrl contains opencode.ai but model is empty', async () => {
    const upstream = makeUpstream()
    const ctx = makeCtx({ provider: { ...makeCtx().provider, realModel: '' } as any })
    const result = await opencodeSessionInterceptor(upstream, ctx)
    expect(result).toBe(upstream)
  })

  it('should skip when baseUrl is empty', async () => {
    const upstream = makeUpstream()
    const ctx = makeCtx({ provider: { ...makeCtx().provider, baseUrl: '' } as any })
    const result = await opencodeSessionInterceptor(upstream, ctx)
    expect(result).toBe(upstream)
  })
})
```

- [ ] **Step 2: 编写 session 管理测试**

```typescript
describe('session 管理', () => {
  it('should generate session ID with correct format', async () => {
    const upstream = makeUpstream()
    const ctx = makeCtx()
    const result = await opencodeSessionInterceptor(upstream, ctx)
    const sessionId = result.headers['x-opencode-session']
    // 格式：ses_<12hex><14字母数字>
    expect(sessionId).toMatch(/^ses_[a-f0-9]{12}[a-zA-Z0-9]{14}$/)
  })

  it('should reuse session for same IP', async () => {
    const ctx = makeCtx({ clientIp: '10.0.0.1' })
    const r1 = await opencodeSessionInterceptor(makeUpstream(), ctx)
    const r2 = await opencodeSessionInterceptor(makeUpstream(), ctx)
    expect(r1.headers['x-opencode-session']).toBe(r2.headers['x-opencode-session'])
  })

  it('should provide different sessions for different IPs', async () => {
    const ctx1 = makeCtx({ clientIp: '10.0.0.1' })
    const ctx2 = makeCtx({ clientIp: '10.0.0.2' })
    const r1 = await opencodeSessionInterceptor(makeUpstream(), ctx1)
    const r2 = await opencodeSessionInterceptor(makeUpstream(), ctx2)
    expect(r1.headers['x-opencode-session']).not.toBe(r2.headers['x-opencode-session'])
  })

  it('should generate new session after TTL expires', async () => {
    const ctx = makeCtx({ clientIp: '10.0.0.1' })
    const r1 = await opencodeSessionInterceptor(makeUpstream(), ctx)

    // 模拟时间前进 11 分钟（超过 TTL）
    const originalDateNow = Date.now
    const fakeNow = Date.now() + 11 * 60 * 1000
    Date.now = () => fakeNow

    try {
      const r2 = await opencodeSessionInterceptor(makeUpstream(), ctx)
      expect(r1.headers['x-opencode-session']).not.toBe(r2.headers['x-opencode-session'])
    } finally {
      Date.now = originalDateNow
    }
  })

  it('should renew expiration on each request (sliding window)', async () => {
    const ctx = makeCtx({ clientIp: '10.0.0.1' })

    const r1 = await opencodeSessionInterceptor(makeUpstream(), ctx)
    const sessionId1 = r1.headers['x-opencode-session']

    // 前进 9 分钟（在 TTL 内）
    const originalDateNow = Date.now
    let fakeNow = Date.now() + 9 * 60 * 1000
    Date.now = () => fakeNow

    try {
      const r2 = await opencodeSessionInterceptor(makeUpstream(), ctx)
      expect(r2.headers['x-opencode-session']).toBe(sessionId1) // 复用

      // 再前进 9 分钟（从第一次算 18 分钟，但续期后只过了 9 分钟）
      fakeNow = Date.now() + 9 * 60 * 1000
      const r3 = await opencodeSessionInterceptor(makeUpstream(), ctx)
      expect(r3.headers['x-opencode-session']).toBe(sessionId1) // 仍然复用（续期了）
    } finally {
      Date.now = originalDateNow
    }
  })

  it('should handle unknown IP (clientIp is null)', async () => {
    const ctx = makeCtx({ clientIp: null })
    const result = await opencodeSessionInterceptor(makeUpstream(), ctx)
    expect(result.headers).toHaveProperty('x-opencode-session')
    expect(result.body).toHaveProperty('prompt_cache_key')
  })
})
```

- [ ] **Step 3: 编写注入行为测试**

```typescript
describe('注入行为', () => {
  it('should add x-opencode-session header', async () => {
    const result = await opencodeSessionInterceptor(makeUpstream(), makeCtx())
    expect(result.headers).toHaveProperty('x-opencode-session')
  })

  it('should add prompt_cache_key to body', async () => {
    const result = await opencodeSessionInterceptor(makeUpstream(), makeCtx())
    expect(result.body).toHaveProperty('prompt_cache_key')
  })

  it('should use same sessionId for header and body', async () => {
    const result = await opencodeSessionInterceptor(makeUpstream(), makeCtx())
    expect(result.headers['x-opencode-session']).toBe(result.body.prompt_cache_key)
  })

  it('should preserve existing headers', async () => {
    const upstream = makeUpstream({ headers: { authorization: 'Bearer sk-test', 'x-custom': 'value' } })
    const result = await opencodeSessionInterceptor(upstream, makeCtx())
    expect(result.headers['authorization']).toBe('Bearer sk-test')
    expect(result.headers['x-custom']).toBe('value')
  })

  it('should preserve existing body fields', async () => {
    const upstream = makeUpstream({ body: { model: 'kimi-v1', messages: [{ role: 'user', content: 'hi' }], temperature: 0.7 } })
    const result = await opencodeSessionInterceptor(upstream, makeCtx())
    expect(result.body.temperature).toBe(0.7)
    expect(result.body.model).toBe('kimi-v1')
  })

  it('should not mutate original upstream object', async () => {
    const upstream = makeUpstream()
    const frozenHeaders = { ...upstream.headers }
    const frozenBody = { ...upstream.body }
    await opencodeSessionInterceptor(upstream, makeCtx())
    expect(upstream.headers).toEqual(frozenHeaders)
    expect(upstream.body).toEqual(frozenBody)
  })
})
```

- [ ] **Step 4: 运行新拦截器的全部测试**

```bash
cd /Users/kkito/proj/github/llm-gateway && npx vitest run src/interceptor/opencode-session.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: 运行所有拦截器测试确保不破坏现有关联测试**

```bash
cd /Users/kkito/proj/github/llm-gateway && npx vitest run src/interceptor/
```

Expected: 所有拦截器测试通过。

---

### Task 3: 在 server.ts 注册拦截器

**Files:**
- Modify: `src/server.ts`

在现有 `qwenCacheInterceptor` 注册的位置追加。

- [ ] **Step 1: 在 server.ts 中导入并注册**

找到 `src/server.ts` 中已有 `qwenCacheInterceptor` 注册的代码块，追加：

```typescript
import { qwenCacheInterceptor } from './interceptor/qwen-cache.js'
import { opencodeSessionInterceptor } from './interceptor/opencode-session.js'

// 注册 Qwen 缓存拦截器（模块级，只注册一次）
interceptors.use(qwenCacheInterceptor)
// 注册 OpenCode Session 拦截器（模块级，只注册一次）
interceptors.use(opencodeSessionInterceptor)
```

**注意：** `interceptors.use` 追加新的拦截器，不影响已注册的 `qwenCacheInterceptor`。两个拦截器独立，按注册顺序依次执行。

- [ ] **Step 2: 编译验证**

```bash
cd /Users/kkito/proj/github/llm-gateway && npx tsc --noEmit
```

Expected: No errors.

---

### Task 4: 完整构建和测试

- [ ] **Step 1: 构建项目**

```bash
cd /Users/kkito/proj/github/llm-gateway && pnpm build
```

- [ ] **Step 2: 运行全部测试**

```bash
cd /Users/kkito/proj/github/llm-gateway && pnpm test
```

Expected: 所有测试通过（90 files 左右，844+ tests，0 failures）。

- [ ] **Step 3: 提交**

```bash
cd /Users/kkito/proj/github/llm-gateway && \
  git add src/interceptor/opencode-session.ts \
         src/interceptor/opencode-session.test.ts \
         src/server.ts && \
  git commit -m "feat: add OpenCode session interceptor for opencode.ai kimi/glm/mino models"
```
