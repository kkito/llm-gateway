import { describe, it, expect } from 'vitest'
import { userModelAccessInterceptor, PermissionError } from './user-model-access.js'
import type { UpstreamRequest } from '../routes/common/upstream-request.js'
import type { UpstreamInterceptorContext } from './types.js'

function makeCtx(overrides?: Partial<UpstreamInterceptorContext>): UpstreamInterceptorContext {
  return {
    provider: {
      customModel: 'test-model',
      realModel: 'gpt-4',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      provider: 'openai',
    },
    c: {} as any,
    currentUser: null,
    clientIp: null,
    requestId: 'test-001',
    customModel: 'test-model',
    stream: false,
    ...overrides,
  }
}

const baseUpstream: UpstreamRequest = {
  url: 'https://api.openai.com/v1/chat/completions',
  headers: { Authorization: 'Bearer test-key' },
  body: { model: 'test-model', messages: [] },
}

describe('PermissionError', () => {
  it('should set correct name and message', () => {
    const err = new PermissionError('gpt-4')
    expect(err.name).toBe('PermissionError')
    expect(err.message).toBe("You don't have access to model: gpt-4")
  })
})

describe('userModelAccessInterceptor', () => {
  it('should pass through when currentUser is null', async () => {
    const ctx = makeCtx({ currentUser: null })
    const result = await userModelAccessInterceptor(baseUpstream, ctx)
    expect(result).toBe(baseUpstream)
  })

  it('should pass through when allowedModels is undefined', async () => {
    const ctx = makeCtx({ currentUser: { name: 'Alice', apikey: 'sk-lg-xxx', allowedModels: undefined } })
    const result = await userModelAccessInterceptor(baseUpstream, ctx)
    expect(result).toBe(baseUpstream)
  })

  it('should pass through when allowedModels is empty array', async () => {
    const ctx = makeCtx({ currentUser: { name: 'Alice', apikey: 'sk-lg-xxx', allowedModels: [] } })
    const result = await userModelAccessInterceptor(baseUpstream, ctx)
    expect(result).toBe(baseUpstream)
  })

  it('should pass through when model is in allowedModels', async () => {
    const ctx = makeCtx({
      currentUser: { name: 'Alice', apikey: 'sk-lg-xxx', allowedModels: ['test-model', 'gpt-4'] },
    })
    const result = await userModelAccessInterceptor(baseUpstream, ctx)
    expect(result).toBe(baseUpstream)
  })

  it('should throw PermissionError when model is not in allowedModels', async () => {
    const ctx = makeCtx({
      currentUser: { name: 'Alice', apikey: 'sk-lg-xxx', allowedModels: ['gpt-4', 'claude-3'] },
      customModel: 'gemini-pro',
    })
    await expect(userModelAccessInterceptor(baseUpstream, ctx))
      .rejects.toThrow(PermissionError)
  })

  it('should still check allowedModels when modelGroup is set and model is allowed', async () => {
    const ctx = makeCtx({
      currentUser: { name: 'Alice', apikey: 'sk-lg-xxx', allowedModels: ['claude-3'] },
      customModel: 'claude-3',
      modelGroup: 'my-group',
    })
    const result = await userModelAccessInterceptor(baseUpstream, ctx)
    expect(result).toBe(baseUpstream)
  })

  it('should throw PermissionError when modelGroup is set but model is not in allowedModels', async () => {
    const ctx = makeCtx({
      currentUser: { name: 'Alice', apikey: 'sk-lg-xxx', allowedModels: ['gpt-4'] },
      customModel: 'claude-3',
      modelGroup: 'my-group',
    })
    await expect(userModelAccessInterceptor(baseUpstream, ctx))
      .rejects.toThrow(PermissionError)
  })

  it('should not mutate upstream when passing through', async () => {
    const upstream = { ...baseUpstream, body: { ...baseUpstream.body } }
    const ctx = makeCtx({ currentUser: { name: 'Alice', apikey: 'sk-lg-xxx', allowedModels: ['test-model'] } })
    const result = await userModelAccessInterceptor(upstream, ctx)
    expect(result).toBe(upstream)
  })
})
