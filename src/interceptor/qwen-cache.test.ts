import { describe, it, expect } from 'vitest'
import {
  addCacheControlToTools,
  addCacheControlToLastMessage,
  addCacheControlToSystemMessages,
  qwenCacheInterceptor,
} from './qwen-cache.js'
import type { UpstreamRequest } from '../routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from './types.js'

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
    const messages = [{ role: 'user' }] as any[]
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
    expect(result).toBe(messages)
  })
})

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
    const ctx = makeCtx()
    // Override provider.realModel
    const modifiedCtx = { ...ctx, provider: { ...ctx.provider, realModel: 'gpt-4' } }
    const result = await qwenCacheInterceptor(upstream, modifiedCtx)
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

  it('should add cache_control to tools, last message, and system', async () => {
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
