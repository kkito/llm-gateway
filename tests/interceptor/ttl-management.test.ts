import { describe, it, expect } from 'vitest'
import type { UpstreamRequest } from '../../src/routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from '../../src/interceptor/types.js'
import {
  ttlManagement,
  detectRequestType,
  injectTtl,
  AGENT_SDK_PREFIX,
} from '../../src/interceptor/ttl-management.js'

function makeUpstream(overrides: Partial<UpstreamRequest> = {}): UpstreamRequest {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'content-type': 'application/json' },
    body: {
      model: 'claude-sonnet-4-20250514',
      system: [],
      messages: [],
    },
    ...overrides,
  }
}

function makeCtx(overrides: Partial<UpstreamInterceptorContext> = {}): UpstreamInterceptorContext {
  return {
    provider: {
      customModel: 'claude-sonnet-4-20250514',
      realModel: 'claude-sonnet-4-20250514',
      apiKey: 'sk-test',
      baseUrl: 'https://api.anthropic.com',
      provider: 'anthropic',
    },
    c: {} as any,
    currentUser: null,
    clientIp: '127.0.0.1',
    requestId: 'test-request-id',
    customModel: 'claude-sonnet-4-20250514',
    stream: false,
    ...overrides,
  }
}

describe('detectRequestType', () => {
  it('should detect main request (no SDK prefix)', () => {
    const system = [
      { type: 'text', text: 'You are a helpful assistant.' },
    ]
    expect(detectRequestType(system)).toBe('main')
  })

  it('should detect subagent request', () => {
    const system = [
      { type: 'text', text: 'You are a helpful assistant.' },
      { type: 'text', text: AGENT_SDK_PREFIX + ' You help with coding tasks.' },
    ]
    expect(detectRequestType(system)).toBe('subagent')
  })

  it('should return main for non-array system', () => {
    expect(detectRequestType(null as any)).toBe('main')
    expect(detectRequestType(undefined as any)).toBe('main')
  })
})

describe('injectTtl', () => {
  it('should inject TTL on ephemeral cache_control without ttl', () => {
    const block = { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }
    const result = injectTtl(block, '1h')
    expect(result.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
  })

  it('should NOT modify block without cache_control', () => {
    const block = { type: 'text', text: 'hello' }
    const result = injectTtl(block, '1h')
    expect(result).toBe(block)
  })

  it('should NOT modify block with non-ephemeral cache_control', () => {
    const block = { type: 'text', text: 'hello', cache_control: { type: 'persistent' } }
    const result = injectTtl(block, '1h')
    expect(result).toBe(block)
  })

  it('should NOT modify block that already has ttl', () => {
    const block = { type: 'text', text: 'hello', cache_control: { type: 'ephemeral', ttl: '5m' } }
    const result = injectTtl(block, '1h')
    expect(result.cache_control).toEqual({ type: 'ephemeral', ttl: '5m' })
  })
})

describe('ttlManagement', () => {
  it('should inject TTL on system and message blocks', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [
          { type: 'text', text: 'You are Claude.', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'Be helpful.' },
        ],
        messages: [
          { role: 'user', content: [
            { type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } },
          ]},
        ],
      },
    })
    const result = await ttlManagement(upstream, makeCtx())
    expect((result.body.system as any[])[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
    expect((result.body.system as any[])[1].cache_control).toBeUndefined()
    expect((result.body.messages as any[])[0].content[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
  })

  it('should skip when URL is not /v1/messages', async () => {
    const upstream = makeUpstream({
      url: 'https://api.openai.com/v1/chat/completions',
      body: {
        model: 'gpt-4',
        system: [{ type: 'text', text: 'You are GPT.', cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      },
    })
    const result = await ttlManagement(upstream, makeCtx())
    expect(result).toBe(upstream)
  })

  it('should skip when body has no system or messages', async () => {
    const upstream = makeUpstream({ body: { model: 'claude-sonnet-4-20250514' } })
    const result = await ttlManagement(upstream, makeCtx())
    expect(result).toBe(upstream)
  })

  it('should handle non-array system (string)', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: 'You are Claude.',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] }],
      },
    })
    const result = await ttlManagement(upstream, makeCtx())
    expect((result.body.messages as any[])[0].content[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
  })

  it('should not double-inject TTL', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: 'You are Claude.', cache_control: { type: 'ephemeral', ttl: '5m' } }],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      },
    })
    const result = await ttlManagement(upstream, makeCtx())
    // System block already has ttl=5m, should not be overwritten
    expect((result.body.system as any[])[0].cache_control).toEqual({ type: 'ephemeral', ttl: '5m' })
  })
})
