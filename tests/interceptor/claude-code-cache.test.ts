import { describe, it, expect } from 'vitest'
import type { UpstreamRequest } from '../../src/routes/chat-completions/upstream-request.js'
import type { UpstreamInterceptorContext } from '../../src/interceptor/types.js'
import {
  TRAILING_SMOOSH,
  splitSmooshedReminders,
  sortSkillsBlock,
  sortDeferredToolsBlock,
  isSkillsBlock,
  isDeferredToolsBlock,
  sortSystemBlocks,
  sortTools,
  stripClearArtifacts,
  isRelocatableBlock,
  getBlockType,
  fixBlockText,
  freshSessionSort,
  isContinueTrailerBlock,
  isBookkeepingReminder,
  stripContentBlocks,
  claudeCodeCache,
} from '../../src/interceptor/claude-code-cache.js'

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
    requestId: 'test-004',
    customModel: 'my-claude',
    stream: false,
    ...overrides,
  }
}

// ============================================================
// Sub-step 1: smoosh-split
// ============================================================
describe('sub-step 1: smoosh-split', () => {
  describe('TRAILING_SMOOSH', () => {
    it('should match a <system-reminder> at the end of a string', () => {
      const s = 'some content\n\n<system-reminder>\nSkill completed successfully\n</system-reminder>'
      const m = s.match(TRAILING_SMOOSH)
      expect(m).not.toBeNull()
      expect(m![1]).toBe('<system-reminder>\nSkill completed successfully\n</system-reminder>')
    })

    it('should match with trailing whitespace', () => {
      const s = 'some content\n\n<system-reminder>\nReminder text\n</system-reminder>   '
      const m = s.match(TRAILING_SMOOSH)
      expect(m).not.toBeNull()
    })

    it('should not match when text follows the closing tag', () => {
      const s = '<system-reminder>\ncontent\n</system-reminder>\nmore text'
      const m = s.match(TRAILING_SMOOSH)
      expect(m).toBeNull()
    })

    it('should not match partial reminder without closing tag', () => {
      const s = '<system-reminder>\ncontent'
      const m = s.match(TRAILING_SMOOSH)
      expect(m).toBeNull()
    })
  })

  describe('splitSmooshedReminders', () => {
    it('should peel trailing reminders from tool_result content', () => {
      const messages = [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              content: 'some result\n\n<system-reminder>\nSkill done\n</system-reminder>',
            },
          ],
        },
      ]
      const { messages: result, stats } = splitSmooshedReminders(messages)
      expect(stats).toEqual({ peeled: 1 })
      expect(result[0].content[0].content).toBe('some result')
      expect(result[0].content[1]).toEqual({ type: 'text', text: '<system-reminder>\nSkill done\n</system-reminder>' })
    })

    it('should peel multiple trailing reminders from tool_result content', () => {
      const messages = [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              content: 'data\n\n<system-reminder>\nR1\n</system-reminder>\n\n<system-reminder>\nR2\n</system-reminder>',
            },
          ],
        },
      ]
      const { messages: result, stats } = splitSmooshedReminders(messages)
      expect(stats).toEqual({ peeled: 2 })
      expect(result[0].content[0].content).toBe('data')
      expect(result[0].content[1].text).toContain('R1')
      expect(result[0].content[2].text).toContain('R2')
    })

    it('should not modify tool_result without trailing reminder', () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'tool_result', content: 'plain result without reminder' },
          ],
        },
      ]
      const { messages: result, stats } = splitSmooshedReminders(messages)
      expect(stats).toBeNull()
      expect(result).toBe(messages)
    })

    it('should not modify non-user messages', () => {
      const messages = [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_result',
              content: 'result\n\n<system-reminder>\nReminder\n</system-reminder>',
            },
          ],
        },
      ]
      const { messages: result, stats } = splitSmooshedReminders(messages)
      expect(stats).toBeNull()
      expect(result).toBe(messages)
    })

    it('should handle messages with non-array content', () => {
      const messages = [{ role: 'user', content: 'string content' }]
      const { messages: result, stats } = splitSmooshedReminders(messages)
      expect(stats).toBeNull()
      expect(result).toBe(messages)
    })

    it('should handle empty messages array', () => {
      const { messages: result, stats } = splitSmooshedReminders([])
      expect(stats).toBeNull()
      expect(result).toEqual([])
    })

    it('should handle non-array input', () => {
      const { messages: result, stats } = splitSmooshedReminders(null as any)
      expect(stats).toBeNull()
      expect(result).toBeNull()
    })

    it('should only mutate when at least one reminder was peeled', () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'tool_result', content: 'no reminder here' },
          ],
        },
      ]
      const { messages: result, stats } = splitSmooshedReminders(messages)
      expect(stats).toBeNull()
      expect(result).toBe(messages)
    })
  })
})

// ============================================================
// Sub-step 2: sort-stabilization
// ============================================================
describe('sub-step 2: sort-stabilization', () => {
  describe('isSkillsBlock', () => {
    it('should detect a skills block', () => {
      const text = '<system-reminder>\nUser-invocable skills\n- item a\n- item b\n</system-reminder>'
      expect(isSkillsBlock(text)).toBe(true)
    })

    it('should return false for non-skills text', () => {
      expect(isSkillsBlock('just some text')).toBe(false)
    })

    it('should return false for non-string input', () => {
      expect(isSkillsBlock(null as any)).toBe(false)
      expect(isSkillsBlock(undefined as any)).toBe(false)
    })
  })

  describe('isDeferredToolsBlock', () => {
    it('should detect a deferred tools block', () => {
      const text = '<system-reminder>\nThe following deferred tools are now available\n- tool1\n</system-reminder>'
      expect(isDeferredToolsBlock(text)).toBe(true)
    })

    it('should return false for non-deferred text', () => {
      expect(isDeferredToolsBlock('just some text')).toBe(false)
    })

    it('should return false for non-string input', () => {
      expect(isDeferredToolsBlock(null as any)).toBe(false)
    })
  })

  describe('sortSkillsBlock', () => {
    it('should sort skill entries within a skills block', () => {
      const input = 'header text\n\n- zebra tool\n- apple tool\n- mango tool\n</system-reminder>'
      const result = sortSkillsBlock(input)
      expect(result).toContain('- apple tool\n- mango tool\n- zebra tool')
    })

    it('should not modify a block without skills pattern', () => {
      const input = 'just some text without skills format'
      expect(sortSkillsBlock(input)).toBe(input)
    })

    it('should not change already sorted entries', () => {
      const input = 'header\n\n- aaa\n- bbb\n- ccc\n</system-reminder>'
      expect(sortSkillsBlock(input)).toBe(input)
    })
  })

  describe('sortDeferredToolsBlock', () => {
    it('should sort tool names within a deferred tools block', () => {
      const input = '<system-reminder>\nThe following deferred tools are now available:\nz-tool\na-tool\nm-tool\n</system-reminder>'
      const result = sortDeferredToolsBlock(input)
      expect(result).toContain('a-tool\nm-tool\nz-tool')
    })

    it('should not modify a block without deferred tools pattern', () => {
      const input = 'just text'
      expect(sortDeferredToolsBlock(input)).toBe(input)
    })
  })

  describe('sortSystemBlocks', () => {
    it('should sort skills blocks within system array', () => {
      const system = [
        { type: 'text', text: 'normal text' },
        { type: 'text', text: 'User-invocable skills header\n\n- zebra\n- apple\n</system-reminder>' },
      ]
      const result = sortSystemBlocks(system)
      expect(result[1].text).toContain('- apple\n- zebra')
    })

    it('should sort deferred tools blocks within system array', () => {
      const system = [
        { type: 'text', text: '<system-reminder>\nThe following deferred tools are now available:\nz-tool\na-tool\n</system-reminder>' },
      ]
      const result = sortSystemBlocks(system)
      expect(result[0].text).toContain('a-tool\nz-tool')
    })

    it('should not modify system blocks of non-text type', () => {
      const system = [{ type: 'image', source: 'foo' }]
      const result = sortSystemBlocks(system)
      expect(result).toBe(system)
    })
  })

  describe('sortTools', () => {
    it('should sort tools by name', () => {
      const tools = [
        { name: 'z-tool', description: 'last' },
        { name: 'a-tool', description: 'first' },
      ]
      const result = sortTools(tools)
      expect(result[0].name).toBe('a-tool')
      expect(result[1].name).toBe('z-tool')
    })

    it('should not modify empty tools array', () => {
      expect(sortTools([])).toEqual([])
    })

    it('should not modify undefined tools', () => {
      expect(sortTools(undefined)).toBeUndefined()
    })
  })
})

// ============================================================
// Sub-step 3: fresh-session-sort
// ============================================================
describe('sub-step 3: fresh-session-sort', () => {
  describe('stripClearArtifacts', () => {
    it('should remove blocks starting with <local-command-caveat>', () => {
      const content = [
        { type: 'text', text: '<local-command-caveat>some caveat' },
        { type: 'text', text: 'normal text' },
      ]
      const result = stripClearArtifacts(content)
      expect(result).toHaveLength(1)
      expect(result[0].text).toBe('normal text')
    })

    it('should remove blocks starting with <command-name>', () => {
      const content = [
        { type: 'text', text: '<command-name>echo' },
        { type: 'text', text: 'keep this' },
      ]
      const result = stripClearArtifacts(content)
      expect(result).toHaveLength(1)
      expect(result[0].text).toBe('keep this')
    })

    it('should remove blocks starting with <local-command-stdout>', () => {
      const content = [
        { type: 'text', text: '<local-command-stdout>output' },
      ]
      const result = stripClearArtifacts(content)
      expect(result).toHaveLength(0)
    })

    it('should return original array when no artifacts found', () => {
      const content = [{ type: 'text', text: 'clean text' }]
      const result = stripClearArtifacts(content)
      expect(result).toBe(content)
    })

    it('should handle empty content', () => {
      expect(stripClearArtifacts([])).toEqual([])
    })
  })

  describe('isRelocatableBlock', () => {
    it('should detect hooks block', () => {
      const text = '<system-reminder>\nhook success\n</system-reminder>'
      expect(isRelocatableBlock(text)).toBe(true)
    })

    it('should detect skills block', () => {
      const text = '<system-reminder>\nThe following skills are available\n- skill1\n</system-reminder>'
      expect(isRelocatableBlock(text)).toBe(true)
    })

    it('should detect deferred tools block', () => {
      const text = '<system-reminder>\nThe following deferred tools are now available\n- tool1\n</system-reminder>'
      expect(isRelocatableBlock(text)).toBe(true)
    })

    it('should detect MCP block', () => {
      const text = '<system-reminder>\n# MCP Server Instructions\ncontent\n</system-reminder>'
      expect(isRelocatableBlock(text)).toBe(true)
    })

    it('should return false for normal text', () => {
      expect(isRelocatableBlock('just some text')).toBe(false)
    })

    it('should return false for non-string input', () => {
      expect(isRelocatableBlock(null as any)).toBe(false)
    })
  })

  describe('getBlockType', () => {
    it('should return "hooks" for hooks blocks', () => {
      const text = '<system-reminder>\nhook success content\n</system-reminder>'
      expect(getBlockType(text)).toBe('hooks')
    })

    it('should return "skills" for skills blocks', () => {
      const text = '<system-reminder>\nThe following skills are available\n</system-reminder>'
      expect(getBlockType(text)).toBe('skills')
    })

    it('should return "deferred" for deferred tools blocks', () => {
      const text = '<system-reminder>\nThe following deferred tools are now available\n</system-reminder>'
      expect(getBlockType(text)).toBe('deferred')
    })

    it('should return "mcp" for MCP blocks', () => {
      const text = '<system-reminder>\n# MCP Server Instructions\n</system-reminder>'
      expect(getBlockType(text)).toBe('mcp')
    })

    it('should return null for non-relocatable text', () => {
      expect(getBlockType('normal text')).toBeNull()
    })
  })

  describe('fixBlockText', () => {
    it('should sort skills content and pin it', () => {
      const text = 'skills header\n\n- zebra\n- apple\n</system-reminder>'
      const result = fixBlockText('skills', text)
      expect(result).toContain('- apple\n- zebra')
      expect(result).toMatch(/<\/system-reminder>\s*$/)
    })

    it('should sort deferred tools content and pin it', () => {
      const text = '<system-reminder>\nThe following deferred tools are now available:\nz-tool\na-tool\n</system-reminder>'
      const result = fixBlockText('deferred', text)
      expect(result).toContain('a-tool\nz-tool')
    })

    it('should strip session knowledge from hooks', () => {
      const text = '<system-reminder>\nhook success content\n<session_knowledge type="something">extra</session_knowledge>\n</system-reminder>'
      const result = fixBlockText('hooks', text)
      expect(result).not.toContain('session_knowledge')
      expect(result).toContain('hook success')
    })
  })

  describe('freshSessionSort', () => {
    it('should strip clear artifacts from first user message', () => {
      const messages = [
        { role: 'user', content: [{ type: 'text', text: '<local-command-caveat>clear' }, { type: 'text', text: 'real content' }] },
      ]
      freshSessionSort(messages)
      expect(messages[0].content).toHaveLength(1)
      expect(messages[0].content[0].text).toBe('real content')
    })

    it('should sort and pin relocatable blocks in-place when no scattered blocks', () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'text', text: '<system-reminder>\nThe following skills are available\n\n- zebra\n- apple\n</system-reminder>' },
          ],
        },
      ]
      freshSessionSort(messages)
      const skillsContent = messages[0].content[1].text
      expect(skillsContent).toContain('- apple\n- zebra')
    })

    it('should relocate scattered blocks to first user message', () => {
      const messages = [
        { role: 'assistant', content: [] },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'first user message' },
          ],
        },
        { role: 'assistant', content: [] },
        {
          role: 'user',
          content: [
            { type: 'text', text: '<system-reminder>\nThe following skills are available\n- zebra\n</system-reminder>' },
          ],
        },
      ]
      freshSessionSort(messages)
      // Scattered blocks should be relocated to messages[1] (first user)
      const firstUserContent = messages[1].content
      expect(firstUserContent[0].text).toContain('The following skills are available')
      expect(firstUserContent[1].text).toBe('first user message')
      // Skills block should be removed from messages[3]
      const msg3Content = messages[3].content
      expect(msg3Content.length).toBe(0)
    })
  })
})

// ============================================================
// Sub-step 4: content-strip
// ============================================================
describe('sub-step 4: content-strip', () => {
  describe('isContinueTrailerBlock', () => {
    it('should detect a continue trailer block', () => {
      const block = { type: 'text', text: 'Continue from where you left off.' }
      expect(isContinueTrailerBlock(block)).toBe(true)
    })

    it('should return false for non-trailer text block', () => {
      const block = { type: 'text', text: 'normal text' }
      expect(isContinueTrailerBlock(block)).toBe(false)
    })

    it('should return false for non-object input', () => {
      expect(isContinueTrailerBlock(null)).toBe(false)
      expect(isContinueTrailerBlock(undefined)).toBe(false)
    })

    it('should return false for non-text block', () => {
      const block = { type: 'tool_result', text: 'Continue from where you left off.' }
      expect(isContinueTrailerBlock(block)).toBe(false)
    })
  })

  describe('isBookkeepingReminder', () => {
    it('should detect token usage reminder', () => {
      const text = '<system-reminder>\nToken usage: 100/200; 50 remaining\n</system-reminder>'
      expect(isBookkeepingReminder(text)).toBe(true)
    })

    it('should detect output tokens reminder', () => {
      const text = '<system-reminder>\nOutput tokens — turn: 100 · session: 500\n</system-reminder>'
      expect(isBookkeepingReminder(text)).toBe(true)
    })

    it('should detect USD budget reminder', () => {
      const text = '<system-reminder>\nUSD budget: $1.50/$10.00; $8.50 remaining\n</system-reminder>'
      expect(isBookkeepingReminder(text)).toBe(true)
    })

    it('should detect unused tools reminder', () => {
      const text = '<system-reminder>\nThe task tools haven\'t been used recently.\n</system-reminder>'
      expect(isBookkeepingReminder(text)).toBe(true)
    })

    it('should detect unused TodoWrite tool reminder', () => {
      const text = '<system-reminder>\nThe TodoWrite tool hasn\'t been used recently.\n</system-reminder>'
      expect(isBookkeepingReminder(text)).toBe(true)
    })

    it('should detect remaining conversation turns reminder', () => {
      const text = '<system-reminder>\nRemaining conversation turns: 5\n</system-reminder>'
      expect(isBookkeepingReminder(text)).toBe(true)
    })

    it('should detect messages until auto-compact reminder', () => {
      const text = '<system-reminder>\nMessages until auto-compact: 10\n</system-reminder>'
      expect(isBookkeepingReminder(text)).toBe(true)
    })

    it('should return false for non-system-reminder text', () => {
      expect(isBookkeepingReminder('just some text')).toBe(false)
    })

    it('should return false for non-string input', () => {
      expect(isBookkeepingReminder(null as any)).toBe(false)
    })
  })

  describe('stripContentBlocks', () => {
    it('should remove continue trailer blocks from user messages', () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'real content' },
            { type: 'text', text: 'Continue from where you left off.' },
          ],
        },
      ]
      const { messages: result, stats } = stripContentBlocks(messages)
      expect(stats).toEqual({ trailerCount: 1, reminderCount: 0 })
      expect(result[0].content).toHaveLength(1)
      expect(result[0].content[0].text).toBe('real content')
    })

    it('should remove bookkeeping reminders from user messages', () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: '<system-reminder>\nToken usage: 100/200; 50 remaining\n</system-reminder>' },
            { type: 'text', text: 'real content' },
          ],
        },
      ]
      const { messages: result, stats } = stripContentBlocks(messages)
      expect(stats).toEqual({ trailerCount: 0, reminderCount: 1 })
      expect(result[0].content).toHaveLength(1)
      expect(result[0].content[0].text).toBe('real content')
    })

    it('should remove both trailers and reminders', () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Continue from where you left off.' },
            { type: 'text', text: '<system-reminder>\nToken usage: 100/200; 50 remaining\n</system-reminder>' },
            { type: 'text', text: 'real content' },
          ],
        },
      ]
      const { messages: result, stats } = stripContentBlocks(messages)
      expect(stats).toEqual({ trailerCount: 1, reminderCount: 1 })
      expect(result[0].content).toHaveLength(1)
      expect(result[0].content[0].text).toBe('real content')
    })

    it('should not modify non-user messages', () => {
      const messages = [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Continue from where you left off.' }],
        },
      ]
      const { messages: result, stats } = stripContentBlocks(messages)
      expect(stats).toBeNull()
      expect(result).toBe(messages)
    })

    it('should not modify messages with no matching blocks', () => {
      const messages = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'clean content' }],
        },
      ]
      const { messages: result, stats } = stripContentBlocks(messages)
      expect(stats).toBeNull()
      expect(result).toBe(messages)
    })

    it('should handle empty messages array', () => {
      const { messages: result, stats } = stripContentBlocks([])
      expect(stats).toBeNull()
      expect(result).toEqual([])
    })

    it('should handle non-array input', () => {
      const { messages: result, stats } = stripContentBlocks(null as any)
      expect(stats).toBeNull()
      expect(result).toBeNull()
    })
  })
})

// ============================================================
// Integration: full interceptor
// ============================================================
describe('integration: full interceptor', () => {
  it('should skip non-Anthropic URL', async () => {
    const upstream = makeUpstream({ url: 'https://api.openai.com/v1/chat/completions' })
    const ctx = makeCtx()
    const result = await claudeCodeCache(upstream, ctx)
    expect(result).toBe(upstream)
  })

  it('should skip empty body', async () => {
    const upstream = makeUpstream({ body: {} })
    const ctx = makeCtx()
    const result = await claudeCodeCache(upstream, ctx)
    expect(result).toBe(upstream)
  })

  it('should pass through a simple message without modifications', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        ],
      },
    })
    const ctx = makeCtx()
    const result = await claudeCodeCache(upstream, ctx)
    expect(result.body.messages[0].content[0].text).toBe('hello')
  })

  it('should process all 4 sub-steps on a complex message', async () => {
    const upstream = makeUpstream({
      body: {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'hello' },
              {
                type: 'tool_result',
                content: 'result\n\n<system-reminder>\nSkill completed\n</system-reminder>',
              },
              { type: 'text', text: 'Continue from where you left off.' },
            ],
          },
        ],
        tools: [
          { name: 'z-tool' },
          { name: 'a-tool' },
        ],
        system: [
          { type: 'text', text: '<system-reminder>\nUser-invocable skills header\n\n- zebra\n- apple\n</system-reminder>' },
        ],
      },
    })
    const ctx = makeCtx()
    const result = await claudeCodeCache(upstream, ctx)

    // Step 1: smoosh-split should have peeled the reminder
    const toolResult = result.body.messages[0].content.find((b: any) => b.type === 'tool_result')
    expect(toolResult.content).toBe('result')
    const peeledBlock = result.body.messages[0].content.find((b: any) => b.type === 'text' && b.text.includes('Skill completed'))
    expect(peeledBlock).toBeDefined()

    // Step 2: sort-stabilization should sort tools
    expect(result.body.tools[0].name).toBe('a-tool')
    expect(result.body.tools[1].name).toBe('z-tool')

    // Step 2: sort-stabilization should sort skills in system
    expect(result.body.system[0].text).toContain('- apple\n- zebra')

    // Step 4: content-strip should remove trailer
    const hasTrailer = result.body.messages[0].content.some(
      (b: any) => b.type === 'text' && b.text === 'Continue from where you left off.'
    )
    expect(hasTrailer).toBe(false)
  })

  it('should not mutate the original upstream object', async () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello' },
          ],
        },
      ],
      tools: [{ name: 'z-tool' }, { name: 'a-tool' }],
    }
    const upstream = makeUpstream({ body })
    const ctx = makeCtx()
    await claudeCodeCache(upstream, ctx)
    // Original body should be unchanged
    expect(body.tools[0].name).toBe('z-tool')
    expect(body.messages[0].content[0].text).toBe('hello')
  })
})
