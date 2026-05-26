import { describe, it, expect } from 'vitest'
import type { UpstreamRequest } from '../../src/routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from '../../src/interceptor/types.js'
import {
  cacheControlNormalize,
  stripCacheControlMarkers,
  countUserCacheControlMarkers,
} from '../../src/interceptor/cache-control-normalize.js'

function makeUpstream(overrides: Partial<UpstreamRequest> = {}): UpstreamRequest {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': 'sk-test' },
    body: { model: 'claude-sonnet-4-20250514', messages: [] },
    ...overrides,
  }
}

function makeCtx(): UpstreamInterceptorContext {
  return {
    provider: {
      name: 'test',
      provider: 'anthropic',
      apiKey: 'sk-test',
      baseUrl: 'https://api.anthropic.com',
      customModel: 'my-claude',
      realModel: 'claude-sonnet-4-20250514',
    },
    c: { req: { path: '/v1/messages' } } as any,
    currentUser: { name: 'test-user' },
    clientIp: '127.0.0.1',
    requestId: 'test-req-123',
    customModel: 'my-claude',
    stream: false,
  }
}

describe('cacheControlNormalize', () => {
  describe('stripCacheControlMarkers', () => {
    it('should remove cache_control from a content block', () => {
      const msg = {
        role: 'user',
        content: [
          { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } },
        ],
      }
      const count = stripCacheControlMarkers(msg)
      expect(count).toBe(1)
      expect(msg.content[0].cache_control).toBeUndefined()
    })

    it('should handle multiple blocks with cache_control', () => {
      const msg = {
        role: 'user',
        content: [
          { type: 'text', text: 'a', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'b' },
          { type: 'text', text: 'c', cache_control: { type: 'ephemeral' } },
        ],
      }
      const count = stripCacheControlMarkers(msg)
      expect(count).toBe(2)
      expect(msg.content[0].cache_control).toBeUndefined()
      expect(msg.content[1].cache_control).toBeUndefined()
      expect(msg.content[2].cache_control).toBeUndefined()
    })

    it('should skip non-user messages', () => {
      const msg = {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }],
      }
      const count = stripCacheControlMarkers(msg)
      expect(count).toBe(0)
    })

    it('should handle messages without content array', () => {
      const msg = { role: 'user', content: 'string content' }
      const count = stripCacheControlMarkers(msg)
      expect(count).toBe(0)
    })

    it('should handle null/undefined message', () => {
      expect(stripCacheControlMarkers(null)).toBe(0)
      expect(stripCacheControlMarkers(undefined)).toBe(0)
    })
  })

  describe('countUserCacheControlMarkers', () => {
    it('should count cache_control markers in user messages', () => {
      const body = {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'a', cache_control: { type: 'ephemeral' } }] },
          { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
          { role: 'user', content: [{ type: 'text', text: 'c', cache_control: { type: 'ephemeral' } }] },
        ],
      }
      expect(countUserCacheControlMarkers(body)).toBe(2)
    })

    it('should return 0 when no cache_control markers exist', () => {
      const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] }
      expect(countUserCacheControlMarkers(body)).toBe(0)
    })

    it('should return 0 when body has no messages', () => {
      expect(countUserCacheControlMarkers({})).toBe(0)
    })

    it('should return 0 when body is null/undefined', () => {
      expect(countUserCacheControlMarkers(null)).toBe(0)
      expect(countUserCacheControlMarkers(undefined)).toBe(0)
    })
  })

  describe('full interceptor', () => {
    it('should strip all cache_control and apply canonical one at last user message', async () => {
      const upstream = makeUpstream({
        body: {
          model: 'claude-sonnet-4-20250514',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'first', cache_control: { type: 'ephemeral' } },
              ],
            },
            { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'second' },
                { type: 'text', text: 'third', cache_control: { type: 'ephemeral' } },
              ],
            },
          ],
        },
      })
      const result = await cacheControlNormalize(upstream, makeCtx())
      // First user message: cache_control stripped, no canonical
      expect(result.body.messages[0].content[0].cache_control).toBeUndefined()
      // Last user message: cache_control stripped from third, canonical on last
      expect(result.body.messages[2].content[0].cache_control).toBeUndefined()
      expect(result.body.messages[2].content[1].cache_control).toEqual({ type: 'ephemeral' })
    })

    it('should skip when no cache_control markers exist', async () => {
      const upstream = makeUpstream({
        body: {
          model: 'claude-sonnet-4-20250514',
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'hi' }] },
          ],
        },
      })
      const result = await cacheControlNormalize(upstream, makeCtx())
      expect(result).toBe(upstream)
    })

    it('should skip when entry path is not /v1/messages', async () => {
      const upstream = makeUpstream({
        url: 'https://api.openai.com/v1/chat/completions',
        body: {
          model: 'gpt-4',
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] },
          ],
        },
      })
      const ctx = makeCtx()
      ctx.c = { req: { path: '/v1/chat/completions' } } as any
      const result = await cacheControlNormalize(upstream, ctx)
      expect(result).toBe(upstream)
    })

    it('should handle empty messages', async () => {
      const upstream = makeUpstream({ body: { model: 'claude-sonnet-4-20250514', messages: [] } })
      const result = await cacheControlNormalize(upstream, makeCtx())
      expect(result).toBe(upstream)
    })

    it('should handle body without messages', async () => {
      const upstream = makeUpstream({ body: { model: 'claude-sonnet-4-20250514' } })
      const result = await cacheControlNormalize(upstream, makeCtx())
      expect(result).toBe(upstream)
    })
  })
})
