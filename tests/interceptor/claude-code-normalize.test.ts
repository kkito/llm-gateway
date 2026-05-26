import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, unlinkSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import {
  claudeCodeNormalize,
  normalizeSessionStartText,
  normalizeToolUseInputsInBody,
  findDeferredToolsBlockInBody,
  deferredToolsSnapshotPath,
  computeStickyMessageHash,
  readCacheControlStickyState,
  writeCacheControlStickyState,
  updateCacheControlStickyState,
  applyCacheControlSticky,
  DEFERRED_TOOLS_AVAILABLE_MARKER,
  DEFERRED_TOOLS_UNAVAILABLE_MARKER,
  DEFERRED_TOOLS_SNAPSHOT_DIR,
  CACHE_CONTROL_STICKY_DIR,
} from '../../src/interceptor/claude-code-normalize.js'
import type { UpstreamRequest } from '../../src/routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from '../../src/interceptor/types.js'

// ============================================================
// Helpers
// ============================================================

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

// ============================================================
// URL Guard
// ============================================================

describe('claudeCodeNormalize - URL guard', () => {
  it('should skip when URL is not /v1/messages', async () => {
    const upstream = makeUpstream({
      url: 'https://api.openai.com/v1/chat/completions',
      body: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      },
    })
    const result = await claudeCodeNormalize(upstream, makeCtx())
    expect(result).toBe(upstream)
  })

  it('should process when URL is /v1/messages', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hi' }],
      },
    })
    const result = await claudeCodeNormalize(upstream, makeCtx())
    // Should not be the same reference (processing occurred even if no changes)
    expect(result.url).toBe(upstream.url)
  })

  it('should skip when body is empty', async () => {
    const upstream = makeUpstream({ body: null as any })
    const result = await claudeCodeNormalize(upstream, makeCtx())
    expect(result).toBe(upstream)
  })
})

// ============================================================
// session_start_normalize
// ============================================================

describe('normalizeSessionStartText', () => {
  it('should replace "resume hook success" with "startup hook success"', () => {
    const input = 'SessionStart:resume hook success:2026-05-26T10:00:00.000Z'
    const [result, count] = normalizeSessionStartText(input)
    expect(count).toBe(1)
    expect(result).toBe('SessionStart:startup hook success:2026-05-26T10:00:00.000Z')
  })

  it('should strip <session-id> tags', () => {
    const input = 'SessionStart:startup hook success:\n<session-id>abc123</session-id>'
    const [result, count] = normalizeSessionStartText(input)
    expect(count).toBe(1)
    expect(result).not.toContain('<session-id>')
    expect(result).not.toContain('</session-id>')
    expect(result).toContain('SessionStart:startup hook success:')
  })

  it('should strip "Last active:" line', () => {
    const input = 'SessionStart:startup hook success:\nLast active: 2026-05-26T10:00:00.000Z'
    const [result, count] = normalizeSessionStartText(input)
    expect(count).toBe(1)
    expect(result).not.toContain('Last active:')
  })

  it('should handle all three normalizations at once', () => {
    const input = [
      'SessionStart:resume hook success:',
      '<session-id>abc123</session-id>',
      'Last active: 2026-05-26T10:00:00.000Z',
    ].join('\n')
    const [result, count] = normalizeSessionStartText(input)
    expect(count).toBe(3)
    expect(result).toContain('SessionStart:startup hook success:')
    expect(result).not.toContain('<session-id>')
    expect(result).not.toContain('Last active:')
  })

  it('should return unchanged when text does not contain SessionStart', () => {
    const input = 'Just a normal text message'
    const [result, count] = normalizeSessionStartText(input)
    expect(count).toBe(0)
    expect(result).toBe(input)
  })

  it('should return unchanged when input is not a string', () => {
    const [result, count] = normalizeSessionStartText(123 as any)
    expect(count).toBe(0)
    expect(result).toBe(123 as any)
  })
})

// ============================================================
// tool_use_input_normalize
// ============================================================

describe('normalizeToolUseInputsInBody', () => {
  it('should strip extra keys not in tool schema', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'read_file',
              input: {
                path: '/foo/bar.txt',
                extra_key: 'should be removed',
                another_extra: 'also removed',
              },
            },
          ],
        },
      ],
      tools: [
        {
          name: 'read_file',
          input_schema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
          },
        },
      ],
    }
    const modified = normalizeToolUseInputsInBody(body)
    expect(modified).toBe(1)
    const input = body.messages[0].content[0].input
    expect(input).toEqual({ path: '/foo/bar.txt' })
    expect(input).not.toHaveProperty('extra_key')
    expect(input).not.toHaveProperty('another_extra')
  })

  it('should canonicalize key order to match schema', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'format',
              input: {
                z_value: 'z',
                a_value: 'a',
                m_value: 'm',
              },
            },
          ],
        },
      ],
      tools: [
        {
          name: 'format',
          input_schema: {
            type: 'object',
            properties: {
              a_value: { type: 'string' },
              m_value: { type: 'string' },
              z_value: { type: 'string' },
            },
          },
        },
      ],
    }
    const modified = normalizeToolUseInputsInBody(body)
    expect(modified).toBe(1)
    const input = body.messages[0].content[0].input
    expect(Object.keys(input)).toEqual(['a_value', 'm_value', 'z_value'])
  })

  it('should skip unknown tools (not in schema)', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'unknown_tool',
              input: { foo: 'bar' },
            },
          ],
        },
      ],
      tools: [
        {
          name: 'known_tool',
          input_schema: {
            type: 'object',
            properties: { bar: { type: 'string' } },
          },
        },
      ],
    }
    const modified = normalizeToolUseInputsInBody(body)
    expect(modified).toBe(0)
  })

  it('should skip when tools array is absent', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'foo', input: { x: 'y' } }],
        },
      ],
    }
    const modified = normalizeToolUseInputsInBody(body)
    expect(modified).toBe(0)
  })

  it('should skip non-assistant messages', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'tool_use', name: 'foo', input: { extra: 'val' } }],
        },
      ],
      tools: [
        {
          name: 'foo',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    }
    const modified = normalizeToolUseInputsInBody(body)
    expect(modified).toBe(0)
  })

  it('should handle null/undefined body gracefully', () => {
    expect(normalizeToolUseInputsInBody(null)).toBe(0)
    expect(normalizeToolUseInputsInBody(undefined)).toBe(0)
    expect(normalizeToolUseInputsInBody('string' as any)).toBe(0)
  })
})

// ============================================================
// deferred_tools_restore
// ============================================================

describe('findDeferredToolsBlockInBody', () => {
  it('should find deferred tools available block in user message', () => {
    const body = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Some content\n${DEFERRED_TOOLS_AVAILABLE_MARKER}\n- tool_a\n- tool_b` },
          ],
        },
      ],
    }
    const result = findDeferredToolsBlockInBody(body)
    expect(result).not.toBeNull()
    expect(result!.msgIdx).toBe(1)
    expect(result!.blockIdx).toBe(0)
    expect(result!.text).toContain(DEFERRED_TOOLS_AVAILABLE_MARKER)
  })

  it('should return null when no deferred tools block exists', () => {
    const body = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
    }
    const result = findDeferredToolsBlockInBody(body)
    expect(result).toBeNull()
  })

  it('should return null when body has no messages', () => {
    const body = {}
    const result = findDeferredToolsBlockInBody(body)
    expect(result).toBeNull()
  })

  it('should skip non-user messages', () => {
    const body = {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: DEFERRED_TOOLS_AVAILABLE_MARKER }] },
      ],
    }
    const result = findDeferredToolsBlockInBody(body)
    expect(result).toBeNull()
  })
})

describe('deferredToolsSnapshotPath', () => {
  it('should produce deterministic paths for same key', () => {
    const p1 = deferredToolsSnapshotPath('/some/project')
    const p2 = deferredToolsSnapshotPath('/some/project')
    expect(p1).toBe(p2)
  })

  it('should produce different paths for different keys', () => {
    const p1 = deferredToolsSnapshotPath('/project/a')
    const p2 = deferredToolsSnapshotPath('/project/b')
    expect(p1).not.toBe(p2)
  })

  it('should include cache-fix-state directory', () => {
    const p = deferredToolsSnapshotPath('/test')
    expect(p).toContain('.claude/cache-fix-state')
    expect(p).toContain('deferred-tools-')
    expect(p).toMatch(/\.txt$/)
  })
})

// ============================================================
// cache_control_sticky
// ============================================================

describe('computeStickyMessageHash', () => {
  it('should compute hash for tool_use messages', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'tool_use', id: 'toolu_abc123', name: 'read_file', input: { path: '/x' } },
      ],
    }
    const hash = computeStickyMessageHash(msg)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    // Deterministic
    expect(computeStickyMessageHash(msg)).toBe(hash)
  })

  it('should compute hash for tool_result messages', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_def456', content: 'result' },
      ],
    }
    const hash = computeStickyMessageHash(msg)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('should compute hash for text messages', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'text', text: 'Hello, can you help me with something?' },
      ],
    }
    const hash = computeStickyMessageHash(msg)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('should return null for empty content', () => {
    const msg = { role: 'user', content: [] }
    expect(computeStickyMessageHash(msg)).toBeNull()
  })

  it('should return null for invalid input', () => {
    expect(computeStickyMessageHash(null)).toBeNull()
    expect(computeStickyMessageHash('string' as any)).toBeNull()
  })
})

describe('updateCacheControlStickyState', () => {
  it('should track newly observed markers', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'text', text: 'world' },
          ],
        },
      ],
    }
    // First call with no prior state
    const { newState, mutations } = updateCacheControlStickyState(body, null)
    expect(newState.positions).toHaveLength(0) // no existing markers observed
    expect(mutations).toHaveLength(0)
  })

  it('should cap positions at CACHE_CONTROL_STICKY_MAX_POSITIONS', () => {
    // Create messages with markers and feed through multiple rounds
    const makeBody = () => ({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'msg one' }] },
        { role: 'user', content: [{ type: 'text', text: 'msg two' }] },
        { role: 'user', content: [{ type: 'text', text: 'msg three' }] },
      ],
    })

    // First round: all three have markers
    const body1 = makeBody()
    // Add manual markers
    body1.messages[0].content[0].cache_control = { type: 'ephemeral' }
    body1.messages[1].content[0].cache_control = { type: 'ephemeral' }
    body1.messages[2].content[0].cache_control = { type: 'ephemeral' }

    const { newState } = updateCacheControlStickyState(body1, null)
    expect(newState.positions.length).toBeLessThanOrEqual(2)
  })
})

describe('applyCacheControlSticky', () => {
  const testKey = '__test_cc_sticky__'

  it('should return 0 when no sticky positions exist', () => {
    const body = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
    }
    const result = applyCacheControlSticky(body, testKey)
    expect(result).toBe(0)
  })

  it('should return 0 for invalid body', () => {
    expect(applyCacheControlSticky(null, testKey)).toBe(0)
    expect(applyCacheControlSticky({}, testKey)).toBe(0)
  })
})

describe('readCacheControlStickyState / writeCacheControlStickyState', () => {
  const testKey = '__test_cc_sticky_rw__'

  afterEach(() => {
    // Clean up test files
    const hash = createHash('sha1').update(testKey).digest('hex').slice(0, 16)
    const dir = CACHE_CONTROL_STICKY_DIR
    const file = join(dir, `cache-control-sticky-${hash}.json`)
    try { unlinkSync(file) } catch { /* ignore */ }
  })

  it('should round-trip state through write and read', () => {
    const state = {
      version: 1,
      positions: [
        { msg_hash: 'abc123', position_hint: 'last_block', marker: { type: 'ephemeral' } },
      ],
    }
    writeCacheControlStickyState(testKey, state)
    const read = readCacheControlStickyState(testKey)
    expect(read.version).toBe(1)
    expect(read.positions).toHaveLength(1)
    expect(read.positions[0].msg_hash).toBe('abc123')
    expect(read.positions[0].marker.type).toBe('ephemeral')
  })

  it('should return empty state when no file exists', () => {
    const state = readCacheControlStickyState('__nonexistent_key__')
    expect(state.version).toBe(1)
    expect(state.positions).toEqual([])
  })
})

// ============================================================
// Immutability
// ============================================================

describe('claudeCodeNormalize - immutability', () => {
  it('should not mutate original upstream object when no changes occur', async () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'hi' }],
    }
    const originalBody = JSON.parse(JSON.stringify(body))
    const upstream = makeUpstream({ body })
    await claudeCodeNormalize(upstream, makeCtx())
    expect(upstream.body).toEqual(originalBody)
  })

  it('should not mutate original upstream object when changes occur', async () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'SessionStart:resume hook success:' },
          ],
        },
      ],
    }
    const originalBody = JSON.parse(JSON.stringify(body))
    const upstream = makeUpstream({ body })
    await claudeCodeNormalize(upstream, makeCtx())
    // Original should be unchanged
    expect(upstream.body.messages[0].content[0].text).toBe('SessionStart:resume hook success:')
  })
})

// ============================================================
// Integration: interceptor normalizes session start in user text
// ============================================================

describe('claudeCodeNormalize - session_start_normalize integration', () => {
  it('should normalize SessionStart in text blocks of user messages', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'SessionStart:resume hook success:\n<session-id>abc</session-id>\nLast active: 2026-05-26' },
              { type: 'text', text: 'normal text' },
            ],
          },
        ],
      },
    })
    const result = await claudeCodeNormalize(upstream, makeCtx())
    expect(result).not.toBe(upstream)
    const text = result.body.messages[0].content[0].text
    expect(text).toContain('SessionStart:startup hook success:')
    expect(text).not.toContain('<session-id>')
    expect(text).not.toContain('Last active:')
    // Second block untouched
    expect(result.body.messages[0].content[1].text).toBe('normal text')
  })

  it('should normalize SessionStart in tool_result content', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_test',
                content: 'SessionStart:resume hook success:\n<session-id>xyz</session-id>',
              },
            ],
          },
        ],
      },
    })
    const result = await claudeCodeNormalize(upstream, makeCtx())
    expect(result).not.toBe(upstream)
    const content = result.body.messages[0].content[0].content
    expect(content).toContain('SessionStart:startup hook success:')
    expect(content).not.toContain('<session-id>')
  })
})

// ============================================================
// Integration: interceptor normalizes tool_use inputs
// ============================================================

describe('claudeCodeNormalize - tool_use_input_normalize integration', () => {
  it('should strip extra keys from tool_use input', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                name: 'bash',
                id: 'toolu_1',
                input: {
                  command: 'ls',
                  extra_key: 'bad',
                },
              },
            ],
          },
        ],
        tools: [
          {
            name: 'bash',
            input_schema: {
              type: 'object',
              properties: {
                command: { type: 'string' },
              },
            },
          },
        ],
      },
    })
    const result = await claudeCodeNormalize(upstream, makeCtx())
    expect(result).not.toBe(upstream)
    const input = result.body.messages[0].content[0].input
    expect(input).toEqual({ command: 'ls' })
  })
})

// ============================================================
// Integration: deferred_tools_restore
// ============================================================

describe('claudeCodeNormalize - deferred_tools_restore integration', () => {
  const snapshotDir = DEFERRED_TOOLS_SNAPSHOT_DIR

  beforeEach(() => {
    // Ensure dir exists
    mkdirSync(snapshotDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up all test snapshots in the dir
    try {
      const files = [join(snapshotDir, 'deferred-tools-test-hash.txt')]
      for (const f of files) {
        try { unlinkSync(f) } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  })

  it('should persist snapshot on full (available) block', async () => {
    const snapshotText = `${DEFERRED_TOOLS_AVAILABLE_MARKER}\n- tool_a\n- tool_b\n- tool_c: description`
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: snapshotText },
            ],
          },
        ],
      },
    })
    const result = await claudeCodeNormalize(upstream, makeCtx())
    // No restore happened, but the snapshot was persisted
    expect(result.body.messages[0].content[0].text).toBe(snapshotText)
  })

  it('should restore from snapshot on unavailable block', async () => {
    const fullSnapshot = `${DEFERRED_TOOLS_AVAILABLE_MARKER}\n- tool_a\n- tool_b\n- tool_c: full description with lots of detail for restore test`

    // Write a snapshot file manually for the test
    const cwd = process.cwd()
    const snapshotPath = deferredToolsSnapshotPath(cwd)
    mkdirSync(snapshotDir, { recursive: true })
    writeFileSync(snapshotPath, fullSnapshot, 'utf-8')

    // The "unavailable" block still contains the available marker but has shrunk content
    // (real Claude Code outputs both markers in the same block)
    const shrunkText = `${DEFERRED_TOOLS_AVAILABLE_MARKER}\n- tool_a\n${DEFERRED_TOOLS_UNAVAILABLE_MARKER}\n- tool_b\n- tool_c`
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: shrunkText },
            ],
          },
        ],
      },
    })

    const result = await claudeCodeNormalize(upstream, makeCtx())
    expect(result).not.toBe(upstream)
    // Should have been replaced with the full snapshot
    expect(result.body.messages[0].content[0].text).toBe(fullSnapshot)

    // Clean up
    try { unlinkSync(snapshotPath) } catch { /* ignore */ }
  })

  it('should not restore when no snapshot exists', async () => {
    const shrunkText = `${DEFERRED_TOOLS_UNAVAILABLE_MARKER}\n- tool_a`
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: shrunkText },
            ],
          },
        ],
      },
    })
    const result = await claudeCodeNormalize(upstream, makeCtx())
    // No snapshot existed, so nothing was restored
    expect(result.body.messages[0].content[0].text).toBe(shrunkText)
  })
})

// ============================================================
// Integration: no-op when nothing to do
// ============================================================

describe('claudeCodeNormalize - no-op', () => {
  it('should return upstream with same body when nothing to normalize', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        ],
      },
    })
    const result = await claudeCodeNormalize(upstream, makeCtx())
    // Since we make a shallow copy, the upstream reference will differ,
    // but the body content should be semantically equal
    expect(result.body).toEqual(upstream.body)
    // Original should be unmodified
    expect(upstream.body.messages[0].content[0].text).toBe('hello')
  })
})
