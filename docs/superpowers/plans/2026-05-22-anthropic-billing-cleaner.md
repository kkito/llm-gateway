# Anthropic Billing Cleaner 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个拦截器清理 Claude Code 注入的 `x-anthropic-billing-header` 前缀，注册在拦截器链最前面。

**Architecture:** 遵循现有 `UpstreamInterceptor` 模式，新增纯函数 + 拦截器入口，在 `server.ts` 注册到 `interceptors.use()` 的第一位。

**Tech Stack:** TypeScript, Vitest

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/interceptor/anthropic-billing-cleaner.ts` | 新增 | 导出 `BILLING_HEADER_RE` 正则、`cleanBillingHeader()` 辅助函数和 `anthropicBillingCleaner` 拦截器 |
| `src/interceptor/anthropic-billing-cleaner.test.ts` | 新增 | 测试正则、辅助函数、拦截器全链路 |
| `src/server.ts` | 修改 (2行) | 导入并注册拦截器，放在第一位，带显式注释 |

---

### Task 1: 写测试（TDD 第一步）

**Files:**
- Create: `src/interceptor/anthropic-billing-cleaner.test.ts`

- [ ] **Step 1: 写测试文件**

```typescript
import { describe, it, expect } from 'vitest'
import { anthropicBillingCleaner } from './anthropic-billing-cleaner.js'
import type { UpstreamRequest } from '../routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from './types.js'

function makeUpstream(overrides?: Partial<UpstreamRequest>): UpstreamRequest {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: { authorization: 'Bearer sk-test', 'content-type': 'application/json' },
    body: { model: 'claude-sonnet-4-20250514', messages: [] },
    ...overrides,
  }
}

function makeCtx(overrides?: Partial<UpstreamInterceptorContext>): UpstreamInterceptorContext {
  return {
    provider: {
      customModel: 'my-claude',
      realModel: 'claude-sonnet-4-20250514',
      apiKey: 'sk-test',
      baseUrl: 'https://api.anthropic.com',
      provider: 'anthropic',
    },
    c: {} as any,
    currentUser: null,
    clientIp: '192.168.1.1',
    requestId: 'test-001',
    customModel: 'my-claude',
    stream: false,
    ...overrides,
  }
}

// ============ 非触发条件（直接跳过） ============

describe('anthropicBillingCleaner - 触发条件', () => {
  it('should skip when provider is not anthropic', async () => {
    const upstream = makeUpstream()
    const ctx = makeCtx({ provider: { ...makeCtx().provider, provider: 'openai' } as any })
    const result = await anthropicBillingCleaner(upstream, ctx)
    expect(result).toBe(upstream)
  })

  it('should skip when body has no messages', async () => {
    const upstream = makeUpstream({ body: { model: 'claude-sonnet-4-20250514' } })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    expect(result).toBe(upstream)
  })

  it('should skip when messages is empty array', async () => {
    const upstream = makeUpstream({ body: { model: 'claude-sonnet-4-20250514', messages: [] } })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    expect(result).toBe(upstream)
  })

  it('should skip when messages has no system role', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    expect(result).toBe(upstream)
  })
})

// ============ content 是字符串 ============

describe('anthropicBillingCleaner - string content', () => {
  it('should remove billing header from system string content', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: 'x-anthropic-billing-header: cc_version=2.1.145.b73; cc_entrypoint=claude-vscode; cch=a8c1e;你是Claude，Anthropic开发的AI助手。',
          },
          { role: 'user', content: 'hi' },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const systemMsg = result.body.messages[0]
    expect(systemMsg.content).toBe('你是Claude，Anthropic开发的AI助手。')
  })

  it('should handle billing header with slightly different values', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: 'x-anthropic-billing-header: cc_version=2.2.0.b1; cc_entrypoint=claude-code; cch=x9z2k;你是Claude。',
          },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const systemMsg = result.body.messages[0]
    expect(systemMsg.content).toBe('你是Claude。')
  })

  it('should handle case-insensitive billing header', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: 'X-ANTHROPIC-BILLING-HEADER: CC_VERSION=2.1.0; CC_ENTRYPOINT=CLAUDE-VSCODE; CCH=A1B2C;Hello.',
          },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const systemMsg = result.body.messages[0]
    expect(systemMsg.content).toBe('Hello.')
  })

  it('should handle billing header without trailing semicolon on cch', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=a8c1e你好。',
          },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const systemMsg = result.body.messages[0]
    expect(systemMsg.content).toBe('你好。')
  })

  it('should return upstream unchanged when system string has no billing header', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'system', content: '你是Claude。' },
          { role: 'user', content: 'hi' },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    expect(result).toBe(upstream)
  })
})

// ============ content 是数组 ============

describe('anthropicBillingCleaner - array content', () => {
  it('should remove billing header from text block in array content', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: [
              { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.145.b73; cc_entrypoint=claude-vscode; cch=a8c1e;你是Claude。' },
            ],
          },
          { role: 'user', content: 'hi' },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const systemContent = result.body.messages[0].content
    expect(systemContent[0].text).toBe('你是Claude。')
  })

  it('should handle array with multiple blocks, only first has billing header', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: [
              { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=a8c1e;第一部分。' },
              { type: 'text', text: '第二部分。' },
            ],
          },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const content = result.body.messages[0].content
    expect(content[0].text).toBe('第一部分。')
    expect(content[1].text).toBe('第二部分。')
  })

  it('should not modify array content without billing header', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: [
              { type: 'text', text: '正常system内容。' },
            ],
          },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    // 没有匹配到，应返回原对象
    expect(result).toBe(upstream)
  })
})

// ============ 不可变性 ============

describe('anthropicBillingCleaner - immutability', () => {
  it('should not mutate original upstream object', async () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      messages: [
        {
          role: 'system',
          content: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=a8c1e;原始内容。',
        },
      ],
    }
    const originalBody = JSON.parse(JSON.stringify(body))
    const upstream = makeUpstream({ body })
    await anthropicBillingCleaner(upstream, makeCtx())
    expect(upstream.body).toEqual(originalBody)
  })
})
```

- [ ] **Step 2: 运行测试确保失败**

Run: `npx vitest run src/interceptor/anthropic-billing-cleaner.test.ts`
Expected: FAIL — `anthropicBillingCleaner` not exported

---

### Task 2: 实现拦截器

**Files:**
- Create: `src/interceptor/anthropic-billing-cleaner.ts`

- [ ] **Step 1: 写实现代码**

```typescript
import type { UpstreamInterceptor } from './types.js'

/**
 * 匹配 Claude Code 注入的 x-anthropic-billing-header 前缀的正则。
 *
 * 格式：x-anthropic-billing-header: cc_version=xxx; cc_entrypoint=xxx; cch=xxx;正文
 * 或：  x-anthropic-billing-header: cc_version=xxx; cc_entrypoint=xxx; cch=xxx正文
 *
 * - i 标志：大小写不敏感
 * - cch= 后面的 ;? 可选（处理最后无分号的情况）
 */
export const BILLING_HEADER_RE = /^x-anthropic-billing-header:\s*cc_version=[^;]+;\s*cc_entrypoint=[^;]+;\s*cch=[^;]+;?\s*/i

/**
 * 清理字符串中的 billing header 前缀。
 * 如果字符串以 billing header 开头，去除后返回剩余部分。
 * 否则返回 undefined。
 */
export function cleanBillingHeader(text: string): string | undefined {
  const match = text.match(BILLING_HEADER_RE)
  if (!match) return undefined
  return text.slice(match[0].length)
}

/**
 * 判断是否需要拦截（provider 是 anthropic 且 body 有非空 messages）。
 */
function shouldIntercept(ctx: { provider: { provider: string } }, body: any): boolean {
  if (ctx.provider.provider !== 'anthropic') return false
  if (!body?.messages || !Array.isArray(body.messages) || body.messages.length === 0) return false
  return true
}

/**
 * Anthropic Billing Header 清理拦截器。
 *
 * 当 provider 为 anthropic 时，遍历 messages 中 role 为 "system" 的消息，
 * 检查其 content 是否包含 billing header 前缀。
 * 若包含，去除此前缀并返回新对象。
 *
 * 必须注册为第一个拦截器，优先执行。
 */
export const anthropicBillingCleaner: UpstreamInterceptor = async (upstream, ctx) => {
  if (!shouldIntercept(ctx, upstream.body)) return upstream

  const body = upstream.body
  let hasChanges = false

  const newMessages = body.messages.map((msg: any) => {
    if (msg.role !== 'system') return msg
    if (!msg.content) return msg

    let newContent: any

    if (typeof msg.content === 'string') {
      const cleaned = cleanBillingHeader(msg.content)
      if (cleaned !== undefined) {
        hasChanges = true
        newContent = cleaned
      }
    } else if (Array.isArray(msg.content)) {
      const newBlocks = msg.content.map((block: any) => {
        if (block.type === 'text' && typeof block.text === 'string') {
          const cleaned = cleanBillingHeader(block.text)
          if (cleaned !== undefined) {
            hasChanges = true
            return { ...block, text: cleaned }
          }
        }
        return block
      })
      if (newBlocks !== msg.content) {
        newContent = newBlocks
      }
    }

    if (newContent !== undefined) {
      return { ...msg, content: newContent }
    }
    return msg
  })

  if (!hasChanges) return upstream

  return {
    ...upstream,
    body: { ...body, messages: newMessages },
  }
}
```

- [ ] **Step 2: 运行测试确保通过**

Run: `npx vitest run src/interceptor/anthropic-billing-cleaner.test.ts`
Expected: PASS (all tests)

---

### Task 3: 注册拦截器到 server.ts

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: 添加 import 和注册**

在 `src/server.ts` 中找到以下代码（约 40-45 行）：

```typescript
import { interceptors } from './interceptor/index.js'
import { qwenCacheInterceptor } from './interceptor/qwen-cache.js'
import { opencodeSessionInterceptor } from './interceptor/opencode-session.js'

// 注册 Qwen 缓存拦截器（模块级，只注册一次）
interceptors.use(qwenCacheInterceptor)
// 注册 OpenCode Session 拦截器（模块级，只注册一次）
interceptors.use(opencodeSessionInterceptor)
```

修改为：

```typescript
import { interceptors } from './interceptor/index.js'
import { anthropicBillingCleaner } from './interceptor/anthropic-billing-cleaner.js'
import { qwenCacheInterceptor } from './interceptor/qwen-cache.js'
import { opencodeSessionInterceptor } from './interceptor/opencode-session.js'

// !!! 必须放在第一个执行：在所有其他拦截器之前清理 Anthropic billing header
interceptors.use(anthropicBillingCleaner)
// 注册 Qwen 缓存拦截器（模块级，只注册一次）
interceptors.use(qwenCacheInterceptor)
// 注册 OpenCode Session 拦截器（模块级，只注册一次）
interceptors.use(opencodeSessionInterceptor)
```

- [ ] **Step 2: 验证构建和测试通过**

Run: `pnpm build`
Expected: 编译成功

Run: `pnpm test`
Expected: 所有测试通过
