import { describe, it, expect, beforeEach } from 'vitest'
import { opencodeSessionInterceptor, resetSessionCache } from '../../src/interceptor/opencode-session.js'
import type { UpstreamRequest } from '../../src/routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from '../../src/interceptor/types.js'

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

function makeCtx(
  overrides?: Partial<UpstreamInterceptorContext>,
  headers?: Record<string, string>,
): UpstreamInterceptorContext {
  const extra = headers ?? {}
  return {
    provider: {
      customModel: 'my-kimi',
      realModel: 'kimi-v1',
      apiKey: 'sk-test',
      baseUrl: 'https://api.opencode.ai',
      provider: 'openai',
    },
    c: {
      req: {
        header: (name: string) => {
          const h: Record<string, string> = { 'user-agent': 'test-ua/1.0', ...extra }
          return h[name.toLowerCase()] ?? null
        },
        raw: { headers: { 'user-agent': 'test-ua/1.0', ...extra } },
      },
    } as any,
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
    const ctx = makeCtx()
    const result = await opencodeSessionInterceptor(upstream, ctx)
    expect(result.headers).toHaveProperty('x-opencode-session')
    expect(result.body).toHaveProperty('prompt_cache_key')
  })

  it('should intercept when baseUrl contains opencode.ai and model is glm', async () => {
    const ctx = makeCtx({ provider: { ...makeCtx().provider, realModel: 'glm-4' } as any })
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

  it('should return upstream unchanged when baseUrl does not contain opencode.ai', async () => {
    const upstream = makeUpstream()
    const ctx = makeCtx({ provider: { ...makeCtx().provider, baseUrl: 'https://api.openai.com' } as any })
    const result = await opencodeSessionInterceptor(upstream, ctx)
    expect(result).toBe(upstream)
  })

  it('should intercept any model on opencode.ai (no model filter)', async () => {
    const upstream = makeUpstream()
    const ctx = makeCtx({ provider: { ...makeCtx().provider, realModel: 'gpt-4' } as any })
    const result = await opencodeSessionInterceptor(upstream, ctx)
    expect(result.headers).toHaveProperty('x-opencode-session')
  })

  it('should intercept even when model is empty', async () => {
    const upstream = makeUpstream()
    const ctx = makeCtx({ provider: { ...makeCtx().provider, realModel: '' } as any })
    const result = await opencodeSessionInterceptor(upstream, ctx)
    expect(result.headers).toHaveProperty('x-opencode-session')
  })

  it('should skip when baseUrl is empty', async () => {
    const upstream = makeUpstream()
    const ctx = makeCtx({ provider: { ...makeCtx().provider, baseUrl: '' } as any })
    const result = await opencodeSessionInterceptor(upstream, ctx)
    expect(result).toBe(upstream)
  })
})

describe('session 管理', () => {
  it('should generate session ID with correct format', async () => {
    const ctx = makeCtx()
    const result = await opencodeSessionInterceptor(makeUpstream(), ctx)
    const sessionId = result.headers['x-opencode-session']
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

    const originalDateNow = Date.now
    const fakeNow = Date.now() + 21 * 60 * 1000
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

    const originalDateNow = Date.now
    let fakeNow = Date.now() + 19 * 60 * 1000
    Date.now = () => fakeNow

    try {
      // 19 分钟后，应该在 TTL 内，复用 session
      const r2 = await opencodeSessionInterceptor(makeUpstream(), ctx)
      expect(r2.headers['x-opencode-session']).toBe(sessionId1)

      // 再前进 19 分钟（总共 38 分钟），由于上次续期了，应该还在 TTL 内
      fakeNow = Date.now() + 19 * 60 * 1000
      const r3 = await opencodeSessionInterceptor(makeUpstream(), ctx)
      expect(r3.headers['x-opencode-session']).toBe(sessionId1)
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

describe('指纹分档', () => {
  it('同指纹 20 分钟内复用 session', async () => {
    const ctx = makeCtx()
    const r1 = await opencodeSessionInterceptor(makeUpstream(), ctx)
    const r2 = await opencodeSessionInterceptor(makeUpstream(), ctx)
    expect(r2.headers['x-opencode-session']).toBe(r1.headers['x-opencode-session'])
  })

  it('不同 realModel 不串 session', async () => {
    const ctx = makeCtx()
    const r1 = await opencodeSessionInterceptor(makeUpstream(), ctx)
    const ctx2 = makeCtx({
      provider: { ...makeCtx().provider, realModel: 'glm-4' } as any,
    })
    const r2 = await opencodeSessionInterceptor(makeUpstream(), ctx2)
    expect(r2.headers['x-opencode-session']).not.toBe(r1.headers['x-opencode-session'])
  })

  it('session-id 头第一档：同 user 同头复用，同 IP 不同 user 隔离', async () => {
    const upstream = makeUpstream()
    const ctxA1 = makeCtx({ currentUser: { name: 'alice' } }, { 'session-id': 'abc' })
    const ctxA2 = makeCtx({ currentUser: { name: 'alice' } }, { 'session-id': 'abc' })
    const ctxB = makeCtx({ currentUser: { name: 'bob' } }, { 'session-id': 'abc' })
    const rA1 = await opencodeSessionInterceptor(upstream, ctxA1)
    const rA2 = await opencodeSessionInterceptor(upstream, ctxA2)
    const rB = await opencodeSessionInterceptor(upstream, ctxB)
    expect(rA2.headers['x-opencode-session']).toBe(rA1.headers['x-opencode-session'])
    expect(rB.headers['x-opencode-session']).not.toBe(rA1.headers['x-opencode-session'])
  })

  it('stainless 第二档：带 x-stainless-* 头加头成功且与无 stainless 隔离', async () => {
    const stainlessHeaders = {
      'x-stainless-lang': 'js',
      'x-stainless-package-version': '1.0.0',
      'x-stainless-runtime': 'node',
      'x-stainless-runtime-version': '20.0.0',
    }
    const rWith = await opencodeSessionInterceptor(makeUpstream(), makeCtx({}, stainlessHeaders))
    expect(rWith.headers['x-opencode-session']).toMatch(/^ses_/)
    const rWithout = await opencodeSessionInterceptor(makeUpstream(), makeCtx())
    expect(rWithout.headers['x-opencode-session']).not.toBe(rWith.headers['x-opencode-session'])
  })

  it('同 IP 同 UA 不同 user 隔离', async () => {
    const r1 = await opencodeSessionInterceptor(
      makeUpstream(),
      makeCtx({ currentUser: { name: 'alice' } }),
    )
    const r2 = await opencodeSessionInterceptor(
      makeUpstream(),
      makeCtx({ currentUser: { name: 'bob' } }),
    )
    expect(r2.headers['x-opencode-session']).not.toBe(r1.headers['x-opencode-session'])
  })
})
