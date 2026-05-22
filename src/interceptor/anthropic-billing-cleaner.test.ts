import { describe, it, expect } from 'vitest'
import { anthropicBillingCleaner, cleanBillingHeader } from './anthropic-billing-cleaner.js'
import type { UpstreamRequest } from '../routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from './types.js'

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

// ============ 非触发条件（直接跳过） ============

describe('anthropicBillingCleaner - 触发条件', () => {
  it('should skip when provider is not anthropic', async () => {
    const upstream = makeUpstream()
    const ctx = makeCtx({ provider: { ...makeCtx().provider, provider: 'openai' } as any })
    const result = await anthropicBillingCleaner(upstream, ctx)
    expect(result).toBe(upstream)
  })

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
})

// ============ 错误处理 ============

describe('anthropicBillingCleaner - error handling', () => {
  it('should throw when text starts with billing header but has unrecognized format', () => {
    // cc_version 字段名称拼写错误
    expect(() => cleanBillingHeader(
      'x-anthropic-billing-header: cc_ver=2.1.0; cc_entrypoint=claude-vscode; cch=abc;hello'
    )).toThrow('Unrecognized anthropic billing header format')

    // 缺少 cc_entrypoint 字段
    expect(() => cleanBillingHeader(
      'x-anthropic-billing-header: cc_version=2.1.0; cch=abc;hello'
    )).toThrow('Unrecognized anthropic billing header format')
  })

  it('should throw from interceptor when header format is unrecognized', async () => {
    // 需要导入 cleanBillingHeader
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
    // 没有匹配到，应返回原对象
    expect(result).toBe(upstream)
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
