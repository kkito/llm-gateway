# Qwen 上下文缓存拦截器 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 利用 UpstreamInterceptor 框架，为 Qwen 模型自动注入 `cache_control: { type: "ephemeral" }` 标记，触发阿里云百炼的上下文缓存。

**Architecture:** 在 `src/interceptor/` 下新建 `qwen-cache.ts` 文件，导出 `qwenCacheInterceptor`（UpstreamInterceptor 类型）和若干纯辅助函数。在 `src/server.ts` 的 `createServer` 开头注册该拦截器。

**Tech Stack:** TypeScript, UpstreamInterceptor 框架, Vitest

---

### Task 1: 新建 qwen-cache.ts — 辅助函数

**Files:**
- Create: `src/interceptor/qwen-cache.ts`

**内容：** 先实现 5 个纯辅助函数（不依赖拦截器上下文），后续拦截器函数组装它们。

- [ ] **Step 1: 创建文件骨架**

```typescript
/**
 * Qwen 上下文缓存拦截器
 *
 * 当请求的目标模型包含 "qwen" 时，自动在请求体中的适当位置插入
 * cache_control: { type: "ephemeral" } 标记，触发阿里云百炼上下文缓存。
 */

/**
 * 在 tools 数组的最后一条上添加 cache_control。
 * 如果 tools 为空或不存在，返回原数组。
 */
export function addCacheControlToTools(tools: any[] | undefined): any[] | undefined {
  if (!tools || tools.length === 0) return tools
  const last = { ...tools[tools.length - 1], cache_control: { type: 'ephemeral' as const } }
  return [...tools.slice(0, -1), last]
}

/**
 * 在 messages 数组的最后一条的 content 上添加 cache_control。
 * - content 是数组：在 content[0] 上加
 * - content 是字符串：转成 [{ type: 'text', text, cache_control }]
 * - 无 messages 或为空：返回原数组
 */
export function addCacheControlToLastMessage(messages: any[] | undefined): any[] | undefined {
  if (!messages || messages.length === 0) return messages
  const lastIdx = messages.length - 1
  const last = messages[lastIdx]
  if (!last.content) return messages

  let newContent: any[]
  if (Array.isArray(last.content)) {
    newContent = [...last.content]
    if (newContent.length > 0) {
      newContent[0] = { ...newContent[0], cache_control: { type: 'ephemeral' as const } }
    }
  } else if (typeof last.content === 'string') {
    newContent = [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' as const } }]
  } else {
    return messages
  }

  const newLast = { ...last, content: newContent }
  return [...messages.slice(0, lastIdx), newLast]
}

/**
 * 确保 content 是数组格式。
 * 如果是 string，转为 [{ type: 'text', text: content }]。
 * 如果已经是数组，原样返回。其他情况返回 undefined。
 */
export function ensureContentArray(content: any): any[] | undefined {
  if (Array.isArray(content)) return content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return undefined
}

/**
 * 在 content 数组的最后一个 text block 上添加 cache_control。
 * 如果数组为空或没有 text block，返回原数组（不计数）。
 */
export function addCacheControlToLastTextBlock(blocks: any[]): any[] {
  // 从后往前找最后一个 text block
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === 'text') {
      const result = [...blocks]
      result[i] = { ...result[i], cache_control: { type: 'ephemeral' as const } }
      return result
    }
  }
  // 没有 text block，不修改
  return blocks
}

/**
 * 在 system messages 上按顺序添加 cache_control，最多不超过 quota 条。
 * 返回处理后的 messages 新数组。
 */
export function addCacheControlToSystemMessages(messages: any[], quota: number): any[] {
  if (quota <= 0) return messages

  let remaining = quota
  return messages.map((msg) => {
    if (msg.role !== 'system' || remaining <= 0) return msg

    const blocks = ensureContentArray(msg.content)
    if (!blocks || blocks.length === 0) return msg // 跳过空 content

    const textIdx = blocks.findLastIndex((b: any) => b.type === 'text')
    if (textIdx === -1) return msg // 跳过无 text block 的情况

    remaining--
    const newBlocks = [...blocks]
    newBlocks[textIdx] = { ...newBlocks[textIdx], cache_control: { type: 'ephemeral' as const } }
    return { ...msg, content: newBlocks }
  })
}
```

注意 `findLastIndex` 在 ES2023 可用。检查 tsconfig 的 lib：

- [ ] **Step 2: 确认 tsconfig 支持 `findLastIndex`**

```bash
grep -o '"lib": \[[^]]*\]' /Users/kkito/proj/github/llm-gateway/tsconfig.json
```

如果不支持 ES2023，改用 `for` 循环从尾部遍历。

- [ ] **Step 3: 编译验证**

```bash
cd /Users/kkito/proj/github/llm-gateway && npx tsc --noEmit src/interceptor/qwen-cache.ts
```

Expected: No errors.

---

### Task 2: 编写 qwen-cache.test.ts — 辅助函数测试

**Files:**
- Create: `src/interceptor/qwen-cache.test.ts`

- [ ] **Step 1: 编写辅助函数测试（不含拦截器入口的测试）**

```typescript
import { describe, it, expect } from 'vitest'
import {
  addCacheControlToTools,
  addCacheControlToLastMessage,
  addCacheControlToSystemMessages,
} from './qwen-cache.js'

describe('addCacheControlToTools', () => {
  it('should add cache_control to the last tool', () => {
    const tools = [{ type: 'function', function: { name: 'a' } }, { type: 'function', function: { name: 'b' } }]
    const result = addCacheControlToTools(tools)
    expect(result![0]).not.toHaveProperty('cache_control')
    expect(result![1]).toHaveProperty('cache_control', { type: 'ephemeral' })
    // 原数组不变
    expect(tools[1]).not.toHaveProperty('cache_control')
  })

  it('should return undefined when tools is undefined', () => {
    expect(addCacheControlToTools(undefined)).toBeUndefined()
  })

  it('should return empty array when tools is empty', () => {
    expect(addCacheControlToTools([])).toEqual([])
  })

  it('should handle single tool', () => {
    const tools = [{ type: 'function', function: { name: 'x' } }]
    const result = addCacheControlToTools(tools)
    expect(result![0]).toHaveProperty('cache_control', { type: 'ephemeral' })
  })
})

describe('addCacheControlToLastMessage', () => {
  it('should add cache_control to content[0] of last message', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ]
    const result = addCacheControlToLastMessage(messages)!
    expect(result[1].content[0]).toHaveProperty('cache_control', { type: 'ephemeral' })
    expect(result[0].content[0]).not.toHaveProperty('cache_control')
  })

  it('should convert string content to array and add cache_control', () => {
    const messages = [{ role: 'user', content: 'hello' }]
    const result = addCacheControlToLastMessage(messages)!
    expect(result[0].content).toEqual([{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }])
  })

  it('should return original messages when last message has no content', () => {
    const messages = [{ role: 'user }]
    expect(addCacheControlToLastMessage(messages)).toBe(messages)
  })

  it('should return undefined when messages is undefined', () => {
    expect(addCacheControlToLastMessage(undefined)).toBeUndefined()
  })

  it('should not modify original messages', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
    addCacheControlToLastMessage(messages)
    expect(messages[0].content[0]).not.toHaveProperty('cache_control')
  })
})

describe('addCacheControlToSystemMessages', () => {
  it('should add cache_control to single system message with string content', () => {
    const messages = [{ role: 'system', content: 'You are helpful.' }]
    const result = addCacheControlToSystemMessages(messages, 4)
    expect(result[0].content).toEqual([{ type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } }])
  })

  it('should add cache_control to last text block of array content', () => {
    const messages = [{ role: 'system', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }]
    const result = addCacheControlToSystemMessages(messages, 4)
    expect(result[0].content[0]).not.toHaveProperty('cache_control')
    expect(result[0].content[1]).toHaveProperty('cache_control', { type: 'ephemeral' })
  })

  it('should respect quota and add to first N system messages only', () => {
    const messages = [
      { role: 'system', content: 's1' },
      { role: 'system', content: 's2' },
      { role: 'system', content: 's3' },
    ]
    const result = addCacheControlToSystemMessages(messages, 2)
    expect(result[0].content[0]).toHaveProperty('cache_control') // added
    expect(result[1].content[0]).toHaveProperty('cache_control') // added
    expect(result[2].content[0]).not.toHaveProperty('cache_control') // quota exhausted
  })

  it('should skip system messages with no text blocks', () => {
    const messages = [{ role: 'system', content: [{ type: 'image_url', image_url: { url: 'x' } }] }]
    const result = addCacheControlToSystemMessages(messages, 4)
    expect(result[0].content[0]).not.toHaveProperty('cache_control')
  })

  it('should skip system messages with empty array content', () => {
    const messages = [{ role: 'system', content: [] }]
    const result = addCacheControlToSystemMessages(messages, 4)
    expect(result[0].content).toEqual([])
  })

  it('should not modify original messages', () => {
    const messages = [{ role: 'system', content: 'hello' }]
    addCacheControlToSystemMessages(messages, 4)
    expect(messages[0].content).toBe('hello')
  })

  it('should do nothing when quota is 0', () => {
    const messages = [{ role: 'system', content: 'hello' }]
    const result = addCacheControlToSystemMessages(messages, 0)
    expect(result[0].content).not.toHaveProperty('cache_control')
  })
})
```

- [ ] **Step 2: 运行测试确认**

```bash
cd /Users/kkito/proj/github/llm-gateway && npx vitest run src/interceptor/qwen-cache.test.ts
```

Expected: All tests pass.

---

### Task 3: 实现 qwenCacheInterceptor 入口函数

**Files:**
- Modify: `src/interceptor/qwen-cache.ts`（追加入口函数）

- [ ] **Step 1: 在 qwen-cache.ts 末尾添加拦截器入口函数**

```typescript
import type { UpstreamInterceptor } from './types.js'

// ... 已有的辅助函数 ...

/**
 * 检查 model 名称是否包含 "qwen"（大小写不敏感）。
 */
function isQwenModel(modelName: string): boolean {
  return modelName.toLowerCase().includes('qwen')
}

/**
 * Qwen 上下文缓存拦截器。
 *
 * 触发条件：realModel 小写包含 "qwen" 且 body 有非空 messages。
 * 按优先级注入最多 4 个 cache_control 标记。
 */
export const qwenCacheInterceptor: UpstreamInterceptor = async (upstream, ctx) => {
  const realModel = ctx.provider.realModel
  if (!isQwenModel(realModel)) return upstream

  const body = upstream.body
  if (!body || !body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return upstream
  }

  let count = 0

  // 1. tools 最后一条
  let newTools: any[] | undefined
  if (body.tools) {
    newTools = addCacheControlToTools(body.tools)
    if (newTools !== body.tools) count++
  }

  // 2. messages 最后一条
  let newMessages = addCacheControlToLastMessage(body.messages)
  if (newMessages !== body.messages) count++

  // 3. system messages（剩余配额）
  const systemQuota = Math.max(0, 4 - count)
  if (systemQuota > 0) {
    newMessages = addCacheControlToSystemMessages(newMessages!, systemQuota)
  }

  const newBody: any = { ...body, messages: newMessages }
  if (newTools !== undefined) {
    newBody.tools = newTools
  }

  return { ...upstream, body: newBody }
}
```

- [ ] **Step 2: 编译验证**

```bash
cd /Users/kkito/proj/github/llm-gateway && npx tsc --noEmit
```

Expected: No errors.

---

### Task 4: 编写拦截器入口测试

**Files:**
- Modify: `src/interceptor/qwen-cache.test.ts`（追加拦截器入口测试）

- [ ] **Step 1: 在测试文件末尾添加拦截器入口测试**

```typescript
import { qwenCacheInterceptor } from './qwen-cache.js'
import type { UpstreamRequest } from '../routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from './types.js'

function makeCtx(overrides?: Partial<UpstreamInterceptorContext>): UpstreamInterceptorContext {
  return {
    provider: {
      customModel: 'my-qwen',
      realModel: 'qwen-max',
      apiKey: 'sk-test',
      baseUrl: 'https://dashscope.aliyuncs.com',
      provider: 'openai',
    },
    c: {} as any,
    currentUser: null,
    clientIp: null,
    requestId: 'test-001',
    customModel: 'my-qwen',
    stream: false,
    ...overrides,
  }
}

describe('qwenCacheInterceptor', () => {
  it('should skip when realModel does not contain qwen', async () => {
    const upstream: UpstreamRequest = { url: '', headers: {}, body: { messages: [{ role: 'user', content: 'hi' }] } }
    const ctx = makeCtx({ provider: { ...ctx!.provider, realModel: 'gpt-4' } as any })
    const result = await qwenCacheInterceptor(upstream, ctx)
    // 如果 ctx 是同一个对象
  })

  // 修正：用 makeCtx 覆盖 provider
  // 逻辑：realModel 不含 qwen → 原样返回
})
```

等等，这里测试写法有歧义。让我重写更清晰的版本：

```typescript
describe('qwenCacheInterceptor', () => {
  it('should skip when realModel does not contain qwen', async () => {
    const upstream: UpstreamRequest = { url: '', headers: {}, body: { messages: [{ role: 'user', content: 'hi' }] } }
    const ctx = makeCtx()
    // 覆盖 provider
    ctx.provider = { ...ctx.provider, realModel: 'gpt-4' }
    const result = await qwenCacheInterceptor(upstream, ctx)
    expect(result).toBe(upstream)
  })

  it('should skip when body has no messages', async () => {
    const upstream: UpstreamRequest = { url: '', headers: {}, body: {} }
    const ctx = makeCtx()
    const result = await qwenCacheInterceptor(upstream, ctx)
    expect(result).toBe(upstream)
  })

  it('should skip when messages is empty array', async () => {
    const upstream: UpstreamRequest = { url: '', headers: {}, body: { messages: [] } }
    const ctx = makeCtx()
    const result = await qwenCacheInterceptor(upstream, ctx)
    expect(result).toBe(upstream)
  })

  it('should add cache_control to tools and last message', async () => {
    const upstream: UpstreamRequest = {
      url: '',
      headers: {},
      body: {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        ],
        tools: [{ type: 'function', function: { name: 'a' } }, { type: 'function', function: { name: 'b' } }],
      },
    }
    const ctx = makeCtx()
    const result = await qwenCacheInterceptor(upstream, ctx)
    // tools last item has cache_control
    expect(result.body.tools[1]).toHaveProperty('cache_control', { type: 'ephemeral' })
    // last message content[0] has cache_control
    expect(result.body.messages[1].content[0]).toHaveProperty('cache_control', { type: 'ephemeral' })
    // system also got cache_control (quota: 4 - 2 = 2)
    expect(result.body.messages[0].content[0]).toHaveProperty('cache_control', { type: 'ephemeral' })
    // total 3 marks, within limit
  })

  it('should respect 4 mark limit', async () => {
    const upstream: UpstreamRequest = {
      url: '',
      headers: {},
      body: {
        messages: [
          { role: 'system', content: 's1' },
          { role: 'system', content: 's2' },
          { role: 'system', content: 's3' },
          { role: 'system', content: 's4' },
          { role: 'user', content: 'hi' },
        ],
        tools: [{ type: 'function', function: { name: 'x' } }],
      },
    }
    const ctx = makeCtx()
    const result = await qwenCacheInterceptor(upstream, ctx)
    // tools:1 + lastMessage:1 + system:2 = 4
    expect(result.body.tools[0]).toHaveProperty('cache_control')
    expect(result.body.messages[4].content[0]).toHaveProperty('cache_control') // last user msg
    expect(result.body.messages[0].content[0]).toHaveProperty('cache_control') // s1
    expect(result.body.messages[1].content[0]).toHaveProperty('cache_control') // s2
    expect(result.body.messages[2].content[0]).not.toHaveProperty('cache_control') // s3 over limit
    expect(result.body.messages[3].content[0]).not.toHaveProperty('cache_control') // s4 over limit
  })

  it('should not mutate original upstream body', async () => {
    const body = { messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 'x' } }] }
    const upstream: UpstreamRequest = { url: '', headers: {}, body }
    const ctx = makeCtx()
    await qwenCacheInterceptor(upstream, ctx)
    expect(body.messages[0].content).toBe('hi') // unchanged string
    expect(body.tools[0]).not.toHaveProperty('cache_control')
  })
})
```

- [ ] **Step 2: 运行全部测试**

```bash
cd /Users/kkito/proj/github/llm-gateway && npx vitest run src/interceptor/qwen-cache.test.ts
```

Expected: All tests pass.

---

### Task 5: 在 server.ts 注册拦截器

**Files:**
- Modify: `src/server.ts`

在 `createServer` 函数开头，已有 import 之后，导入并注册拦截器。由于 `createServer` 可能被多次调用（测试环境），注册应该在函数内部做一次，但 `interceptors.use` 是幂等的（如果重复注册会重复执行，这不是幂等）。因此改用**模块级注册**方式：在 `qwen-cache.ts` 中自行注册，或在 `server.ts` 顶部做一次。

最干净的方式：在 `qwen-cache.ts` 末尾添加自注册逻辑。但更好的方式是显式地在 `server.ts` 中注册，因为 IDE 能看得到。

选择在 `server.ts` 顶部做一次注册：

- [ ] **Step 1: 在 server.ts 中导入并注册**

```typescript
// 在已有 import 后面追加
import { interceptors } from './interceptor/index.js'
import { qwenCacheInterceptor } from './interceptor/qwen-cache.js'

// 注册 Qwen 缓存拦截器（模块级，只注册一次）
interceptors.use(qwenCacheInterceptor)
```

放在 `createServer` 函数外部（文件作用域），保证进程生命周期内只注册一次。

- [ ] **Step 2: 编译验证**

```bash
cd /Users/kkito/proj/github/llm-gateway && npx tsc --noEmit
```

Expected: No errors.

---

### Task 6: 完整构建和测试

- [ ] **Step 1: 构建项目**

```bash
cd /Users/kkito/proj/github/llm-gateway && pnpm build
```

- [ ] **Step 2: 运行全部测试**

```bash
cd /Users/kkito/proj/github/llm-gateway && pnpm test
```

Expected: 所有测试通过（89 files, 0 failures 左右）。

- [ ] **Step 3: 提交**

```bash
cd /Users/kkito/proj/github/llm-gateway && \
  git add src/interceptor/qwen-cache.ts src/interceptor/qwen-cache.test.ts src/server.ts && \
  git commit -m "feat: add Qwen context cache interceptor"
```
