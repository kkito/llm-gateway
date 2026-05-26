import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { anthropicBillingCleaner, cleanBillingHeader, computeFingerprint, extractRealUserMessageText, extractFirstMessageText, stabilizeFingerprint } from '../../src/interceptor/anthropic-billing-cleaner.js'
import type { UpstreamRequest } from '../../src/routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from '../../src/interceptor/types.js'

/** Compute expected fingerprint using the same algorithm as the implementation */
function expectedFingerprint(messageText: string, version: string): string {
  const salt = '59cf53e54c78'
  const indices = [4, 7, 20]
  const chars = indices.map((i) => messageText[i] || '0').join('')
  const input = `${salt}${chars}${version}`
  return createHash('sha256').update(input).digest('hex').slice(0, 3)
}

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
    c: { req: { path: '/v1/chat/completions' } } as any,
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

  it('should work regardless of provider type', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'system', content: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;正常内容。' },
        ],
      },
    })
    const ctx = makeCtx({ provider: { ...makeCtx().provider, provider: 'custom' } as any })
    const result = await anthropicBillingCleaner(upstream, ctx)
    const systemMsg = result.body.messages[0]
    expect(systemMsg.content).toBe('正常内容。')
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

  it('should handle multiple system messages, only first has billing header', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'system', content: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;第一条system。' },
          { role: 'system', content: '第二条system，无billing header。' },
          { role: 'user', content: 'hi' },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const msgs = result.body.messages
    expect(msgs[0].content).toBe('第一条system。')
    expect(msgs[1].content).toBe('第二条system，无billing header。')
  })

  it('should handle system message at end of messages array', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'system', content: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;末尾system。' },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const systemMsg = result.body.messages[1]
    expect(systemMsg.content).toBe('末尾system。')
  })

  it('should handle cch value containing dots and underscores', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=a1.b_c;内容。',
          },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const systemMsg = result.body.messages[0]
    expect(systemMsg.content).toBe('内容。')
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

  it('should handle array content where billing header is not in first block', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: [
              { type: 'text', text: '开头正常内容。' },
              { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;后面的块有billing header。' },
            ],
          },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const content = result.body.messages[0].content
    expect(content[0].text).toBe('开头正常内容。')
    expect(content[1].text).toBe('后面的块有billing header。')
  })

  it('should skip non-text blocks in array content', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: [
              { type: 'image', source: { type: 'base64', data: 'abc' } },
              { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;正文。' },
            ],
          },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const content = result.body.messages[0].content
    // image block 不应被修改
    expect(content[0].type).toBe('image')
    expect(content[1].text).toBe('正文。')
  })

  it('should handle multiple system messages with array content', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'system',
            content: [
              { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;第一条system。' },
            ],
          },
          {
            role: 'system',
            content: [
              { type: 'text', text: '第二条system无billing header。' },
            ],
          },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    expect(result.body.messages[0].content[0].text).toBe('第一条system。')
    expect(result.body.messages[1].content[0].text).toBe('第二条system无billing header。')
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

// ============ 入口路径守卫 ============

describe('anthropicBillingCleaner - entry path guard', () => {
  it('should skip when entry path is not /v1/chat/completions', async () => {
    const upstream = makeUpstream({
      url: 'https://opencode.ai/zen/go/v1/chat/completions',
      body: {
        model: 'deepseek-v4-flash-nothinking',
        messages: [
          { role: 'system', content: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;内容。' },
        ],
      },
    })
    const ctx = makeCtx({ c: { req: { path: '/v1/messages' } } as any })
    const result = await anthropicBillingCleaner(upstream, ctx)
    expect(result).toBe(upstream)
  })

  it('should process when entry path is /v1/chat/completions', async () => {
    const upstream = makeUpstream({
      url: 'https://api.anthropic.com/v1/messages',
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'system', content: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;内容。' },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const systemMsg = result.body.messages[0]
    expect(systemMsg.content).toBe('内容。')
  })

  it('should skip when body has no messages even if entry path is /v1/chat/completions', async () => {
    const upstream = makeUpstream({
      url: 'https://api.anthropic.com/v1/messages',
      body: { model: 'claude-sonnet-4-20250514' },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    expect(result).toBe(upstream)
  })

  it('should process deepseek via non-standard upstream URL when entry is /v1/chat/completions', async () => {
    const upstream = makeUpstream({
      url: 'https://opencode.ai/zen/go/v1/chat/completions',
      body: {
        model: 'deepseek-v4-flash-nothinking',
        messages: [
          { role: 'system', content: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=claude-vscode; cch=abc;内容。' },
        ],
      },
    })
    const ctx = makeCtx({ provider: { ...makeCtx().provider, provider: 'deepseek' } as any })
    const result = await anthropicBillingCleaner(upstream, ctx)
    const systemMsg = result.body.messages[0]
    expect(systemMsg.content).toBe('内容。')
  })
})

// ============ Fingerprint Stabilization ============

describe('computeFingerprint', () => {
  it('should compute correct 3-char hex fingerprint', () => {
    const result = computeFingerprint('Hello, Claude!', '2.1.87')
    expect(result).toMatch(/^[0-9a-f]{3}$/)
    expect(result).toBe(expectedFingerprint('Hello, Claude!', '2.1.87'))
  })

  it('should produce same result for same input', () => {
    const r1 = computeFingerprint('Same text every time', '2.1.87')
    const r2 = computeFingerprint('Same text every time', '2.1.87')
    expect(r1).toBe(r2)
  })

  it('should produce different result for different input', () => {
    // Use texts with different characters at fingerprint indices [4, 7, 20]
    const r1 = computeFingerprint('ABCDE fghij klmno pqrst uvwxy z', '2.1.87')
    const r2 = computeFingerprint('ZZZZZ fghij klmno pqrst uvwxy z', '2.1.87')
    expect(r1).not.toBe(r2)
  })
})

describe('extractRealUserMessageText', () => {
  it('should skip system-reminder blocks', () => {
    const messages = [
      { role: 'user', content: '<system-reminder>remember context</system-reminder>' },
      { role: 'user', content: 'real question here' },
    ]
    expect(extractRealUserMessageText(messages)).toBe('real question here')
  })

  it('should return first non-system-reminder text', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: '<system-reminder>skip this' }] },
      { role: 'user', content: [{ type: 'text', text: 'real content' }] },
    ]
    expect(extractRealUserMessageText(messages)).toBe('real content')
  })

  it('should handle string content', () => {
    const messages = [
      { role: 'user', content: 'plain string' },
    ]
    expect(extractRealUserMessageText(messages)).toBe('plain string')
  })
})

describe('extractFirstMessageText', () => {
  it('should return text from first user message', () => {
    const messages = [
      { role: 'user', content: 'first message' },
      { role: 'assistant', content: 'response' },
    ]
    expect(extractFirstMessageText(messages)).toBe('first message')
  })

  it('should return empty string if first message is not user', () => {
    const messages = [
      { role: 'system', content: 'system prompt' },
    ]
    expect(extractFirstMessageText(messages)).toBe('')
  })
})

describe('anthropicBillingCleaner - fingerprint stabilization', () => {
  // Helper: build the billing header text with a given cc_version.
  // The cc_version appears both in the billing header prefix AND as
  // remaining metadata after the prefix, simulating real Claude Code format.
  const billingBlock = (ccVersion: string, afterText: string = 'You are Claude.') =>
    `x-anthropic-billing-header: cc_version=${ccVersion}; cc_entrypoint=claude-vscode; cch=a8c1e;cc_version=${ccVersion};cc_entrypoint=claude-vscode;cch=a8c1e;${afterText}`

  it('should stabilize fingerprint when cc_version has meta-block drift', async () => {
    const baseVersion = '2.1.87'
    // Simulate meta-block drift: the old fingerprint was computed from a
    // system-reminder message (extractFirstMessageText path), but the stable
    // fingerprint should be based on the real user text.
    const systemReminderText = '<system-reminder>session context metadata</system-reminder>'
    const realUserText = 'What is the capital of France?'
    const wrongFingerprint = expectedFingerprint(systemReminderText, baseVersion)
    // The real text produces a different fingerprint
    const correctFp = expectedFingerprint(realUserText, baseVersion)
    expect(wrongFingerprint).not.toBe(correctFp)
    const ccVersion = `${baseVersion}.${wrongFingerprint}`
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: billingBlock(ccVersion, 'You are Claude.') }],
        messages: [
          { role: 'user', content: systemReminderText },
          { role: 'user', content: realUserText },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const systemBlock = result.body.system[0]
    const text = systemBlock.text
    expect(text).not.toContain('x-anthropic-billing-header:')
    // The fingerprint should be stabilized to the correct one
    expect(text).toBe(`cc_version=${baseVersion}.${correctFp};cc_entrypoint=claude-vscode;cch=a8c1e;You are Claude.`)
    expect(text).not.toContain(`cc_version=${ccVersion}`)
  })

  it('should skip when no x-anthropic-billing-header block exists', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: 'Just a normal system prompt.' }],
        messages: [
          { role: 'user', content: 'hi' },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    expect(result).toBe(upstream)
  })

  it('should skip when cc_version has no fingerprint (no dot parts)', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: billingBlock('2.1.87', 'You are Claude.') }],
        messages: [
          { role: 'user', content: 'hi' },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    // Billing header is cleaned, but no fingerprint stabilization
    const systemBlock = result.body.system[0]
    const text = systemBlock.text
    expect(text).not.toContain('x-anthropic-billing-header:')
    // cc_version stays as-is (no `.xxx` suffix, unchanged from after billing header cleanup)
    // After billing header cleanup, remaining text contains cc_version=2.1.87 (without 4th dot part)
    expect(text).toBe('cc_version=2.1.87;cc_entrypoint=claude-vscode;cch=a8c1e;You are Claude.')
  })

  it('should skip when fingerprint is already stable', async () => {
    const userText = 'Tell me about AI.'
    const baseVersion = '2.1.87'
    const correctFp = expectedFingerprint(userText, baseVersion)
    const ccVersion = `${baseVersion}.${correctFp}`
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: billingBlock(ccVersion, 'You are Claude.') }],
        messages: [
          { role: 'user', content: userText },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    // Billing header cleaned, fingerprint unchanged (already stable)
    const text = result.body.system[0].text
    expect(text).not.toContain('x-anthropic-billing-header:')
    // Should still have the same cc_version with the correct fingerprint
    expect(text).toBe(`cc_version=${baseVersion}.${correctFp};cc_entrypoint=claude-vscode;cch=a8c1e;You are Claude.`)
  })

  it('should handle round-trip verification failure safely (when fingerprint does not match either real or legacy path)', async () => {
    // Use a fingerprint that won't match either real text or messages[0]
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: billingBlock('2.1.87.999', 'You are Claude.') }],
        messages: [
          { role: 'user', content: 'Some random text that does not produce fp 999' },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    // Billing header is still cleaned (that always applies), but fingerprint stays as-is
    const text = result.body.system[0].text
    expect(text).not.toContain('x-anthropic-billing-header:')
    // The cc_version fingerprint should remain unchanged ("999") because round-trip failed
    expect(text).toBe('cc_version=2.1.87.999;cc_entrypoint=claude-vscode;cch=a8c1e;You are Claude.')
  })

  it('should work with real user message path (v2.1.108+)', async () => {
    // For v2.1.108+, the first user message is a system-reminder block,
    // and the real user text is later. The old fingerprint was computed from
    // the system-reminder text (legacy path).
    const userText = 'Hello, can you help me?'
    const baseVersion = '2.1.108'
    const systemReminderText = '<system-reminder>protocol context</system-reminder>'
    // Old fingerprint computed from system-reminder (legacy path matches)
    const wrongFingerprint = expectedFingerprint(systemReminderText, baseVersion)
    const correctFp = expectedFingerprint(userText, baseVersion)
    expect(wrongFingerprint).not.toBe(correctFp)
    const ccVersion = `${baseVersion}.${wrongFingerprint}`
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        system: [{ type: 'text', text: billingBlock(ccVersion, 'You are Claude.') }],
        messages: [
          { role: 'user', content: '<system-reminder>protocol context</system-reminder>' },
          { role: 'user', content: userText },
        ],
      },
    })
    const result = await anthropicBillingCleaner(upstream, makeCtx())
    const systemBlock = result.body.system[0]
    const text = systemBlock.text
    expect(text).not.toContain('x-anthropic-billing-header:')
    // After billing header cleanup and fp stabilization, cc_version should have corrected fingerprint
    expect(text).toBe(`cc_version=${baseVersion}.${correctFp};cc_entrypoint=claude-vscode;cch=a8c1e;You are Claude.`)
    expect(text).not.toContain(`cc_version=${ccVersion}`)
  })
})
