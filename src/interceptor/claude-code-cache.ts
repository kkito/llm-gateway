import type { UpstreamInterceptor } from './types.js'
import { isAnthropicV1Messages } from './helpers.js'
import { createHash } from 'node:crypto'

/**
 * Regex to match a trailing <system-reminder> block at the end of a string.
 * Allows optional trailing whitespace after the closing tag.
 */
export const TRAILING_SMOOSH = /\n\n(<system-reminder>\n(?:(?!<\/system-reminder>)[\s\S])*?\n<\/system-reminder>)\s*$/

/**
 * Sub-step 1: smoosh-split
 *
 * Peel trailing <system-reminder> blocks from tool_result content into standalone text blocks.
 */
export function splitSmooshedReminders(messages: any[] | null | undefined): { messages: any[] | null | undefined; stats: { peeled: number } | null } {
  if (!Array.isArray(messages)) return { messages, stats: null }

  let totalPeeled = 0

  const result = messages.map((msg: any) => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg

    const out: any[] = []
    const peeledReminders: any[] = []
    let mutated = false

    for (const block of msg.content) {
      if (block?.type === 'tool_result' && typeof block.content === 'string') {
        const reminders: string[] = []
        let s = block.content
        while (true) {
          const m = s.match(TRAILING_SMOOSH)
          if (!m) break
          reminders.unshift(m[1])
          s = s.slice(0, m.index)
        }
        if (reminders.length > 0) {
          out.push({ ...block, content: s })
          for (const r of reminders) {
            peeledReminders.push({ type: 'text', text: r })
          }
          totalPeeled += reminders.length
          mutated = true
          continue
        }
      }
      out.push(block)
    }

    if (mutated) {
      return { ...msg, content: [...out, ...peeledReminders] }
    }
    return msg
  })

  return {
    messages: totalPeeled > 0 ? result : messages,
    stats: totalPeeled > 0 ? { peeled: totalPeeled } : null,
  }
}

/**
 * Check if a text is a skills block (contains "User-invocable skills").
 */
export function isSkillsBlock(text: any): boolean {
  return typeof text === 'string' && text.includes('User-invocable skills')
}

/**
 * Check if a text is a deferred tools block (contains "deferred tools are now available").
 */
export function isDeferredToolsBlock(text: any): boolean {
  return typeof text === 'string' && text.includes('deferred tools are now available')
}

/**
 * Sort skill entries within a skills block.
 * Expects format: header\n\n- item1\n- item2\n...</system-reminder>
 */
export function sortSkillsBlock(text: string): string {
  const match = text.match(
    /^([\s\S]*?\n\n)(- [\s\S]+?)(\n<\/system-reminder>\s*)$/
  )
  if (!match) return text
  const [, header, entriesText, footer] = match
  const entries = entriesText.split(/\n(?=- )/)
  entries.sort()
  return header + entries.join('\n') + footer
}

/**
 * Sort tool names within a deferred tools block.
 * Expects format: <system-reminder>\nThe following deferred tools...\ntool1\ntool2\n</system-reminder>
 */
export function sortDeferredToolsBlock(text: string): string {
  const match = text.match(
    /^(<system-reminder>\nThe following deferred tools are now available[^\n]*\n)([\s\S]+?)(\n<\/system-reminder>\s*)$/
  )
  if (!match) return text
  const [, header, toolsList, footer] = match
  const tools = toolsList.split('\n').map((t) => t.trim()).filter(Boolean)
  tools.sort()
  return header + tools.join('\n') + footer
}

/**
 * Process system array: sort skills and deferred tools blocks.
 */
export function sortSystemBlocks(system: any[] | undefined): any[] | undefined {
  if (!Array.isArray(system)) return system

  let modified = false
  const result = system.map((block: any) => {
    if (block.type !== 'text' || typeof block.text !== 'string') return block

    if (isSkillsBlock(block.text)) {
      const sorted = sortSkillsBlock(block.text)
      if (sorted !== block.text) {
        modified = true
        return { ...block, text: sorted }
      }
    } else if (isDeferredToolsBlock(block.text)) {
      const sorted = sortDeferredToolsBlock(block.text)
      if (sorted !== block.text) {
        modified = true
        return { ...block, text: sorted }
      }
    }
    return block
  })

  return modified ? result : system
}

/**
 * Sort tools array by name.
 */
export function sortTools(tools: any[] | undefined): any[] | undefined {
  if (!Array.isArray(tools)) return tools
  if (tools.length === 0) return tools
  return [...tools].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

// ============================================================
// Sub-step 3: fresh-session-sort
// ============================================================

const SR = '<system-reminder>\n'

function isHooksBlock(text: string): boolean {
  return isSystemReminder(text) && text.substring(0, 200).includes('hook success')
}

function isSkillsBlockFS(text: string): boolean {
  return typeof text === 'string' && text.startsWith(SR + 'The following skills are available')
}

function isDeferredToolsBlockFS(text: string): boolean {
  return typeof text === 'string' && text.startsWith(SR + 'The following deferred tools are now available')
}

function isMcpBlock(text: string): boolean {
  return typeof text === 'string' && text.startsWith(SR + '# MCP Server Instructions')
}

function isSystemReminder(text: string): boolean {
  return typeof text === 'string' && text.startsWith('<system-reminder>')
}

/**
 * Check if a block text is a clear artifact (local-command-caveat, command-name, local-command-stdout).
 */
function isClearArtifact(text: string): boolean {
  if (typeof text !== 'string') return false
  return (
    text.startsWith('<local-command-caveat>') ||
    text.startsWith('<command-name>') ||
    text.startsWith('<local-command-stdout>')
  )
}

/**
 * Strip clear artifacts from content blocks.
 */
export function stripClearArtifacts(content: any[]): any[] {
  const filtered = content.filter((b) => !isClearArtifact(b.text || ''))
  return filtered.length === content.length ? content : filtered
}

/**
 * Check if a text block is a relocatable block (hooks, skills, deferred, or MCP).
 */
export function isRelocatableBlock(text: any): boolean {
  if (typeof text !== 'string') return false
  return isHooksBlock(text) || isSkillsBlockFS(text) || isDeferredToolsBlockFS(text) || isMcpBlock(text)
}

/**
 * Get the block type for a relocatable block.
 */
export function getBlockType(text: string): string | null {
  if (isSkillsBlockFS(text)) return 'skills'
  if (isDeferredToolsBlockFS(text)) return 'deferred'
  if (isMcpBlock(text)) return 'mcp'
  if (isHooksBlock(text)) return 'hooks'
  return null
}

function stripSessionKnowledge(text: string): string {
  return text.replace(/\n<session_knowledge[^>]*>[\s\S]*?<\/session_knowledge>/g, '')
}

const _pinnedBlocks = new Map<string, { hash: string; text: string }>()

function pinBlockContent(blockType: string, text: string): string {
  const normalized = text.replace(/\s+(<\/system-reminder>)\s*$/, '\n$1')
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16)
  const pinned = _pinnedBlocks.get(blockType)
  if (pinned && pinned.hash === hash) return pinned.text
  _pinnedBlocks.set(blockType, { hash, text: normalized })
  return normalized
}

/**
 * Fix a block text based on its type (sort, strip session knowledge, pin).
 */
export function fixBlockText(blockType: string, text: string): string {
  let fixed = text
  if (blockType === 'skills') fixed = sortSkillsBlock(fixed)
  else if (blockType === 'deferred') fixed = sortDeferredToolsBlock(fixed)
  else if (blockType === 'hooks') fixed = stripSessionKnowledge(fixed)
  return pinBlockContent(blockType, fixed)
}

/**
 * Sub-step 3: fresh-session-sort
 *
 * Strip clear artifacts from the first user message.
 * If there are scattered relocatable blocks outside the first user message,
 * relocate them to the first user message in deterministic order.
 * Otherwise, sort and pin blocks in-place.
 */
export function freshSessionSort(messages: any[]): void {
  if (!Array.isArray(messages)) return

  let firstUserIdx = -1
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') {
      firstUserIdx = i
      break
    }
  }
  if (firstUserIdx === -1) return

  const firstMsg = messages[firstUserIdx]
  if (!Array.isArray(firstMsg?.content)) return

  // Strip /clear artifacts from first user message
  firstMsg.content = stripClearArtifacts(firstMsg.content)

  // Check for scattered relocatable blocks outside first user message
  let hasScatteredBlocks = false
  for (let i = firstUserIdx + 1; i < messages.length && !hasScatteredBlocks; i++) {
    const msg = messages[i]
    if (msg.role !== 'user' || !Array.isArray(msg.content)) continue
    for (const block of msg.content) {
      if (isRelocatableBlock(block.text || '')) {
        hasScatteredBlocks = true
        break
      }
    }
  }

  if (!hasScatteredBlocks) {
    // Sort and pin blocks in-place for deterministic first-call baseline
    let modified = false
    const newContent = firstMsg.content.map((block: any) => {
      const text = block.text || ''
      const blockType = getBlockType(text)
      if (!blockType) return block

      const fixedText = fixBlockText(blockType, text)
      if (fixedText !== text) {
        modified = true
        const { cache_control, ...rest } = block
        return { ...rest, text: fixedText }
      }
      return block
    })

    if (modified) {
      messages[firstUserIdx] = { ...firstMsg, content: newContent }
    }
    return
  }

  // Scan backwards to find latest instance of each relocatable block type
  const found = new Map<string, any>()
  for (let i = messages.length - 1; i >= firstUserIdx; i--) {
    const msg = messages[i]
    if (msg.role !== 'user' || !Array.isArray(msg.content)) continue
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const block = msg.content[j]
      const text = block.text || ''
      const blockType = getBlockType(text)
      if (!blockType || found.has(blockType)) continue

      const fixedText = fixBlockText(blockType, text)
      const { cache_control, ...rest } = block
      found.set(blockType, { ...rest, text: fixedText })
    }
  }

  if (found.size === 0) return

  // Remove all relocatable blocks from all user messages
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role !== 'user' || !Array.isArray(msg.content)) continue
    const filtered = msg.content.filter((b: any) => !isRelocatableBlock(b.text || ''))
    if (filtered.length !== msg.content.length) {
      messages[i] = { ...msg, content: filtered }
    }
  }

  // Prepend in deterministic order: deferred -> mcp -> skills -> hooks
  const ORDER = ['deferred', 'mcp', 'skills', 'hooks']
  const toRelocate = ORDER.filter((t) => found.has(t)).map((t) => found.get(t))

  messages[firstUserIdx] = {
    ...messages[firstUserIdx],
    content: [...toRelocate, ...messages[firstUserIdx].content],
  }
}

// ============================================================
// Sub-step 4: content-strip
// ============================================================

const CONTINUE_TRAILER_TEXT = 'Continue from where you left off.'

const REMINDER_WRAP_REGEX = /^<system-reminder>\n([\s\S]*?)\n<\/system-reminder>\s*$/
const BOOKKEEPING_PATTERNS = [
  /^Token usage: \d+\/\d+; \d+ remaining\s*$/,
  /^Output tokens — turn: [^\n]+ · session: [^\n]+\s*$/,
  /^USD budget: \$[\d.]+\/\$[\d.]+; \$[\d.]+ remaining\s*$/,
  /^The task tools haven't been used recently\./,
  /^The TodoWrite tool hasn't been used recently\./,
  /^Remaining conversation turns: /,
  /^Messages? until auto-compact: /,
]

/**
 * Check if a block is a "Continue from where you left off." trailer.
 */
export function isContinueTrailerBlock(block: any): boolean {
  return (
    !!block &&
    typeof block === 'object' &&
    block.type === 'text' &&
    block.text === CONTINUE_TRAILER_TEXT
  )
}

/**
 * Check if a text is a bookkeeping reminder (match any bookkeeping pattern).
 */
export function isBookkeepingReminder(text: any): boolean {
  if (typeof text !== 'string') return false
  const m = text.match(REMINDER_WRAP_REGEX)
  if (!m) return false
  const inner = m[1]
  for (const rx of BOOKKEEPING_PATTERNS) {
    if (rx.test(inner)) return true
  }
  return false
}

/**
 * Sub-step 4: content-strip
 *
 * Strip continue trailers and bookkeeping reminders from user messages.
 */
export function stripContentBlocks(messages: any[] | null | undefined): { messages: any[] | null | undefined; stats: { trailerCount: number; reminderCount: number } | null } {
  if (!Array.isArray(messages)) return { messages, stats: null }

  let trailerCount = 0
  let reminderCount = 0

  const result = messages.map((msg: any) => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg

    let msgTrailers = 0
    let msgReminders = 0

    const kept = msg.content.filter((block: any) => {
      if (isContinueTrailerBlock(block)) {
        msgTrailers++
        return false
      }
      if (block.type === 'text' && isBookkeepingReminder(block.text)) {
        msgReminders++
        return false
      }
      return true
    })

    if (kept.length === 0 || kept.length === msg.content.length) return msg

    trailerCount += msgTrailers
    reminderCount += msgReminders
    return { ...msg, content: kept }
  })

  const total = trailerCount + reminderCount
  return {
    messages: total > 0 ? result : messages,
    stats: total > 0 ? { trailerCount, reminderCount } : null,
  }
}

/**
 * Main Claude Code Cache interceptor.
 * Combines all 4 sub-steps in order:
 * 1. smoosh-split: peel system-reminders from tool_result content
 * 2. sort-stabilization: sort skills, deferred tools, and tool definitions
 * 3. fresh-session-sort: relocate, sort, and pin blocks in first user message
 * 4. content-strip: remove continue trailers and bookkeeping reminders
 */
export const claudeCodeCache: UpstreamInterceptor = async (upstream, ctx) => {
  // Step 0: URL guard - only process Anthropic /v1/messages requests
  if (!isAnthropicV1Messages(upstream.url)) return upstream

  const body = upstream.body
  if (!body || !body.messages) return upstream

  let currentBody = { ...body }

  // Step 1: smoosh-split
  const { messages: afterSmoosh, stats: smooshStats } = splitSmooshedReminders(currentBody.messages)
  if (smooshStats) {
    currentBody = { ...currentBody, messages: afterSmoosh }
  }

  // Step 2: sort-stabilization
  const system = sortSystemBlocks(currentBody.system)
  const tools = sortTools(currentBody.tools)
  if (system !== currentBody.system || tools !== currentBody.tools) {
    currentBody = { ...currentBody, system, tools }
  }

  // Step 3: fresh-session-sort
  if (Array.isArray(currentBody.messages)) {
    // Create a shallow copy of messages for mutation by freshSessionSort
    const messagesCopy = [...currentBody.messages]
    freshSessionSort(messagesCopy)
    currentBody = { ...currentBody, messages: messagesCopy }
  }

  // Step 4: content-strip
  const { messages: afterStrip } = stripContentBlocks(currentBody.messages)
  if (afterStrip !== currentBody.messages) {
    currentBody = { ...currentBody, messages: afterStrip }
  }

  return { ...upstream, body: currentBody }
}
