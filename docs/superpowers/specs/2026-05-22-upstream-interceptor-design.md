# Upstream Interceptor 框架 — 设计文档

## 背景

不同大模型服务提供商对缓存触发有各自的方式：有的通过 HTTP header（如 `x-tt-enable-cache`），有的需要在请求 body 中加特定字段，有的需要在 prompt 前后加固定标记。这些逻辑因服务提供商而异，甚至同一个提供商的不同模型也有不同策略。

当前系统的请求发送流程是线性的——handler 解析请求 → `buildUpstreamRequest` 构建最终请求 → `sendUpstreamRequest` 发送。中间没有可插拔的修改点，用户无法在请求发送前注入自定义的修改逻辑。

需要一个拦截器（Interceptor）框架，让用户在 `buildUpstreamRequest` 完成之后、`sendUpstreamRequest` 发送之前，对已构建好的完整上游请求（URL、Headers、Body）进行自定义修改，且拦截器能获取到完整的上下文信息（模型配置、服务商信息、客户端请求信息、用户信息等）。

---

## 设计

### 1. 数据模型

#### 1.1 `UpstreamRequest`（现有）

```typescript
// src/routes/chat-completions/upstream-request.ts 中已有的类型
export interface UpstreamRequest {
  url: string;                      // 上游 API 的完整请求 URL
  headers: Record<string, string>;  // 请求头（含认证信息）
  body: any;                        // 最终要发送的请求体（已格式转换、参数合并）
}
```

拦截器接收并返回这个完整结构。

#### 1.2 拦截器上下文

```typescript
// src/interceptor/types.ts

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
```

### 2. 拦截器管理器

```typescript
// src/interceptor/index.ts

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

### 3. 集成点

接口器在 `buildUpstreamRequest` 完成之后、`sendUpstreamRequest` 发送之前执行。涉及 **4 个文件** 的修改，每个文件改动模式相同：

#### 3.1 chat-completions 非 fallback 路径

```typescript
// src/routes/chat-completions/handler.ts 中已有的逻辑：

// 构建和发送上游请求
const upstream = await buildUpstreamRequest(provider, body, stream)
// ⬇️ [新增] 执行拦截器
const intercepted = await interceptors.execute(upstream, {
  provider,
  c,
  currentUser,
  clientIp: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null,
  requestId,
  customModel,
  stream,
  modelGroup,
})
const response = await sendUpstreamRequest(intercepted, detailLogger, requestId, timeoutMs)
```

#### 3.2 messages 非 fallback 路径

```typescript
// src/routes/messages/handler.ts 中已有的逻辑：

const upstream = await buildMessagesUpstreamRequest(provider, body, stream)
// ⬇️ [新增] 执行拦截器
const intercepted = await interceptors.execute(upstream, {
  provider, c, currentUser,
  clientIp: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null,
  requestId, customModel, stream, modelGroup,
})
const response = await sendMessagesUpstreamRequest(intercepted, detailLogger, requestId, timeoutMs)
```

#### 3.3 chat-completions fallback 路径

```typescript
// src/routes/chat-completions/model-fallback.ts 中已有的逻辑：

const upstream = await buildUpstreamRequest(provider, body, stream)
// ⬇️ [新增] 执行拦截器
const intercepted = await interceptors.execute(upstream, {
  provider, c: ctx.c, currentUser: ctx.currentUser,
  clientIp: ctx.c.req.header('x-forwarded-for') ?? ctx.c.req.header('x-real-ip') ?? null,
  requestId: ctx.requestId, customModel: modelName, stream: ctx.stream, modelGroup: ctx.modelGroupName,
})
const response = await sendUpstreamRequest(intercepted, detailLogger, requestId, timeoutMs)
```

#### 3.4 messages fallback 路径

```typescript
// src/routes/messages/msg-fallback.ts 中已有的逻辑：

const upstream = await buildMessagesUpstreamRequest(provider, body, stream)
// ⬇️ [新增] 执行拦截器
const intercepted = await interceptors.execute(upstream, {
  provider, c: ctx.c, currentUser: ctx.currentUser,
  clientIp: ctx.c.req.header('x-forwarded-for') ?? ctx.c.req.header('x-real-ip') ?? null,
  requestId: ctx.requestId, customModel: modelName, stream: ctx.stream, modelGroup: ctx.modelGroupName,
})
const response = await sendMessagesUpstreamRequest(intercepted, detailLogger, requestId, timeoutMs)
```

### 4. 拦截器生命周期示意图

```
┌─────────────────────────────────────────────────────────────────────┐
│  Handler (chat-completions / messages)                              │
│                                                                     │
│  1. 解析请求 body，匹配 provider                                     │
│  2. 限流检查                                                        │
│  3. buildUpstreamRequest()                                          │
│     ├─ 替换 model 为 realModel                                      │
│     ├─ 格式转换（如 OpenAI ↔ Anthropic）                             │
│     └─ 合并默认参数（defaultParams）                                 │
│                        ↓                                            │
│  4. interceptors.execute(upstream, ctx)  ←━ 新增                    │
│     ├─ 拦截器 #1: 添加缓存 header                                   │
│     ├─ 拦截器 #2: 改写 body（仅对特定 provider 生效）               │
│     └─ 拦截器 #N: ...                                               │
│                        ↓                                            │
│  5. sendUpstreamRequest(intercepted)                                │
│     └─ fetch 发送修改后的 URL/Headers/Body                           │
│                                                                     │
│  6. 处理响应（流式 / 非流式）                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/interceptor/types.ts` | 新增 | `UpstreamInterceptor` 和 `UpstreamInterceptorContext` 类型定义 |
| `src/interceptor/index.ts` | 新增 | `InterceptorManager` 类和全局实例 `interceptors` |
| `src/routes/chat-completions/handler.ts` | 修改 | 在 `buildUpstreamRequest` 和 `sendUpstreamRequest` 之间插入拦截器执行 |
| `src/routes/messages/handler.ts` | 修改 | 同上 |
| `src/routes/chat-completions/model-fallback.ts` | 修改 | 同上 |
| `src/routes/messages/msg-fallback.ts` | 修改 | 同上 |

---

## 测试计划

| 测试文件 | 测试内容 |
|----------|----------|
| `src/interceptor/index.test.ts` | `InterceptorManager` 单元测试：注册、链式执行（按序透传 body）、无拦截器时透传、clear() 方法 |
| `src/interceptor/integration.test.ts` | 集成测试：拦截器实际修改 upstream 后，handler 是否按预期发送修改后的内容 |

---

## 使用示例

```typescript
// 在项目入口（如 src/index.ts）或用户自定义的文件中注册拦截器

import { interceptors } from './interceptor/index.js'

// 示例 1：为所有 Anthropic 请求统一添加缓存标记
interceptors.use(async (upstream, ctx) => {
  if (ctx.provider.provider !== 'anthropic') return upstream

  return {
    ...upstream,
    headers: {
      ...upstream.headers,
      'anthropic-cache': 'enable',
    },
    body: {
      ...upstream.body,
      // system 消息末尾添加缓存提示语
      system: upstream.body.system
        ? upstream.body.system + '\n[PROMPT_CACHE]'
        : '[PROMPT_CACHE]',
    },
  }
})

// 示例 2：为特定 OpenAI 模型对齐 max_tokens 以提高缓存命中率
interceptors.use(async (upstream, ctx) => {
  if (ctx.provider.customModel !== 'my-gpt4-biz') return upstream

  return {
    ...upstream,
    headers: {
      ...upstream.headers,
      'x-tt-enable-cache': '1',
    },
    body: {
      ...upstream.body,
      max_tokens: 4096,  // 固定值，提高缓存命中率
    },
  }
})

// 示例 3：根据客户端 IP 决定是否启用缓存
interceptors.use(async (upstream, ctx) => {
  if (!ctx.clientIp?.startsWith('10.')) return upstream // 仅内网启用

  return {
    ...upstream,
    body: {
      ...upstream.body,
      extra_body: { ...upstream.body.extra_body, cache: true },
    },
  }
})
```

---

## 注意事项

1. **拦截时机**：在 `buildUpstreamRequest` 之后执行，拦截器看到的是完整的上游请求（已替换 realModel、已格式转换、已合并默认参数）。URL 已通过 `Provider.buildUrl()` 处理，headers 已通过 `Provider.buildHeaders()` 处理。
2. **链式执行**：多个拦截器按注册顺序执行，前一个的返回值传给后一个。拦截器应不修改入参，而是返回新对象。
3. **幂等安全**：拦截器应保持幂等，不修改 `upstream` 入参对象本身，而是通过展开运算符（`{ ...upstream }`）创建新对象。
4. **向前兼容**：不注册拦截器时，`interceptors.execute()` 直接透传原对象，行为完全不变。
5. **代码中注册**：通过 `import` 方式注册，走 TypeScript 编译流程，类型安全。
