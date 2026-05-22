# Upstream Interceptor 框架 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `buildUpstreamRequest` 完成之后、`sendUpstreamRequest` 发送之前插入可自定义的拦截器链，让用户能通过函数修改最终发出的 URL/Headers/Body。

**Architecture:** 新增 `src/interceptor/` 目录，包含 `types.ts`（类型定义）和 `index.ts`（InterceptorManager + 全局单例）。在 4 个 handler 文件的 build/send 调用之间插入 `interceptors.execute()` 调用。

**Tech Stack:** TypeScript 5.9+, ESM, Vitest

**Spec:** `docs/superpowers/specs/2026-05-22-upstream-interceptor-design.md`

---

### Task 1: `src/interceptor/types.ts` — 类型定义

**Files:**
- Create: `src/interceptor/types.ts`
- Test: `src/interceptor/index.test.ts`（使用 types，但类型本身不测试）

- [ ] **Step 1: Create `src/interceptor/types.ts`**

```typescript
import type { ProviderConfig } from '../config.js'
import type { UpstreamRequest } from '../routes/chat-completions/upstream-request.js'

/**
 * 上游请求拦截器的执行上下文。
 *
 * 包含拦截器在执行时可能需要的所有信息：
 * - provider 配置：用于判断当前请求的目标模型和服务商
 * - 客户端信息：IP、原始请求头等，通过 c（Hono Context）获取
 * - 请求元信息：requestId、customModel、stream 等，用于日志/调试
 */
export interface UpstreamInterceptorContext {
  /** 当前匹配到的 ProviderConfig，包含 customModel/realModel/provider 类型/baseUrl/限流配置等完整信息 */
  provider: ProviderConfig

  /**
   * Hono 请求上下文。
   * 拦截器可通过此对象获取客户端请求信息，例如：
   *   ctx.c.req.header('x-forwarded-for')   // 获取客户端 IP
   *   ctx.c.req.header('Authorization')     // 获取客户端认证信息
   *   ctx.c.req.header('user-agent')        // 获取客户端 User-Agent
   *   ctx.c.req.url                         // 获取客户端请求的原始 URL
   *   ctx.c.req.raw.headers                 // 获取客户端的所有原始请求头
   */
  c: any

  /** 用户认证信息。未认证时为 null */
  currentUser: { name: string } | null

  /**
   * 客户端 IP 地址。
   * 优先从 x-forwarded-for 头获取，其次从 x-real-ip，最后从连接信息。
   * 当无法获取时为 null。
   */
  clientIp: string | null

  /** 请求唯一标识（UUID v4），可用于日志关联 */
  requestId: string

  /** 用户请求中指定的自定义模型名称 */
  customModel: string

  /** 模型组名称（如果请求通过模型组路由），否则为 undefined */
  modelGroup?: string

  /** 是否为流式请求 */
  stream: boolean
}

/**
 * 上游请求拦截器函数签名。
 *
 * 拦截器在 buildUpstreamRequest 完成之后、sendUpstreamRequest 发送之前执行。
 * 此时 upstream 包含的是最终要发送给上游大模型 API 的完整内容：
 *   - url: 已经过 Provider.buildUrl() 处理，包含正确的 endpoint 路径
 *   - headers: 已经过 Provider.buildHeaders() 处理，包含认证信息和必要的请求头
 *   - body: 已经过格式转换（如 OpenAI → Anthropic）和默认参数合并后的最终请求体
 *
 * @param upstream  - 已构建好的上游请求对象。拦截器可以修改其 url/headers/body 中的任意字段
 * @param ctx       - 执行上下文，包含模型配置、客户端信息、请求元信息等
 * @returns         - 修改后的上游请求对象。如果不需要修改，返回原对象或其浅拷贝即可
 *
 * @example
 * // 为 Anthropic 模型添加缓存头
 * async (upstream, ctx) => {
 *   if (ctx.provider.provider === 'anthropic' && ctx.provider.customModel === 'my-claude') {
 *     return {
 *       ...upstream,
 *       headers: { ...upstream.headers, 'anthropic-cache': 'enable' },
 *       body: { ...upstream.body, system: upstream.body.system + '\\n[cached]' }
 *     }
 *   }
 *   return upstream
 * }
 */
export type UpstreamInterceptor = (
  upstream: UpstreamRequest,
  ctx: UpstreamInterceptorContext
) => Promise<UpstreamRequest> | UpstreamRequest
```

- [ ] **Step 2: Commit**

```bash
git add src/interceptor/types.ts
git commit -m "feat(interceptor): add UpstreamInterceptor and context types"
```

---

### Task 2: `src/interceptor/index.ts` — InterceptorManager 类和全局实例

**Files:**
- Create: `src/interceptor/index.ts`
- Test: `src/interceptor/index.test.ts`

- [ ] **Step 1: Create `src/interceptor/index.ts`**

```typescript
import type { UpstreamRequest } from '../routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptor, UpstreamInterceptorContext } from './types.js'

export type { UpstreamInterceptor, UpstreamInterceptorContext } from './types.js'

/**
 * 拦截器管理器。
 *
 * 管理所有注册的拦截器，按注册顺序依次执行。
 * 每个拦截器的输出作为下一个拦截器的输入，形成链式处理。
 * 拦截器应保持幂等——不修改入参对象，而是返回新对象。
 */
export class InterceptorManager {
  private interceptors: UpstreamInterceptor[] = []

  /**
   * 注册一个上游请求拦截器。
   * 多个拦截器按注册顺序依次执行，前一个的返回值传给后一个。
   *
   * @param interceptor - 拦截器函数
   *
   * @example
   * import { interceptors } from '../interceptor/index.js'
   *
   * // 注册第一个拦截器：统一添加缓存标记
   * interceptors.use(async (upstream, ctx) => {
   *   return { ...upstream, headers: { ...upstream.headers, 'x-cache': '1' } }
   * })
   *
   * // 注册第二个拦截器：只对特定模型生效
   * interceptors.use(async (upstream, ctx) => {
   *   if (ctx.provider.customModel !== 'my-gpt4') return upstream
   *   return { ...upstream, body: { ...upstream.body, max_tokens: 4096 } }
   * })
   */
  use(interceptor: UpstreamInterceptor): void {
    this.interceptors.push(interceptor)
  }

  /**
   * 按注册顺序依次执行所有拦截器。
   * 如果没有任何拦截器注册，直接返回上游请求对象（无操作）。
   *
   * @param upstream - 当前的上游请求对象
   * @param ctx      - 执行上下文
   * @returns        - 所有拦截器处理后的最终上游请求对象
   */
  async execute(
    upstream: UpstreamRequest,
    ctx: UpstreamInterceptorContext
  ): Promise<UpstreamRequest> {
    // 严格按照注册顺序链式执行
    let current = upstream
    for (const interceptor of this.interceptors) {
      current = await interceptor(current, ctx)
    }
    return current
  }

  /**
   * 清除所有已注册的拦截器（主要用于测试）。
   */
  clear(): void {
    this.interceptors.length = 0
  }
}

/**
 * 全局唯一的拦截器管理器实例。
 * 推荐通过此实例注册拦截器，避免创建多个管理器的认知负担。
 */
export const interceptors = new InterceptorManager()
```

- [ ] **Step 2: Commit**

```bash
git add src/interceptor/index.ts
git commit -m "feat(interceptor): add InterceptorManager class and global instance"
```

---

### Task 3: `src/interceptor/index.test.ts` — InterceptorManager 单元测试

**Files:**
- Create: `src/interceptor/index.test.ts`

- [ ] **Step 1: Create `src/interceptor/index.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { InterceptorManager } from './index.js'
import type { UpstreamRequest } from '../routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from './types.js'

describe('InterceptorManager', () => {
  let manager: InterceptorManager
  const baseUpstream: UpstreamRequest = {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
    body: { model: 'gpt-4', messages: [{ role: 'user', content: 'hello' }] },
  }
  const mockCtx: UpstreamInterceptorContext = {
    provider: {
      customModel: 'test-model',
      realModel: 'gpt-4',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com',
      provider: 'openai',
    },
    c: {} as any,
    currentUser: null,
    clientIp: null,
    requestId: 'test-123',
    customModel: 'test-model',
    stream: false,
  }

  beforeEach(() => {
    manager = new InterceptorManager()
  })

  it('should forward upstream unchanged when no interceptors registered', async () => {
    const result = await manager.execute(baseUpstream, mockCtx)
    expect(result).toBe(baseUpstream)
  })

  it('should execute a single interceptor that modifies headers', async () => {
    manager.use(async (upstream, ctx) => {
      return {
        ...upstream,
        headers: { ...upstream.headers, 'x-cache': '1' },
      }
    })
    const result = await manager.execute(baseUpstream, mockCtx)
    expect(result.headers['x-cache']).toBe('1')
    expect(result.body).toBe(baseUpstream.body)
  })

  it('should execute multiple interceptors in registration order', async () => {
    manager.use(async (upstream, ctx) => {
      return { ...upstream, headers: { ...upstream.headers, 'x-step': '1' } }
    })
    manager.use(async (upstream, ctx) => {
      return { ...upstream, headers: { ...upstream.headers, 'x-step': '2' } }
    })
    const result = await manager.execute(baseUpstream, mockCtx)
    // 第二个拦截器覆盖了 x-step 的值
    expect(result.headers['x-step']).toBe('2')
  })

  it('should pass modified upstream from one interceptor to the next', async () => {
    manager.use(async (upstream, ctx) => {
      return { ...upstream, body: { ...upstream.body, extra: 'first' } }
    })
    manager.use(async (upstream, ctx) => {
      // 确保第二个拦截器能看到第一个的修改
      expect(upstream.body.extra).toBe('first')
      return { ...upstream, body: { ...upstream.body, extra2: 'second' } }
    })
    const result = await manager.execute(baseUpstream, mockCtx)
    expect(result.body.extra).toBe('first')
    expect(result.body.extra2).toBe('second')
  })

  it('should support synchronous interceptors (non-Promise)', async () => {
    manager.use((upstream, ctx) => {
      return { ...upstream, headers: { ...upstream.headers, 'x-sync': 'yes' } }
    })
    const result = await manager.execute(baseUpstream, mockCtx)
    expect(result.headers['x-sync']).toBe('yes')
  })

  it('should allow interceptor to access context fields', async () => {
    manager.use(async (upstream, ctx) => {
      // 根据 provider 类型执行不同逻辑
      if (ctx.provider.provider === 'openai') {
        return { ...upstream, headers: { ...upstream.headers, 'x-provider': 'openai' } }
      }
      return upstream
    })
    const result = await manager.execute(baseUpstream, mockCtx)
    expect(result.headers['x-provider']).toBe('openai')
  })

  it('should clear all interceptors', async () => {
    manager.use(async (upstream, ctx) => {
      return { ...upstream, headers: { ...upstream.headers, 'x-removed': 'yes' } }
    })
    manager.clear()
    const result = await manager.execute(baseUpstream, mockCtx)
    expect((result.headers as any)['x-removed']).toBeUndefined()
  })

  it('should reject when interceptor modifies the original object (immutability violation)', async () => {
    // 这个测试验证文档要求：拦截器应返回新对象而非修改入参
    // 如果拦截器修改了入参，会影响后续注册的拦截器看到的 upstream
    let capturedBody: any
    manager.use(async (upstream, ctx) => {
      capturedBody = upstream.body
      // 错误做法：直接修改入参
      upstream.body.model = 'gpt-4-modified'
      return upstream
    })
    manager.use(async (upstream, ctx) => {
      // 第二个拦截器看到的是已被修改的 upstream（这是错误用法）
      // 我们只是验证这个行为，不推荐这样做
      return upstream
    })
    const result = await manager.execute(baseUpstream, mockCtx)
    // 入参被修改了
    expect(capturedBody!.model).toBe('gpt-4-modified')
  })
})
```

- [ ] **Step 2: Run tests to verify**

```bash
npx vitest run src/interceptor/index.test.ts
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/interceptor/index.test.ts
git commit -m "test(interceptor): add InterceptorManager unit tests"
```

---

### Task 4: 集成到 `src/routes/chat-completions/handler.ts`

**Files:**
- Modify: `src/routes/chat-completions/handler.ts`

- [ ] **Step 1: 添加 import 并插入拦截器**

在文件顶部添加 import：

```typescript
import { interceptors } from '../../interceptor/index.js'
```

找到 `handler.ts` 中的这一段（第 ~200 行附近，`// Build and send upstream request` 注释处）：

```typescript
      // Build and send upstream request
      const upstream = await buildUpstreamRequest(provider, body, stream);
      const response = await sendUpstreamRequest(upstream, detailLogger, requestId, timeoutMs);
```

改为：

```typescript
      // Build and send upstream request
      const upstream = await buildUpstreamRequest(provider, body, stream);

      // 执行注册的拦截器，允许对 upstream request 进行自定义修改（如添加缓存 header/body 字段）
      const intercepted = await interceptors.execute(upstream, {
        provider,
        c,
        currentUser,
        clientIp: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null,
        requestId,
        customModel,
        stream,
        modelGroup,
      });

      const response = await sendUpstreamRequest(intercepted, detailLogger, requestId, timeoutMs);
```

- [ ] **Step 2: Build to verify**

```bash
pnpm build
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/chat-completions/handler.ts
git commit -m "feat(interceptor): integrate into chat-completions handler"
```

---

### Task 5: 集成到 `src/routes/messages/handler.ts`

**Files:**
- Modify: `src/routes/messages/handler.ts`

- [ ] **Step 1: 添加 import 并插入拦截器**

在文件顶部添加 import：

```typescript
import { interceptors } from '../../interceptor/index.js'
```

找到 handler 中 `buildMessagesUpstreamRequest` 和 `sendMessagesUpstreamRequest` 的调用处：

```typescript
      // Build and send upstream request
      const upstream = await buildMessagesUpstreamRequest(provider, body, stream);
      const response = await sendMessagesUpstreamRequest(upstream, detailLogger, requestId, timeoutMs);
```

改为：

```typescript
      // Build and send upstream request
      const upstream = await buildMessagesUpstreamRequest(provider, body, stream);

      // 执行注册的拦截器，允许对 upstream request 进行自定义修改（如添加缓存 header/body 字段）
      const intercepted = await interceptors.execute(upstream, {
        provider,
        c,
        currentUser,
        clientIp: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null,
        requestId,
        customModel,
        stream,
        modelGroup,
      });

      const response = await sendMessagesUpstreamRequest(intercepted, detailLogger, requestId, timeoutMs);
```

- [ ] **Step 2: Build to verify**

```bash
pnpm build
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/messages/handler.ts
git commit -m "feat(interceptor): integrate into messages handler"
```

---

### Task 6: 集成到 `src/routes/chat-completions/model-fallback.ts`

**Files:**
- Modify: `src/routes/chat-completions/model-fallback.ts`

- [ ] **Step 1: 添加 import 并插入拦截器**

在文件顶部添加 import：

```typescript
import { interceptors } from '../../interceptor/index.js'
```

找到 fallback 循环中的 `buildUpstreamRequest` / `sendUpstreamRequest` 调用：

```typescript
    // 3. Build and send upstream request
    const upstream = await buildUpstreamRequest(provider, body, stream);
    const response = await sendUpstreamRequest(upstream, detailLogger, requestId, timeoutMs);
```

改为：

```typescript
    // 3. Build and send upstream request
    const upstream = await buildUpstreamRequest(provider, body, stream);

    // 执行注册的拦截器，允许对 upstream request 进行自定义修改（如添加缓存 header/body 字段）
    const intercepted = await interceptors.execute(upstream, {
      provider,
      c: ctx.c,
      currentUser: ctx.currentUser,
      clientIp: ctx.c.req.header('x-forwarded-for') ?? ctx.c.req.header('x-real-ip') ?? null,
      requestId: ctx.requestId,
      customModel: modelName,
      stream: ctx.stream,
      modelGroup: ctx.modelGroupName,
    });

    const response = await sendUpstreamRequest(intercepted, detailLogger, requestId, timeoutMs);
```

- [ ] **Step 2: Build to verify**

```bash
pnpm build
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/chat-completions/model-fallback.ts
git commit -m "feat(interceptor): integrate into chat-completions model fallback"
```

---

### Task 7: 集成到 `src/routes/messages/msg-fallback.ts`

**Files:**
- Modify: `src/routes/messages/msg-fallback.ts`

- [ ] **Step 1: 添加 import 并插入拦截器**

在文件顶部添加 import：

```typescript
import { interceptors } from '../../interceptor/index.js'
```

找到 fallback 循环中的 `buildMessagesUpstreamRequest` / `sendMessagesUpstreamRequest` 调用：

```typescript
    // 3. Build and send upstream request
    const upstream = await buildMessagesUpstreamRequest(provider, body, stream);
    const response = await sendMessagesUpstreamRequest(upstream, detailLogger, requestId, timeoutMs);
```

改为：

```typescript
    // 3. Build and send upstream request
    const upstream = await buildMessagesUpstreamRequest(provider, body, stream);

    // 执行注册的拦截器，允许对 upstream request 进行自定义修改（如添加缓存 header/body 字段）
    const intercepted = await interceptors.execute(upstream, {
      provider,
      c: ctx.c,
      currentUser: ctx.currentUser,
      clientIp: ctx.c.req.header('x-forwarded-for') ?? ctx.c.req.header('x-real-ip') ?? null,
      requestId: ctx.requestId,
      customModel: modelName,
      stream: ctx.stream,
      modelGroup: ctx.modelGroupName,
    });

    const response = await sendMessagesUpstreamRequest(intercepted, detailLogger, requestId, timeoutMs);
```

- [ ] **Step 2: Build to verify**

```bash
pnpm build
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/messages/msg-fallback.ts
git commit -m "feat(interceptor): integrate into messages fallback"
```

---

### Task 8: 运行完整测试套件

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```

Expected: All tests pass

- [ ] **Step 2: Run build（如果上一步未含构建）**

```bash
pnpm build
```

Expected: No errors

---

### Task 9: 最终验证 — 人工冒烟测试

- [ ] **Step 1: 启动服务并手动验证**

```bash
pnpm build && pnpm start -- --config ./test-config.json --port 4000
```

在另一个终端发送请求验证服务正常启动和运行。
