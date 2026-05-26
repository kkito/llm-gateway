import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { UpstreamInterceptor } from './types.js'
import { isAnthropicEndpoint } from './helpers.js'

// ============================================================
// Step 1: session_start_normalize
// ============================================================

const SESSION_START_RESUME_MARKER = /SessionStart:resume hook success:/g
const SESSION_START_ID_TAG = /\n?<session-id>[^<]*<\/session-id>/g
const SESSION_START_LAST_ACTIVE_LINE = /\nLast active:[^\n]*/g

/**
 * Normalize SessionStart markers in text content.
 *
 * - Replace "resume hook success" with "startup hook success"
 * - Strip <session-id> tags
 * - Strip "Last active:" lines
 *
 * Returns [normalizedText, mutationCount].
 */
export function normalizeSessionStartText(text: string): [string, number] {
  if (typeof text !== 'string' || !text.includes('SessionStart:')) return [text, 0]
  let count = 0
  let out = text
  const replacedResume = out.replace(SESSION_START_RESUME_MARKER, 'SessionStart:startup hook success:')
  if (replacedResume !== out) { out = replacedResume; count++ }
  const replacedId = out.replace(SESSION_START_ID_TAG, '')
  if (replacedId !== out) { out = replacedId; count++ }
  const replacedLastActive = out.replace(SESSION_START_LAST_ACTIVE_LINE, '')
  if (replacedLastActive !== out) { out = replacedLastActive; count++ }
  return [out, count]
}

// ============================================================
// Step 2: tool_use_input_normalize
// ============================================================

/**
 * Normalize tool_use.input blocks in assistant messages:
 * - Strip keys not in the tool's input_schema
 * - Canonicalize key order to match the schema
 *
 * Mutates the body in place and returns count of modified tool_use blocks.
 * The caller is expected to have already made a shallow copy if immutability is needed.
 */
export function normalizeToolUseInputsInBody(body: any): number {
  if (!body || typeof body !== 'object') return 0
  if (!Array.isArray(body.messages) || !Array.isArray(body.tools)) return 0

  // Build toolSchemas: { toolName: orderedKeys[] }
  const toolSchemas: Record<string, string[]> = Object.create(null)
  for (const tool of body.tools) {
    if (!tool || typeof tool !== 'object') continue
    const name = tool.name
    if (typeof name !== 'string') continue
    const props = tool.input_schema?.properties
    if (!props || typeof props !== 'object') continue
    toolSchemas[name] = Object.keys(props)
  }

  let modified = 0
  for (const msg of body.messages) {
    if (msg?.role !== 'assistant' || !Array.isArray(msg.content)) continue
    for (let i = 0; i < msg.content.length; i++) {
      const block = msg.content[i]
      if (!block || block.type !== 'tool_use') continue
      if (!block.input || typeof block.input !== 'object' || Array.isArray(block.input)) continue
      const schemaKeys = toolSchemas[block.name]
      if (!schemaKeys) continue

      const currentKeys = Object.keys(block.input)
      const schemaKeySet = new Set(schemaKeys)
      const hasExtras = currentKeys.some((k) => !schemaKeySet.has(k))
      const presentSchemaKeys = schemaKeys.filter((k) =>
        Object.prototype.hasOwnProperty.call(block.input, k)
      )
      const currentInSchema = currentKeys.filter((k) => schemaKeySet.has(k))
      let orderDiffers = presentSchemaKeys.length !== currentInSchema.length
      if (!orderDiffers) {
        for (let j = 0; j < presentSchemaKeys.length; j++) {
          if (presentSchemaKeys[j] !== currentInSchema[j]) {
            orderDiffers = true
            break
          }
        }
      }
      if (!hasExtras && !orderDiffers) continue

      const newInput: Record<string, any> = {}
      for (const k of presentSchemaKeys) {
        newInput[k] = block.input[k]
      }
      msg.content[i] = { ...block, input: newInput }
      modified++
    }
  }
  return modified
}

// ============================================================
// Step 3: deferred_tools_restore
// ============================================================

const DEFERRED_TOOLS_AVAILABLE_MARKER = 'The following deferred tools are now available via ToolSearch'
const DEFERRED_TOOLS_UNAVAILABLE_MARKER = 'The following deferred tools are no longer available'
const DEFERRED_TOOLS_SNAPSHOT_DIR = join(homedir(), '.claude', 'cache-fix-state')

export { DEFERRED_TOOLS_AVAILABLE_MARKER, DEFERRED_TOOLS_UNAVAILABLE_MARKER, DEFERRED_TOOLS_SNAPSHOT_DIR }

/**
 * Compute the snapshot file path for a given key.
 */
export function deferredToolsSnapshotPath(key: string): string {
  const hash = createHash('sha1').update(String(key)).digest('hex').slice(0, 16)
  return join(DEFERRED_TOOLS_SNAPSHOT_DIR, `deferred-tools-${hash}.txt`)
}

/**
 * Find a deferred-tools block in the request body.
 * Returns { msgIdx, blockIdx, text } or null.
 */
export function findDeferredToolsBlockInBody(body: any): { msgIdx: number; blockIdx: number; text: string } | null {
  if (!body || !Array.isArray(body.messages)) return null
  for (let m = 0; m < body.messages.length; m++) {
    const msg = body.messages[m]
    if (msg?.role !== 'user' || !Array.isArray(msg.content)) continue
    for (let i = 0; i < msg.content.length; i++) {
      const b = msg.content[i]
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.includes(DEFERRED_TOOLS_AVAILABLE_MARKER)) {
        return { msgIdx: m, blockIdx: i, text: b.text }
      }
    }
  }
  return null
}

// ============================================================
// Step 4: cache_control_sticky
// ============================================================

const CACHE_CONTROL_STICKY_MAX_POSITIONS = 2
const CACHE_CONTROL_STICKY_DIR = join(homedir(), '.claude', 'cache-fix-state')

export { CACHE_CONTROL_STICKY_MAX_POSITIONS, CACHE_CONTROL_STICKY_DIR }

/**
 * Compute a stable hash for a message to use as a sticky position key.
 */
export function computeStickyMessageHash(msg: any): string | null {
  if (!msg || typeof msg !== 'object') return null
  const role = typeof msg.role === 'string' ? msg.role : ''
  if (!Array.isArray(msg.content) || msg.content.length === 0) return null
  for (const b of msg.content) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'tool_use' && typeof b.id === 'string' && b.id) {
      return createHash('sha1').update(`${role}|tool_use|${b.id}`).digest('hex').slice(0, 16)
    }
    if (b.type === 'tool_result' && typeof b.tool_use_id === 'string' && b.tool_use_id) {
      return createHash('sha1').update(`${role}|tool_result|${b.tool_use_id}`).digest('hex').slice(0, 16)
    }
  }
  for (const b of msg.content) {
    if (b?.type === 'text' && typeof b.text === 'string') {
      const prefix = b.text.slice(0, 256)
      return createHash('sha1').update(`${role}|text|${prefix}`).digest('hex').slice(0, 16)
    }
  }
  return null
}

function cacheControlStickyStatePath(key: string): string {
  const hash = createHash('sha1').update(String(key)).digest('hex').slice(0, 16)
  return join(CACHE_CONTROL_STICKY_DIR, `cache-control-sticky-${hash}.json`)
}

/**
 * Read persisted cache_control sticky state from disk.
 */
export function readCacheControlStickyState(key: string): { version: number; positions: any[] } {
  const stateFile = cacheControlStickyStatePath(key)
  try {
    const raw = readFileSync(stateFile, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.positions)) {
      return { version: 1, positions: [] }
    }
    const positions = []
    for (const p of parsed.positions) {
      if (!p || typeof p !== 'object') continue
      if (typeof p.msg_hash !== 'string' || !p.msg_hash) continue
      positions.push({
        msg_hash: p.msg_hash,
        position_hint: 'last_block',
        marker: p.marker && typeof p.marker === 'object' && typeof p.marker.type === 'string'
          ? { ...p.marker }
          : { type: 'ephemeral', ttl: '1h' },
      })
    }
    return { version: 1, positions }
  } catch {
    return { version: 1, positions: [] }
  }
}

/**
 * Write cache_control sticky state to disk.
 */
export function writeCacheControlStickyState(key: string, state: any): void {
  const path = cacheControlStickyStatePath(key)
  try {
    mkdirSync(CACHE_CONTROL_STICKY_DIR, { recursive: true })
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8')
  } catch {
    // best-effort
  }
}

/**
 * Update sticky state based on current body and prior state.
 * Returns new state and list of mutations to apply.
 */
export function updateCacheControlStickyState(body: any, priorState: any): {
  newState: any
  mutations: Array<{ msgIdx: number; blockIdx: number; marker: any }>
} {
  const empty = { newState: { version: 1, positions: [] }, mutations: [] }
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) return empty

  const prior = priorState && Array.isArray(priorState.positions)
    ? { version: 1, positions: priorState.positions.slice() }
    : { version: 1, positions: [] }

  const hashToMsgIdx = new Map<string, number>()
  const observed: Array<{ msg_hash: string; marker: any }> = []

  for (let m = 0; m < body.messages.length; m++) {
    const msg = body.messages[m]
    if (msg?.role !== 'user' || !Array.isArray(msg.content) || msg.content.length === 0) continue
    const h = computeStickyMessageHash(msg)
    if (!h) continue
    if (!hashToMsgIdx.has(h)) hashToMsgIdx.set(h, m)
    for (const b of msg.content) {
      if (b?.cache_control && typeof b.cache_control === 'object') {
        observed.push({ msg_hash: h, marker: { ...b.cache_control } })
        break
      }
    }
  }

  const priorIndex = new Map(prior.positions.map((p: any, i: number) => [p.msg_hash, i]))
  const nextPositions = prior.positions.slice()
  for (const ob of observed) {
    if (priorIndex.has(ob.msg_hash)) {
      const i = priorIndex.get(ob.msg_hash)!
      nextPositions[i] = { msg_hash: ob.msg_hash, position_hint: 'last_block', marker: ob.marker }
    } else {
      nextPositions.push({ msg_hash: ob.msg_hash, position_hint: 'last_block', marker: ob.marker })
      priorIndex.set(ob.msg_hash, nextPositions.length - 1)
    }
  }

  let capped = nextPositions
  if (capped.length > CACHE_CONTROL_STICKY_MAX_POSITIONS) {
    capped = capped.slice(capped.length - CACHE_CONTROL_STICKY_MAX_POSITIONS)
  }

  // Count existing markers, enforce Anthropic's 4-marker limit
  let existingMarkers = 0
  if (Array.isArray(body.system)) {
    for (const b of body.system) {
      if (b?.cache_control) existingMarkers++
    }
  }
  for (const msg of body.messages) {
    if (!msg || !Array.isArray(msg.content)) continue
    for (const b of msg.content) {
      if (b?.cache_control) existingMarkers++
    }
  }
  const stickyBudget = Math.max(0, 4 - existingMarkers)

  const mutations: Array<{ msgIdx: number; blockIdx: number; marker: any }> = []
  for (const pos of capped) {
    if (mutations.length >= stickyBudget) break
    const msgIdx = hashToMsgIdx.get(pos.msg_hash)
    if (msgIdx === undefined) continue
    const msg = body.messages[msgIdx]
    if (!msg || !Array.isArray(msg.content) || msg.content.length === 0) continue
    const hasMarker = msg.content.some(
      (b: any) => b?.cache_control && typeof b.cache_control === 'object'
    )
    if (hasMarker) continue
    mutations.push({
      msgIdx,
      blockIdx: msg.content.length - 1,
      marker: { ...pos.marker },
    })
  }

  return { newState: { version: 1, positions: capped }, mutations }
}

/**
 * Apply cache_control sticky: read prior state, update, write, and mutate body.
 * Returns count of mutations applied.
 */
export function applyCacheControlSticky(body: any, key: string): number {
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) return 0
  const prior = readCacheControlStickyState(key)
  const { newState, mutations } = updateCacheControlStickyState(body, prior)
  for (const mut of mutations) {
    const msg = body.messages[mut.msgIdx]
    if (!msg || !Array.isArray(msg.content)) continue
    const newContent = msg.content.slice()
    const target = newContent[mut.blockIdx]
    if (!target || typeof target !== 'object') continue
    newContent[mut.blockIdx] = { ...target, cache_control: { ...mut.marker } }
    body.messages[mut.msgIdx] = { ...msg, content: newContent }
  }
  writeCacheControlStickyState(key, newState)
  return mutations.length
}

// ============================================================
// Main Interceptor
// ============================================================

export const claudeCodeNormalize: UpstreamInterceptor = async (upstream, ctx) => {
  if (!isAnthropicEndpoint(ctx?.c?.req?.path)) return upstream
  if (!upstream.body) return upstream

  const body = upstream.body
  let hasChanges = false

  // Make a shallow copy of body and messages to avoid mutating the original
  let currentBody: any = body
  if (body && typeof body === 'object') {
    currentBody = { ...body }
    if (Array.isArray(body.messages)) {
      currentBody.messages = body.messages.slice()
    }
  }

  // Step 1: session_start_normalize
  if (Array.isArray(currentBody.messages)) {
    const newMessages = currentBody.messages.map((msg: any) => {
      if (msg?.role !== 'user' || !Array.isArray(msg.content)) return msg
      let contentChanged = false
      const newContent = msg.content.map((block: any) => {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.includes('SessionStart:')) {
          const [t, n] = normalizeSessionStartText(block.text)
          if (n > 0) {
            contentChanged = true
            return { ...block, text: t }
          }
        } else if (block?.type === 'tool_result' && typeof block.content === 'string' && block.content.includes('SessionStart:')) {
          const [c, n] = normalizeSessionStartText(block.content)
          if (n > 0) {
            contentChanged = true
            return { ...block, content: c }
          }
        }
        return block
      })
      if (contentChanged) {
        hasChanges = true
        return { ...msg, content: newContent }
      }
      return msg
    })
    if (hasChanges) {
      currentBody = { ...currentBody, messages: newMessages }
    }
  }

  // Step 2: tool_use_input_normalize (works on currentBody which is already a copy)
  const tuin = normalizeToolUseInputsInBody(currentBody)
  if (tuin > 0) {
    hasChanges = true
  }

  // Step 3: deferred_tools_restore
  if (Array.isArray(currentBody.messages)) {
    const found = findDeferredToolsBlockInBody(currentBody)
    if (found) {
      const hasUnavail = found.text.includes(DEFERRED_TOOLS_UNAVAILABLE_MARKER)
      const snapshotPath = deferredToolsSnapshotPath(process.cwd())
      if (!hasUnavail) {
        // Persist snapshot
        try {
          mkdirSync(DEFERRED_TOOLS_SNAPSHOT_DIR, { recursive: true })
          writeFileSync(snapshotPath, found.text, 'utf-8')
        } catch { /* best-effort */ }
      } else {
        // Attempt restore
        let snapshot: string | null = null
        try { snapshot = readFileSync(snapshotPath, 'utf-8') } catch { /* ignore */ }
        if (snapshot && snapshot.length > found.text.length) {
          const targetMsg = currentBody.messages[found.msgIdx]
          const newContent = targetMsg.content.slice()
          newContent[found.blockIdx] = { ...newContent[found.blockIdx], text: snapshot }
          const newMessages = currentBody.messages.slice()
          newMessages[found.msgIdx] = { ...targetMsg, content: newContent }
          currentBody = { ...currentBody, messages: newMessages }
          hasChanges = true
        }
      }
    }
  }

  // Step 4: cache_control_sticky
  const stickyApplied = applyCacheControlSticky(currentBody, process.cwd())
  if (stickyApplied > 0) hasChanges = true

  if (!hasChanges) return upstream
  return { ...upstream, body: currentBody }
}
