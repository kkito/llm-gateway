import { describe, it, expect, beforeEach } from 'vitest'
import { InterceptorManager } from '../../src/interceptor/index.js'
import type { UpstreamRequest } from '../../src/routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from '../../src/interceptor/types.js'

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

  describe('interceptor registration order', () => {
    it('should execute in the order defined in server.ts', async () => {
      // 模拟 server.ts 中 6 个拦截器的注册顺序和职责
      const steps: string[] = []

      // 1. anthropic-billing-cleaner
      manager.use(async (upstream, ctx) => {
        steps.push('billing-cleaner')
        return upstream
      })

      // 2. claude-code-cache
      manager.use(async (upstream, ctx) => {
        steps.push('claude-code-cache')
        return upstream
      })

      // 3. cache-control-normalize
      manager.use(async (upstream, ctx) => {
        steps.push('cache-control-normalize')
        return upstream
      })

      // 4. ttl-management
      manager.use(async (upstream, ctx) => {
        steps.push('ttl-management')
        return upstream
      })

      // 5. opencode-session
      manager.use(async (upstream, ctx) => {
        steps.push('opencode-session')
        return upstream
      })

      // 6. qwen-cache
      manager.use(async (upstream, ctx) => {
        steps.push('qwen-cache')
        return upstream
      })

      await manager.execute(baseUpstream, mockCtx)

      expect(steps).toEqual([
        'billing-cleaner',
        'claude-code-cache',
        'cache-control-normalize',
        'ttl-management',
        'opencode-session',
        'qwen-cache',
      ])
    })

    it('should pipe body modifications through the full chain', async () => {
      // billing-cleaner: 清理 billing header
      manager.use(async (upstream, ctx) => {
        return { ...upstream, headers: { ...upstream.headers, 'x-billing': 'cleaned' } }
      })
      // claude-code-cache: 注入 cache_control
      manager.use(async (upstream, ctx) => {
        return { ...upstream, body: { ...upstream.body, cache_control: { type: 'ephemeral' } } }
      })
      // cache-control-normalize: 添加标记
      manager.use(async (upstream, ctx) => {
        return { ...upstream, headers: { ...upstream.headers, 'x-normalized': 'true' } }
      })
      // ttl-management: 注入 TTL
      manager.use(async (upstream, ctx) => {
        return { ...upstream, body: { ...upstream.body, ttl: '1h' } }
      })
      // opencode-session: 添加 session
      manager.use(async (upstream, ctx) => {
        return { ...upstream, headers: { ...upstream.headers, 'x-session': 'opencode' } }
      })
      // qwen-cache: 添加 cache key
      manager.use(async (upstream, ctx) => {
        return { ...upstream, headers: { ...upstream.headers, 'x-cache-key': 'qwen' } }
      })

      const result = await manager.execute(baseUpstream, mockCtx)

      expect(result.headers['x-billing']).toBe('cleaned')
      expect(result.body.cache_control).toEqual({ type: 'ephemeral' })
      expect(result.headers['x-normalized']).toBe('true')
      expect(result.body.ttl).toBe('1h')
      expect(result.headers['x-session']).toBe('opencode')
      expect(result.headers['x-cache-key']).toBe('qwen')
    })
  })
})
