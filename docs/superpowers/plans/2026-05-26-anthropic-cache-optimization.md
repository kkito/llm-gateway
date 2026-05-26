# Anthropic Cache Optimization — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 claude-code-cache-fix 的 P0/P1 缓存优化功能移植到 llm-gateway 的 UpstreamInterceptor 框架中，采用 TDD 流程开发。

**Architecture:** 新增 `helpers.ts`、`claude-code-cache.ts`、`cache-control-normalize.ts`、`ttl-management.ts` 四个源文件，对应四个测试文件，测试统一放在 `tests/interceptor/`。已有 4 个测试文件从 `src/interceptor/` 迁移到 `tests/interceptor/`。

**Tech Stack:** Node.js/TypeScript (ESM), Vitest, Hono

---

## 项目文件结构

### 新增源文件

| 文件 | 职责 |
|------|------|
| `src/interceptor/helpers.ts` | `isAnthropicV1Messages()` — URL 守卫工具函数 |
| `src/interceptor/claude-code-cache.ts` | CC 专用优化，合并 4 个子步骤：smoosh-split → sort-stabilization → fresh-session-sort → content-strip |
| `src/interceptor/cache-control-normalize.ts` | 通用 cache_control 规范化：去用户消息散落标记 → 末位追加 canonical 标记 |
| `src/interceptor/ttl-management.ts` | 通用 TTL 注入：检��请求类型 → 给 ephemeral 但无 ttl 的块注入 ttl |

### 新增测试文件

| 文件 | 职责 |
|------|------|
| `tests/interceptor/helpers.test.ts` | `isAnthropicV1Messages` 测试 |
| `tests/interceptor/claude-code-cache.test.ts` | CC 4 个子步骤 TDD 测试 |
| `tests/interceptor/cache-control-normalize.test.ts` | cache_control 规范化测试 |
| `tests/interceptor/ttl-management.test.ts` | TTL 注入测试 |
| `tests/interceptor/index.test.ts` | 从 `src/interceptor/index.test.ts` 迁移，新增顺序验证 |

### 迁移的测试文件

| 原路径 | 目标路径 |
|--------|----------|
| `src/interceptor/anthropic-billing-cleaner.test.ts` | `tests/interceptor/anthropic-billing-cleaner.test.ts` |
| `src/interceptor/index.test.ts` | `tests/interceptor/index.test.ts` |
| `src/interceptor/opencode-session.test.ts` | `tests/interceptor/opencode-session.test.ts` |
| `src/interceptor/qwen-cache.test.ts` | `tests/interceptor/qwen-cache.test.ts` |

### 修改的现有文件

| 文件 | 变更 |
|------|------|
| `src/interceptor/anthropic-billing-cleaner.ts` | 在 `shouldIntercept()` 中追加 `isAnthropicV1Messages(upstream.url)` 守卫 |
| `src/server.ts` | 注册新拦截器，调整注册顺序 |
| `AGENT.md` | 更新测试目录说明、拦截器列表和注册顺序 |

### 测试共享辅助函数（用于所有新测试）

每个测试文件都使用匿名 `makeUpstream` 和 `makeCtx` 辅助函数（见 `anthropic-billing-cleaner.test.ts` 模式），不共享——保持测试文件独立可读。但注意 import 路径要使用 `@/interceptor/xxx` 别名或相对路径指向 `../../../src/interceptor/xxx`。

关键：测试需要导入的类型：
```typescript
import type { UpstreamRequest } from '../../../src/routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from '../../../src/interceptor/types.js'
```

mockCtx 中的 `c` 字段：`{} as any`（与现有测试一致）

---

### Task 1: 创建 `helpers.ts` + `helpers.test.ts`（URL 守卫工具）

**Files:**
- Create: `src/interceptor/helpers.ts`
- Test: `tests/interceptor/helpers.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/interceptor/helpers.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { isAnthropicV1Messages } from '../../../src/interceptor/helpers.js'

describe('isAnthropicV1Messages', () => {
  it('should return true for /v1/messages URL', () => {
    expect(isAnthropicV1Messages('https://api.anthropic.com/v1/messages')).toBe(true)
  })

  it('should return true for /v1/messages URL with trailing slash', () => {
    expect(isAnthropicV1Messages('https://api.anthropic.com/v1/messages/')).toBe(true)
  })

  it('should return true for /v1/messages URL with query params', () => {
    expect(isAnthropicV1Messages('https://api.anthropic.com/v1/messages?model=claude')).toBe(true)
  })

  it('should return false for /v1/chat/completions URL', () => {
    expect(isAnthropicV1Messages('https://api.openai.com/v1/chat/completions')).toBe(false)
  })

  it('should return false for unrelated URL', () => {
    expect(isAnthropicV1Messages('https://api.example.com/v1/other')).toBe(false)
  })

  it('should handle edge case of empty string', () => {
    expect(isAnthropicV1Messages('')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/interceptor/helpers.test.ts
```
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Write minimal implementation**

`src/interceptor/helpers.ts`:
```typescript
/**
 * 判断 upstream URL 是否为 Anthropic /v1/messages 端点。
 * Anthropic 格式的请求体才有 system/messages 结构，才能应用 cache 优化。
 */
export function isAnthropicV1Messages(url: string): boolean {
  return url.includes('/v1/messages')
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/interceptor/helpers.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/interceptor/helpers.ts tests/interceptor/helpers.test.ts
git commit -m "feat: add isAnthropicV1Messages URL guard helper"
```

---

### Task 2: 处理 `anthropic-billing-cleaner` 的 URL 守卫 + 迁移测试文件

**Files:**
- Modify: `src/interceptor/anthropic-billing-cleaner.ts`
- Move: `src/interceptor/anthropic-billing-cleaner.test.ts` → `tests/interceptor/anthropic-billing-cleaner.test.ts`

- [ ] **Step 1: Write the failing test (URL 守卫)**

先创建迁移后的测试文件，在原有测试基础上追加 URL 守卫用例：

`tests/interceptor/anthropic-billing-cleaner.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { anthropicBillingCleaner, cleanBillingHeader } from '../../../src/interceptor/anthropic-billing-cleaner.js'
import type { UpstreamRequest } from '../../../src/routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from '../../../src/interceptor/types.js'

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

// ============ URL 守卫 ============

describe('anthropicBillingCleaner - URL 守卫', () => {
  it('should skip when URL is not /v1/messages', async () => {
    const upstream = makeUpstream({ url: 'https://api.openai.com/v1/chat/completions' })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    expect(result).toBe(upstream)
  })

  it('should work when URL is /v1/messages', async () => {
    const upstream = makeUpstream({
      url: 'https://api.anthropic.com/v1/messages',
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'system', content: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;正常内容。' },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const systemMsg = result.body.messages[0]
    expect(systemMsg.content).toBe('正常内容。')
  })
})

// ============ 非触发条件（直接跳过） ============

describe('anthropicBillingCleaner - 触发条件', () => {
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

  it('should work regardless of provider type', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'system', content: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;正常内容。' },
        ],
      },
    })
    const ctx = makeCtx({ provider: { ...makeCtx().provider, provider: 'custom' } as any })
    const result = await anthropicBillingCleaner(upstream, ctx)
    const systemMsg = result.body.messages[0]
    expect(systemMsg.content).toBe('正常内容。')
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

  it('should handle cch value with spaces (e.g., "e0    bf8")', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: 'x-anthropic-billing-header: cc_version=2.1.145.b73; cc_entrypoint=claude-vscode; cch=e0    bf8; You are Claude Code.',
          },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const systemMsg = result.body.messages[0]
    expect(systemMsg.content).toBe('You are Claude Code.')
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

  it('should handle multiple system messages, only first has billing header', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'system', content: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;第一条system。' },
          { role: 'system', content: '第二条system，无billing header。' },
          { role: 'user', content: 'hi' },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const msgs = result.body.messages
    expect(msgs[0].content).toBe('第一条system。')
    expect(msgs[1].content).toBe('第二条system，无billing header。')
  })

  it('should handle system message at end of messages array', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'system', content: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;末尾system。' },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const systemMsg = result.body.messages[1]
    expect(systemMsg.content).toBe('末尾system。')
  })

  it('should handle cch value containing dots and underscores', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=a1.b_c;内容。',
          },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const systemMsg = result.body.messages[0]
    expect(systemMsg.content).toBe('内容。')
  })
})

// ============ 错误处理 ============

describe('anthropicBillingCleaner - error handling', () => {
  it('should throw when text starts with billing header but has unrecognized format', () => {
    expect(() => cleanBillingHeader(
      'x-anthropic-billing-header: cc_ver=2.1.0; cc_entrypoint=claude-vscode; cch=abc;hello'
    )).toThrow('Unrecognized anthropic billing header format')

    expect(() => cleanBillingHeader(
      'x-anthropic-billing-header: cc_version=2.1.0; cch=abc;hello'
    )).toThrow('Unrecognized anthropic billing header format')
  })

  it('should throw from interceptor when header format is unrecognized', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: 'x-anthropic-billing-header: cc_ver=2.1.0; cc_entrypoint=claude-vscode; cch=abc;hello',
          },
        ],
      },
    })
    await expect(anthropicBillingCleaner(upstream, makeCtx())).rejects.toThrow(
      'Unrecognized anthropic billing header format'
    )
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
    expect(result).toBe(upstream)
  })

  it('should handle array content where billing header is not in first block', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: [
              { type: 'text', text: '开头正常内容。' },
              { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;后面的块有billing header。' },
            ],
          },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const content = result.body.messages[0].content
    expect(content[0].text).toBe('开头正常内容。')
    expect(content[1].text).toBe('后面的块有billing header。')
  })

  it('should skip non-text blocks in array content', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: [
              { type: 'image', source: { type: 'base64', data: 'abc' } },
              { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;正文。' },
            ],
          },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const content = result.body.messages[0].content
    expect(content[0].type).toBe('image')
    expect(content[1].text).toBe('正文。')
  })

  it('should handle multiple system messages with array content', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: [
              { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;第一条system。' },
            ],
          },
          {
            role: 'system',
            content: [
              { type: 'text', text: '第二条system无billing header。' },
            ],
          },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    expect(result.body.messages[0].content[0].text).toBe('第一条system。')
    expect(result.body.messages[1].content[0].text).toBe('第二条system无billing header。')
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

- [ ] **Step 2: 验证旧测试文件已删除（确认文件移动成功）**

```bash
# 旧文件应被删除或移动
ls -la src/interceptor/anthropic-billing-cleaner.test.ts 2>&1 || echo "old test removed"
```

- [ ] **Step 3: 在 `anthropic-billing-cleaner.ts` 中添加 URL 守卫**

修改 `src/interceptor/anthropic-billing-cleaner.ts`，在 `shouldIntercept` 中追加 URL 检查：

```typescript
import { isAnthropicV1Messages } from './helpers.js'
```

修改 `shouldIntercept` 函数：
```typescript
function shouldIntercept(upstream: UpstreamRequest): boolean {
  if (!isAnthropicV1Messages(upstream.url)) return false
  if (!upstream.body?.messages || !Array.isArray(upstream.body.messages) || upstream.body.messages.length === 0) return false
  return true
}
```

以及修改 `anthropicBillingCleaner` 的调用方式——`shouldIntercept` 现在需要接收 upstream（因为它需要访问 `upstream.url`）：
```typescript
export const anthropicBillingCleaner: UpstreamInterceptor = async (upstream, ctx) => {
  if (!shouldIntercept(upstream)) return upstream
  // ... 其余不变
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/interceptor/anthropic-billing-cleaner.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/interceptor/anthropic-billing-cleaner.ts tests/interceptor/anthropic-billing-cleaner.test.ts
git rm src/interceptor/anthropic-billing-cleaner.test.ts
git commit -m "feat: add URL guard to anthropic-billing-cleaner, migrate test to tests/interceptor/"
```

---

### Task 3: 测试文件迁移（index.test.ts, opencode-session.test.ts, qwen-cache.test.ts）

**Files:**
- Move: `src/interceptor/index.test.ts` → `tests/interceptor/index.test.ts`
- Move: `src/interceptor/opencode-session.test.ts` → `tests/interceptor/opencode-session.test.ts`
- Move: `src/interceptor/qwen-cache.test.ts` → `tests/interceptor/qwen-cache.test.ts`

- [ ] **Step 1: 复制并修改 import 路径**

为每个迁移的测试文件执行：
1. 从 `src/interceptor/xxx.test.ts` 复制到 `tests/interceptor/xxx.test.ts`
2. 将 `from './xxx'` 改为 `from '../../../src/interceptor/xxx.js'`
3. 类似地更新其他相对路径引用

`tests/interceptor/index.test.ts` — 原有内容保留，import 路径改为：
```typescript
import { InterceptorManager } from '../../../src/interceptor/index.js'
import type { UpstreamRequest } from '../../../src/routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from '../../../src/interceptor/types.js'
```

`tests/interceptor/opencode-session.test.ts` — import 路径改为：
```typescript
import { opencodeSessionInterceptor } from '../../../src/interceptor/opencode-session.js'
// ... 其他类型 import 类似调整
```

`tests/interceptor/qwen-cache.test.ts` — import 路径改为：
```typescript
import { qwenCacheInterceptor } from '../../../src/interceptor/qwen-cache.js'
// ... 其他类型 import 类似调整
```

- [ ] **Step 2: 删除旧测试文件并用 git rm**

```bash
git rm src/interceptor/index.test.ts
git rm src/interceptor/opencode-session.test.ts
git rm src/interceptor/qwen-cache.test.ts
```

- [ ] **Step 3: Run all tests to verify migration**

```bash
npx vitest run tests/interceptor/
```
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add tests/interceptor/
git commit -m "refactor: migrate interceptor tests to tests/interceptor/ directory"
```

---

### Task 4: TDD — 实现 `claude-code-cache` 拦截器

**Files:**
- Create: `src/interceptor/claude-code-cache.ts`
- Test: `tests/interceptor/claude-code-cache.test.ts`

#### 子步骤 4a: smoosh-split（剥离尾部粘附的 system-reminder）

- [ ] **Step 1: Write the failing test**

`tests/interceptor/claude-code-cache.test.ts`（追加到文件）：
```typescript
import { describe, it, expect } from 'vitest'
import { claudeCodeCacheInterceptor } from '../../../src/interceptor/claude-code-cache.js'
import type { UpstreamRequest } from '../../../src/routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from '../../../src/interceptor/types.js'

function makeUpstream(overrides?: Partial<UpstreamRequest>): UpstreamRequest {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: { authorization: 'Bearer sk-test', 'content-type': 'application/json' },
    body: {
      model: 'claude-sonnet-4-20250514',
      system: [{ type: 'text', text: '你是Claude。' }],
      messages: [],
    },
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

// ============ URL 守卫 ============

describe('claudeCodeCache - URL 守卫', () => {
  it('should skip when URL is not /v1/messages', async () => {
    const upstream = makeUpstream({ url: 'https://api.openai.com/v1/chat/completions' })
    const result = await claudeCodeCacheInterceptor(upstream, makeCtx())
    expect(result).toBe(upstream)
  })
})

// ============ smoosh-split ============

describe('claudeCodeCache - smoosh-split', () => {
  it('should peel trailing system-reminder from tool_result.content', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: '你是Claude。' }],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                content: '命令执行成功。\n\n<system-reminder>\nContinue from where you left off.\n</system-reminder>',
              },
            ],
          },
        ],
      },
    })
    const result = await claudeCodeCacheInterceptor(upstream, makeCtx())
    const content = result.body.messages[0].content
    // tool_result 剥离了尾部，只保留正文
    expect(content[0].content).toBe('命令执行成功。')
    // 剥离的 reminder 成为独立 text block 追加
    expect(content[1].type).toBe('text')
    expect(content[1].text).toContain('Continue from where you left off')
  })

  it('should skip when no smooshed reminder is found', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: '你是Claude。' }],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'tool_result', content: '命令执行成功。' },
            ],
          },
        ],
      },
    })
    const result = await claudeCodeCacheInterceptor(upstream, makeCtx())
    // 没有变化
    expect(result).toBe(upstream)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/interceptor/claude-code-cache.test.ts
```
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Write minimal implementation (smoosh-split part)**

`src/interceptor/claude-code-cache.ts`（初始版，只实现 smoosh-split + URL 守卫）：
```typescript
import { isAnthropicV1Messages } from './helpers.js'
import type { UpstreamInterceptor } from './types.js'

/** 匹配 tool_result.content 尾部粘附的 <system-reminder> 块 */
const TRAILING_SMOOSH = /\n\n(<system-reminder>\n(?:(?!<\/system-reminder>)[\s\S])*?\n<\/system-reminder>)\s*$/

function splitSmooshedReminders(messages: any[]): { messages: any[]; changed: boolean } {
  let changed = false
  const result = messages.map((msg) => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg
    const out: any[] = []
    const peeledReminders: any[] = []

    for (const block of msg.content) {
      if (block?.type === 'tool_result' && typeof block.content === 'string') {
        const m = block.content.match(TRAILING_SMOOSH)
        if (m) {
          const cleanedContent = block.content.slice(0, m.index)
          out.push({ ...block, content: cleanedContent })
          peeledReminders.push({ type: 'text', text: m[1] })
          changed = true
          continue
        }
      }
      out.push(block)
    }

    if (peeledReminders.length > 0) {
      return { ...msg, content: [...out, ...peeledReminders] }
    }
    return msg
  })

  return { messages: result, changed }
}

export const claudeCodeCacheInterceptor: UpstreamInterceptor = async (upstream, ctx) => {
  if (!isAnthropicV1Messages(upstream.url)) return upstream
  if (!upstream.body?.messages) return upstream

  let body = upstream.body
  let hasChanges = false

  // Step 1: smoosh-split
  const splitResult = splitSmooshedReminders(body.messages)
  if (splitResult.changed) {
    body = { ...body, messages: splitResult.messages }
    hasChanges = true
  }

  if (!hasChanges) return upstream
  return { ...upstream, body }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/interceptor/claude-code-cache.test.ts
```
Expected: PASS

#### 子步骤 4b: sort-stabilization

- [ ] **Step 5: Write the failing test**

在 `tests/interceptor/claude-code-cache.test.ts` 追加：
```typescript
// ============ sort-stabilization ============

describe('claudeCodeCache - sort-stabilization', () => {
  it('should sort skills block entries alphabetically', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [
          {
            type: 'text',
            text: '<system-reminder>\nThe following skills are available:\n\n- Zoo\n- Alpha\n- Charlie\n</system-reminder>',
          },
        ],
        messages: [
          { role: 'user', content: 'hello' },
        ],
      },
    })
    const result = await claudeCodeCacheInterceptor(upstream, makeCtx())
    const systemText = result.body.system[0].text
    // entry 应该按字母序排列
    expect(systemText).toContain('- Alpha')
    expect(systemText).toContain('- Charlie')
    expect(systemText).toContain('- Zoo')
    // Alpha 应该在 Charlie 之前
    const alphaIdx = systemText.indexOf('- Alpha')
    const charlieIdx = systemText.indexOf('- Charlie')
    const zooIdx = systemText.indexOf('- Zoo')
    expect(alphaIdx).toBeLessThan(charlieIdx)
    expect(charlieIdx).toBeLessThan(zooIdx)
  })

  it('should sort deferred tools block entries alphabetically', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [
          {
            type: 'text',
            text: '<system-reminder>\nThe following deferred tools are now available:\n\nRead\nAnalyze\nWrite\n</system-reminder>',
          },
        ],
        messages: [
          { role: 'user', content: 'hello' },
        ],
      },
    })
    const result = await claudeCodeCacheInterceptor(upstream, makeCtx())
    const systemText = result.body.system[0].text
    expect(systemText).toContain('Analyze')
    expect(systemText).toContain('Read')
    expect(systemText).toContain('Write')
    const analyzeIdx = systemText.indexOf('Analyze')
    const readIdx = systemText.indexOf('Read')
    const writeIdx = systemText.indexOf('Write')
    expect(analyzeIdx).toBeLessThan(readIdx)
    expect(readIdx).toBeLessThan(writeIdx)
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

```bash
npx vitest run tests/interceptor/claude-code-cache.test.ts
```
Expected: FAIL — sort-stabilization 尚未实现

- [ ] **Step 7: Add sort-stabilization implementation**

追加排序函数到 `src/interceptor/claude-code-cache.ts`：
```typescript
function sortSkillsBlock(text: string): string {
  const match = text.match(/^([\s\S]*?\n\n)(- [\s\S]+?)(\n<\/system-reminder>\s*)$/)
  if (!match) return text
  const [, header, entriesText, footer] = match
  const entries = entriesText.split(/\n(?=- )/)
  entries.sort()
  return header + entries.join('\n') + footer
}

function sortDeferredToolsBlock(text: string): string {
  const match = text.match(
    /^(<system-reminder>\nThe following deferred tools are now available[^\n]*\n)([\s\S]+?)(\n<\/system-reminder>\s*)$/
  )
  if (!match) return text
  const [, header, toolsList, footer] = match
  const tools = toolsList.split('\n').map((t) => t.trim()).filter(Boolean)
  tools.sort()
  return header + tools.join('\n') + footer
}

function isSkillsBlock(text: string): boolean {
  return typeof text === 'string' && text.includes('skills are available')
}

function isDeferredToolsBlock(text: string): boolean {
  return typeof text === 'string' && text.includes('deferred tools are now available')
}
```

在 `claudeCodeCacheInterceptor` 函数的 Step 1 之后新增 Step 2：
```typescript
  // Step 2: sort-stabilization
  if (Array.isArray(body.system)) {
    const newSystem = body.system.map((block: any) => {
      if (block.type !== 'text' || typeof block.text !== 'string') return block
      let text = block.text
      if (isSkillsBlock(text)) {
        const sorted = sortSkillsBlock(text)
        if (sorted !== text) { text = sorted; hasChanges = true }
      }
      if (isDeferredToolsBlock(text)) {
        const sorted = sortDeferredToolsBlock(text)
        if (sorted !== text) { text = sorted; hasChanges = true }
      }
      return text !== block.text ? { ...block, text } : block
    })
    if (hasChanges) body = { ...body, system: newSystem }
  }
```

- [ ] **Step 8: Run test to verify it passes**

```bash
npx vitest run tests/interceptor/claude-code-cache.test.ts
```
Expected: PASS

#### 子步骤 4c: fresh-session-sort

- [ ] **Step 9: Write the failing test**

在 `tests/interceptor/claude-code-cache.test.ts` 追加：
```typescript
// ============ fresh-session-sort ============

describe('claudeCodeCache - fresh-session-sort', () => {
  it('should relocate scattered blocks to first user message', async () => {
    const skillsBlock = '<system-reminder>\nThe following skills are available:\n\n- Alpha\n- Beta\n</system-reminder>'
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: '你是Claude。' }],
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: '你好！' },
          { role: 'user', content: [{ type: 'text', text: skillsBlock }, { type: 'text', text: '继续' }] },
        ],
      },
    })
    const result = await claudeCodeCacheInterceptor(upstream, makeCtx())
    const firstMsgContent = result.body.messages[0].content
    // skills block 被移到了第一个 user message 的开头
    expect(firstMsgContent[0].text).toContain('skills are available')
    // 第二个 user message 不再包含该 block
    const secondMsgText = result.body.messages[2].content.map((b: any) => b.text).join('')
    expect(secondMsgText).not.toContain('skills are available')
    expect(secondMsgText).toBe('继续')
  })

  it('should strip /clear artifacts from first user message', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: '你是Claude。' }],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '<local-command-caveat>This is a clear artifact</local-command-caveat>' },
              { type: 'text', text: '正常内容' },
            ],
          },
        ],
      },
    })
    const result = await claudeCodeCacheInterceptor(upstream, makeCtx())
    const content = result.body.messages[0].content
    expect(content.length).toBe(1)
    expect(content[0].text).toBe('正常内容')
  })
})
```

- [ ] **Step 10: Run test to verify it fails**

```bash
npx vitest run tests/interceptor/claude-code-cache.test.ts
```
Expected: FAIL

- [ ] **Step 11: Add fresh-session-sort implementation**

追加检测函数到 `src/interceptor/claude-code-cache.ts`：
```typescript
function isSystemReminder(text: string): boolean {
  return typeof text === 'string' && text.startsWith('<system-reminder>')
}

function isHooksBlock(text: string): boolean {
  return isSystemReminder(text) && text.substring(0, 200).includes('hook success')
}

function isMcpBlock(text: string): boolean {
  return isSystemReminder(text) && text.startsWith('<system-reminder>\n# MCP Server Instructions')
}

function isRelocatableBlock(text: string): boolean {
  return isHooksBlock(text) || isSkillsBlock(text) || isDeferredToolsBlock(text) || isMcpBlock(text)
}

function isClearArtifact(text: string): boolean {
  return (
    text.startsWith('<local-command-caveat>') ||
    text.startsWith('<command-name>') ||
    text.startsWith('<local-command-stdout>')
  )
}

function freshSessionSort(messages: any[]): { messages: any[]; changed: boolean } {
  // Find first user message
  let firstUserIdx = -1
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') { firstUserIdx = i; break }
  }
  if (firstUserIdx === -1) return { messages, changed: false }

  const firstMsg = messages[firstUserIdx]
  if (!Array.isArray(firstMsg?.content)) return { messages, changed: false }

  let changed = false

  // Strip /clear artifacts from first user message
  const filteredFirst = firstMsg.content.filter((b: any) => !isClearArtifact(b.text || ''))
  if (filteredFirst.length !== firstMsg.content.length) changed = true

  // Check for scattered relocatable blocks outside first user message
  const found = new Map<string, any>()
  for (let i = messages.length - 1; i >= firstUserIdx; i--) {
    const msg = messages[i]
    if (msg.role !== 'user' || !Array.isArray(msg.content)) continue
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const block = msg.content[j]
      const text = block.text || ''
      if (text.startsWith('<system-reminder>\nThe following skills are available')) {
        if (!found.has('skills')) { found.set('skills', { ...block }); changed = true }
      } else if (text.startsWith('<system-reminder>\nThe following deferred tools are now available')) {
        if (!found.has('deferred')) { found.set('deferred', { ...block }); changed = true }
      } else if (isHooksBlock(text)) {
        if (!found.has('hooks')) { found.set('hooks', { ...block }); changed = true }
      } else if (isMcpBlock(text)) {
        if (!found.has('mcp')) { found.set('mcp', { ...block }); changed = true }
      }
    }
  }

  if (found.size === 0) {
    if (changed) {
      messages[firstUserIdx] = { ...firstMsg, content: filteredFirst }
      return { messages: [...messages], changed: true }
    }
    return { messages, changed: false }
  }

  // Remove relocatable blocks from all user messages
  const newMessages = messages.map((msg, idx) => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg
    const filtered = msg.content.filter((b: any) => {
      const text = b.text || ''
      return !text.startsWith('<system-reminder>\nThe following skills are available') &&
             !text.startsWith('<system-reminder>\nThe following deferred tools are now available') &&
             !isHooksBlock(text) &&
             !isMcpBlock(text) &&
             !isClearArtifact(text)
    })
    if (filtered.length !== msg.content.length) changed = true
    return { ...msg, content: filtered }
  })

  // Prepend in deterministic order: deferred → mcp → skills → hooks
  const ORDER = ['deferred', 'mcp', 'skills', 'hooks']
  const toRelocate = ORDER.filter((t) => found.has(t)).map((t) => found.get(t))

  newMessages[firstUserIdx] = {
    ...newMessages[firstUserIdx],
    content: [...toRelocate, ...newMessages[firstUserIdx].content],
  }

  return { messages: newMessages, changed: true }
}
```

在 `claudeCodeCacheInterceptor` 中 Step 2 之后新增 Step 3：
```typescript
  // Step 3: fresh-session-sort
  const sortResult = freshSessionSort(body.messages)
  if (sortResult.changed) {
    body = { ...body, messages: sortResult.messages }
    hasChanges = true
  }
```

- [ ] **Step 12: Run test to verify it passes**

```bash
npx vitest run tests/interceptor/claude-code-cache.test.ts
```
Expected: PASS

#### 子步骤 4d: content-strip

- [ ] **Step 13: Write the failing test**

在 `tests/interceptor/claude-code-cache.test.ts` 追加：
```typescript
// ============ content-strip ============

describe('claudeCodeCache - content-strip', () => {
  it('should strip "Continue from where you left off." trailer', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: '你是Claude。' }],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '继续开发' },
              { type: 'text', text: 'Continue from where you left off.' },
            ],
          },
        ],
      },
    })
    const result = await claudeCodeCacheInterceptor(upstream, makeCtx())
    const content = result.body.messages[0].content
    expect(content.length).toBe(1)
    expect(content[0].text).toBe('继续开发')
  })

  it('should strip bookkeeping reminders', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: '你是Claude。' }],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '正常内容' },
              { type: 'text', text: '<system-reminder>\nToken usage: 1000/10000; 9000 remaining\n</system-reminder>' },
            ],
          },
        ],
      },
    })
    const result = await claudeCodeCacheInterceptor(upstream, makeCtx())
    const content = result.body.messages[0].content
    expect(content.length).toBe(1)
    expect(content[0].text).toBe('正常内容')
  })
})
```

- [ ] **Step 14: Run test to verify it fails**

```bash
npx vitest run tests/interceptor/claude-code-cache.test.ts
```
Expected: FAIL

- [ ] **Step 15: Add content-strip implementation**

追加检测函数到 `src/interceptor/claude-code-cache.ts`：
```typescript
const CONTINUE_TRAILER_TEXT = 'Continue from where you left off.'
const REMINDER_WRAP_REGEX = /^<system-reminder>\n([\s\S]*?)\n<\/system-reminder>\s*$/
const BOOKKEEPING_PATTERNS = [
  /^Token usage: \d+\/\d+; \d+ remaining\s*$/,
  /^Output tokens — turn: [^\n]+ · session: [^\n]+\s*$/,
  /^USD budget: \$[\d.]+/\$[\d.]+; \$[\d.]+ remaining\s*$/,
  /^The task tools haven't been used recently\./,
  /^The TodoWrite tool hasn't been used recently\./,
  /^Remaining conversation turns: /,
  /^Messages? until auto-compact: /,
]

function isContinueTrailerBlock(block: any): boolean {
  return block?.type === 'text' && block.text === CONTINUE_TRAILER_TEXT
}

function isBookkeepingReminder(text: string): boolean {
  const m = text.match(REMINDER_WRAP_REGEX)
  if (!m) return false
  return BOOKKEEPING_PATTERNS.some((rx) => rx.test(m[1]))
}

function stripContent(messages: any[]): { messages: any[]; changed: boolean } {
  let changed = false
  const result = messages.map((msg) => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg
    const kept = msg.content.filter((block: any) => {
      if (isContinueTrailerBlock(block)) { changed = true; return false }
      if (block.type === 'text' && isBookkeepingReminder(block.text)) { changed = true; return false }
      return true
    })
    if (kept.length === msg.content.length) return msg
    return { ...msg, content: kept }
  })
  return { messages: result, changed }
}
```

在 `claudeCodeCacheInterceptor` 中 Step 3 之后新增 Step 4：
```typescript
  // Step 4: content-strip
  const stripResult = stripContent(body.messages)
  if (stripResult.changed) {
    body = { ...body, messages: stripResult.messages }
    hasChanges = true
  }
```

- [ ] **Step 16: Run test to verify it passes**

```bash
npx vitest run tests/interceptor/claude-code-cache.test.ts
```
Expected: PASS

#### 子步骤 4e: 不可变性测试

- [ ] **Step 17: Write immutability test**

在 `tests/interceptor/claude-code-cache.test.ts` 追加：
```typescript
// ============ 不可变性 ============

describe('claudeCodeCache - immutability', () => {
  it('should not mutate original upstream object', async () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      system: [{ type: 'text', text: '你是Claude。' }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', content: '结果。\n\n<system-reminder>\nContinue\n</system-reminder>' },
          ],
        },
      ],
    }
    const originalBody = JSON.parse(JSON.stringify(body))
    const upstream = makeUpstream({ body })
    await claudeCodeCacheInterceptor(upstream, makeCtx())
    expect(upstream.body).toEqual(originalBody)
  })
})
```

- [ ] **Step 18: Run test to verify the whole file passes**

```bash
npx vitest run tests/interceptor/claude-code-cache.test.ts
```
Expected: ALL PASS

- [ ] **Step 19: Commit**

```bash
git add src/interceptor/claude-code-cache.ts tests/interceptor/claude-code-cache.test.ts
git commit -m "feat: add claude-code-cache interceptor (smoosh-split, sort-stabilization, fresh-session-sort, content-strip)"
```

---

### Task 5: TDD — 实现 `cache-control-normalize` 拦截器

**Files:**
- Create: `src/interceptor/cache-control-normalize.ts`
- Test: `tests/interceptor/cache-control-normalize.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/interceptor/cache-control-normalize.test.ts`：
```typescript
import { describe, it, expect } from 'vitest'
import { cacheControlNormalizeInterceptor } from '../../../src/interceptor/cache-control-normalize.js'
import type { UpstreamRequest } from '../../../src/routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from '../../../src/interceptor/types.js'

function makeUpstream(overrides?: Partial<UpstreamRequest>): UpstreamRequest {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: { authorization: 'Bearer sk-test', 'content-type': 'application/json' },
    body: {
      model: 'claude-sonnet-4-20250514',
      system: [{ type: 'text', text: '你是Claude。' }],
      messages: [],
    },
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

describe('cacheControlNormalize - URL 守卫', () => {
  it('should skip when URL is not /v1/messages', async () => {
    const upstream = makeUpstream({ url: 'https://api.openai.com/v1/chat/completions' })
    const result = await cacheControlNormalizeInterceptor(upstream, makeCtx())
    expect(result).toBe(upstream)
  })
})

describe('cacheControlNormalize', () => {
  it('should strip cache_control from all user messages', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: '你是Claude。', cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '第一轮', cache_control: { type: 'ephemeral' } },
            ],
          },
          {
            role: 'assistant',
            content: [{ type: 'text', text: '回复' }],
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '第二轮消息A' },
              { type: 'text', text: '第二轮消息B', cache_control: { type: 'ephemeral' } },
            ],
          },
        ],
      },
    })
    const result = await cacheControlNormalizeInterceptor(upstream, makeCtx())
    const msgs = result.body.messages

    // user messages 中的 cache_control 被剥离
    const firstUserBlocks = msgs[0].content
    for (const block of firstUserBlocks) {
      if (block.type === 'text') {
        expect(block.cache_control).toBeUndefined()
      }
    }

    // 最后一个 user message（index 2）的最后一个 block 被添加 canonical cache_control
    const lastUserMsg = msgs[2]
    const lastBlock = lastUserMsg.content[lastUserMsg.content.length - 1]
    expect(lastBlock.cache_control).toBeDefined()
    expect(lastBlock.cache_control.type).toBe('ephemeral')
  })

  it('should skip when no user messages have cache_control', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: '你是Claude。', cache_control: { type: 'ephemeral' } }],
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        ],
      },
    })
    const result = await cacheControlNormalizeInterceptor(upstream, makeCtx())
    // 没有 user message 有 cache_control，所以不变
    expect(result).toBe(upstream)
  })

  it('should not mutate original upstream object', async () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      system: [{ type: 'text', text: '你是Claude。' }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } },
          ],
        },
      ],
    }
    const originalBody = JSON.parse(JSON.stringify(body))
    const upstream = makeUpstream({ body })
    await cacheControlNormalizeInterceptor(upstream, makeCtx())
    expect(upstream.body).toEqual(originalBody)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/interceptor/cache-control-normalize.test.ts
```
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`src/interceptor/cache-control-normalize.ts`：
```typescript
import { isAnthropicV1Messages } from './helpers.js'
import type { UpstreamInterceptor } from './types.js'

function countUserCacheControlMarkers(body: any): number {
  if (!body?.messages || !Array.isArray(body.messages)) return 0
  let n = 0
  for (const msg of body.messages) {
    if (msg?.role !== 'user' || !Array.isArray(msg.content)) continue
    for (const block of msg.content) {
      if (block && typeof block === 'object' && block.cache_control) n++
    }
  }
  return n
}

export const cacheControlNormalizeInterceptor: UpstreamInterceptor = async (upstream, ctx) => {
  if (!isAnthropicV1Messages(upstream.url)) return upstream

  const body = upstream.body
  const markerCount = countUserCacheControlMarkers(body)
  if (markerCount === 0) return upstream

  const newMessages = body.messages.map((msg: any) => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg
    const newContent = msg.content.map((block: any) => {
      if (!block || typeof block !== 'object') return block
      if (!block.cache_control) return block
      const { cache_control, ...rest } = block
      return rest
    })
    return { ...msg, content: newContent }
  })

  // Apply canonical cache_control at the last block of the last user message
  for (let i = newMessages.length - 1; i >= 0; i--) {
    const msg = newMessages[i]
    if (msg.role !== 'user' || !Array.isArray(msg.content) || msg.content.length === 0) continue
    const lastIdx = msg.content.length - 1
    const lastBlock = msg.content[lastIdx]
    if (lastBlock && typeof lastBlock === 'object') {
      newMessages[i] = {
        ...msg,
        content: [
          ...msg.content.slice(0, lastIdx),
          { ...lastBlock, cache_control: { type: 'ephemeral' } },
        ],
      }
    }
    break
  }

  return { ...upstream, body: { ...body, messages: newMessages } }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/interceptor/cache-control-normalize.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/interceptor/cache-control-normalize.ts tests/interceptor/cache-control-normalize.test.ts
git commit -m "feat: add cache-control-normalize interceptor"
```

---

### Task 6: TDD — 实现 `ttl-management` 拦截器

**Files:**
- Create: `src/interceptor/ttl-management.ts`
- Test: `tests/interceptor/ttl-management.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/interceptor/ttl-management.test.ts`：
```typescript
import { describe, it, expect } from 'vitest'
import { ttlManagementInterceptor } from '../../../src/interceptor/ttl-management.js'
import type { UpstreamRequest } from '../../../src/routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from '../../../src/interceptor/types.js'

function makeUpstream(overrides?: Partial<UpstreamRequest>): UpstreamRequest {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: { authorization: 'Bearer sk-test', 'content-type': 'application/json' },
    body: {
      model: 'claude-sonnet-4-20250514',
      system: [{ type: 'text', text: '你是Claude。', cache_control: { type: 'ephemeral' } }],
      messages: [],
    },
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

describe('ttlManagement - URL 守卫', () => {
  it('should skip when URL is not /v1/messages', async () => {
    const upstream = makeUpstream({ url: 'https://api.openai.com/v1/chat/completions' })
    const result = await ttlManagementInterceptor(upstream, makeCtx())
    expect(result).toBe(upstream)
  })
})

describe('ttlManagement', () => {
  it('should inject ttl on system blocks with ephemeral cache_control but no ttl', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [
          { type: 'text', text: '你是Claude。', cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } },
            ],
          },
        ],
      },
    })
    const result = await ttlManagementInterceptor(upstream, makeCtx())
    // system block 被注入 ttl
    expect(result.body.system[0].cache_control.ttl).toBe('1h')
    // user message content block 也被注入 ttl
    expect(result.body.messages[0].content[0].cache_control.ttl).toBe('1h')
  })

  it('should skip when body has no system field', async () => {
    const upstream = makeUpstream({
      url: 'https://api.anthropic.com/v1/messages',
      headers: { authorization: 'Bearer sk-test', 'content-type': 'application/json' },
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
      },
    })
    const result = await ttlManagementInterceptor(upstream, makeCtx())
    expect(result).toBe(upstream)
  })

  it('should not modify blocks without cache_control', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [
          { type: 'text', text: '你是Claude。' }, // 没有 cache_control
        ],
        messages: [],
      },
    })
    const result = await ttlManagementInterceptor(upstream, makeCtx())
    expect(result).toBe(upstream)
  })

  it('should not mutate original upstream object', async () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      system: [{ type: 'text', text: '你是Claude。', cache_control: { type: 'ephemeral' } }],
      messages: [],
    }
    const originalBody = JSON.parse(JSON.stringify(body))
    const upstream = makeUpstream({ body })
    await ttlManagementInterceptor(upstream, makeCtx())
    expect(upstream.body).toEqual(originalBody)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/interceptor/ttl-management.test.ts
```
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`src/interceptor/ttl-management.ts`：
```typescript
import { isAnthropicV1Messages } from './helpers.js'
import type { UpstreamInterceptor } from './types.js'

const TTL_VALUE = '1h'

function hasEphemeralWithoutTtl(block: any): boolean {
  return block?.cache_control?.type === 'ephemeral' && !block.cache_control.ttl
}

function injectTtl(block: any): any {
  if (!hasEphemeralWithoutTtl(block)) return block
  return { ...block, cache_control: { ...block.cache_control, ttl: TTL_VALUE } }
}

export const ttlManagementInterceptor: UpstreamInterceptor = async (upstream, ctx) => {
  if (!isAnthropicV1Messages(upstream.url)) return upstream

  const body = upstream.body
  if (!body?.system && !body?.messages) return upstream

  let hasChanges = false

  // Inject TTL on system blocks
  let newSystem = body.system
  if (Array.isArray(body.system)) {
    newSystem = body.system.map((block: any) => {
      const injected = injectTtl(block)
      if (injected !== block) hasChanges = true
      return injected
    })
  }

  // Inject TTL on messages content blocks
  let newMessages = body.messages
  if (Array.isArray(body.messages)) {
    newMessages = body.messages.map((msg: any) => {
      if (!Array.isArray(msg.content)) return msg
      const newContent = msg.content.map((block: any) => {
        const injected = injectTtl(block)
        if (injected !== block) hasChanges = true
        return injected
      })
      if (newContent !== msg.content) {
        return { ...msg, content: newContent }
      }
      return msg
    })
  }

  if (!hasChanges) return upstream

  return { ...upstream, body: { ...body, system: newSystem, messages: newMessages } }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/interceptor/ttl-management.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/interceptor/ttl-management.ts tests/interceptor/ttl-management.test.ts
git commit -m "feat: add ttl-management interceptor"
```

---

### Task 7: 更新 `server.ts` 注册新拦截器

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: 添加 import + 注册新拦截器**

修改 `src/server.ts`，在现有 import 之后追加：
```typescript
import { claudeCodeCacheInterceptor } from './interceptor/claude-code-cache.js'
import { cacheControlNormalizeInterceptor } from './interceptor/cache-control-normalize.js'
import { ttlManagementInterceptor } from './interceptor/ttl-management.js'
```

修改拦截器注册顺序，第 41-45 行改为：
```typescript
// !!! 必须放在第一个执行：在所有其他拦截器之前清理 Anthropic billing header
interceptors.use(anthropicBillingCleaner)
// CC 缓存优化（smoosh-split, sort-stabilization, fresh-session-sort, content-strip）
interceptors.use(claudeCodeCacheInterceptor)
// 通用 Anthropic cache_control 规范化
interceptors.use(cacheControlNormalizeInterceptor)
// 通用 Anthropic TTL 管理
interceptors.use(ttlManagementInterceptor)
// 注册 Qwen 缓存拦截器（模块级，只注册一次）
interceptors.use(qwenCacheInterceptor)
// 注册 OpenCode Session 拦截器（模块级，只注册一次）
interceptors.use(opencodeSessionInterceptor)
```

- [ ] **Step 2: Run build to verify**

```bash
pnpm build
```
Expected: 编译成功，无类型错误

- [ ] **Step 3: Run all tests to verify**

```bash
npx vitest run
```
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: register new anthropic cache optimization interceptors in server.ts"
```

---

### Task 8: 添加拦截器顺序测试 + 迁移 `index.test.ts`

**Files:**
- Create/Move: `tests/interceptor/index.test.ts`

- [ ] **Step 1: 编写拦截器顺序测试**

在迁移后的 `tests/interceptor/index.test.ts` 中追加：
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { InterceptorManager } from '../../../src/interceptor/index.js'
import { anthropicBillingCleaner } from '../../../src/interceptor/anthropic-billing-cleaner.js'
import { claudeCodeCacheInterceptor } from '../../../src/interceptor/claude-code-cache.js'
import { cacheControlNormalizeInterceptor } from '../../../src/interceptor/cache-control-normalize.js'
import { ttlManagementInterceptor } from '../../../src/interceptor/ttl-management.js'
import { qwenCacheInterceptor } from '../../../src/interceptor/qwen-cache.js'
import { opencodeSessionInterceptor } from '../../../src/interceptor/opencode-session.js'
import type { UpstreamRequest } from '../../../src/routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from '../../../src/interceptor/types.js'

// ... [保留原有 InterceptorManager 的所有基础测试] ...

describe('InterceptorManager - 拦截器注册顺序', () => {
  let manager: InterceptorManager
  const upstream: UpstreamRequest = {
    url: 'https://api.anthropic.com/v1/messages',
    headers: { authorization: 'Bearer sk-test', 'content-type': 'application/json' },
    body: {
      model: 'claude-sonnet-4-20250514',
      system: [{ type: 'text', text: '你是Claude。' }],
      messages: [{ role: 'user', content: 'hello' }],
    },
  }
  const ctx: UpstreamInterceptorContext = {
    provider: {
      customModel: 'my-claude',
      realModel: 'claude-sonnet-4-20250514',
      apiKey: 'sk-test',
      baseUrl: 'https://api.anthropic.com',
      provider: 'anthropic',
    },
    c: {} as any,
    currentUser: null,
    clientIp: null,
    requestId: 'test-order',
    customModel: 'my-claude',
    stream: false,
  }

  beforeEach(() => {
    manager = new InterceptorManager()
    // 注册顺序应与 server.ts 一致
    manager.use(anthropicBillingCleaner)
    manager.use(claudeCodeCacheInterceptor)
    manager.use(cacheControlNormalizeInterceptor)
    manager.use(ttlManagementInterceptor)
    manager.use(qwenCacheInterceptor)
    manager.use(opencodeSessionInterceptor)
  })

  it('should execute all 6 interceptors in order without error', async () => {
    const result = await manager.execute(upstream, ctx)
    expect(result.body).toBeDefined()
    expect(result.body.messages).toBeDefined()
  })

  it('should apply anthropic-billing-cleaner before claude-code-cache', async () => {
    // 构造一个有 billing header + CC cache 优化需求的 body
    const testUpstream: UpstreamRequest = {
      ...upstream,
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [
          {
            type: 'text',
            text: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;<system-reminder>\nThe following skills are available:\n\n- Zoo\n- Alpha\n</system-reminder>',
          },
        ],
        messages: [{ role: 'user', content: 'hello' }],
      },
    }
    const result = await manager.execute(testUpstream, ctx)
    const systemText = result.body.system[0].text
    // billing header 被去除，且 skills 被排序
    expect(systemText).not.toContain('x-anthropic-billing-header')
    expect(systemText).toContain('- Alpha')
    expect(systemText).toContain('- Zoo')
    const alphaIdx = systemText.indexOf('- Alpha')
    const zooIdx = systemText.indexOf('- Zoo')
    expect(alphaIdx).toBeLessThan(zooIdx)
  })

  it('should apply cache-control-normalize before ttl-management', async () => {
    // cache-control-normalize 会添加 cache_control，ttl-management 会加 ttl
    const testUpstream: UpstreamRequest = {
      ...upstream,
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: '你是Claude。' }],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } },
            ],
          },
        ],
      },
    }
    const result = await manager.execute(testUpstream, ctx)
    // cache-control-normalize 会在最后一个 user content block 添加 cache_control
    // ttl-management 会给它加 ttl
    const lastMsg = result.body.messages[0]
    const lastBlock = lastMsg.content[lastMsg.content.length - 1]
    expect(lastBlock.cache_control).toBeDefined()
    expect(lastBlock.cache_control.type).toBe('ephemeral')
    expect(lastBlock.cache_control.ttl).toBe('1h')
  })
})
```

- [ ] **Step 2: Run test to verify**

```bash
npx vitest run tests/interceptor/index.test.ts
```
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add tests/interceptor/index.test.ts
git commit -m "test: add interceptor registration order test"
```

---

### Task 9: 更新 `AGENT.md` 文档

**Files:**
- Modify: `AGENT.md`

- [ ] **Step 1: 更新测试目录说明**

在 AGENT.md 的 `## Testing Strategy` 章节，修改 `Test file naming` 规则，补充测试迁移说明。

"Test file naming: `tests/<path-to-module>.test.ts` mirroring `src/` structure (e.g. `src/lib/foo.ts` → `tests/lib/foo.test.ts`, `src/admin/views/models.tsx` → `tests/views/models.test.tsx`, `src/interceptor/xxx.ts` → `tests/interceptor/xxx.test.ts`)"

- [ ] **Step 2: 更新拦截器列表**

在 `## Architecture` 章节或新增 `### Interceptors` 章节，补充所有拦截器及其注册顺序：
```
### Interceptors (注册顺序)

| 顺序 | 拦截器 | 作用域 | 功能 |
|------|--------|--------|------|
| 1 | `anthropic-billing-cleaner` | Anthropic /v1/messages | 去除 billing header 前缀 |
| 2 | `claude-code-cache` | Anthropic /v1/messages (CC) | smoosh-split / sort-stabilization / fresh-session-sort / content-strip |
| 3 | `cache-control-normalize` | Anthropic /v1/messages | 规范化 cache_control 位置 |
| 4 | `ttl-management` | Anthropic /v1/messages | 注入 TTL |
| 5 | `qwen-cache` | 所有 /v1 请求 | Qwen Cache Token 管理 |
| 6 | `opencode-session` | 所有 /v1 请求 | OpenCode Session 管理 |
```
