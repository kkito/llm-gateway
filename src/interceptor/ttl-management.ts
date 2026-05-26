import type { UpstreamInterceptor } from './types.js'
import { isAnthropicEndpoint } from './helpers.js'

export const AGENT_SDK_PREFIX = "You are a Claude agent, built on Anthropic's Claude Agent SDK."

const TTL_MAIN = '1h'
const TTL_SUBAGENT = '1h'

/**
 * Detect whether the request is a "main" request or a "subagent" request
 * by checking if any system text block starts with the AGENT_SDK_PREFIX.
 */
export function detectRequestType(system: any[]): 'main' | 'subagent' {
  if (!Array.isArray(system)) return 'main'
  const isSubagent = system.some(
    (b) => b?.type === 'text' && typeof b.text === 'string' && b.text.startsWith(AGENT_SDK_PREFIX)
  )
  return isSubagent ? 'subagent' : 'main'
}

/**
 * Inject a TTL value into a content block's cache_control object
 * if it has `cache_control.type === "ephemeral"` but no `ttl` field.
 */
export function injectTtl(block: any, ttlParam: string): any {
  if (block?.cache_control?.type === 'ephemeral' && !block.cache_control.ttl) {
    return {
      ...block,
      cache_control: { ...block.cache_control, ttl: ttlParam },
    }
  }
  return block
}

/**
 * TTL Management interceptor.
 *
 * Injects TTL values onto all ephemeral cache_control markers
 * that don't already have a ttl field. Uses fixed values:
 * - main requests: "1h"
 * - subagent requests: "1h" (same, ready for future config split)
 *
 * Steps:
 * 1. URL guard via isAnthropicV1Messages
 * 2. Skip if body has no messages and system
 * 3. Detect request type from body.system
 * 4. Set TTL based on detected type
 * 5. Iterate over system blocks and message content blocks, injecting TTL
 * 6. Return modified upstream
 */
export const ttlManagement: UpstreamInterceptor = async (upstream, ctx) => {
  if (!isAnthropicEndpoint(ctx?.c?.req?.path)) return upstream

  const body = upstream.body
  if (!body || (!body.messages && !body.system)) return upstream

  const requestType = detectRequestType(body.system)
  const ttlValue = requestType === 'subagent' ? TTL_SUBAGENT : TTL_MAIN

  // Inject on system blocks
  if (Array.isArray(body.system)) {
    body.system = body.system.map((block: any) => injectTtl(block, ttlValue))
  }

  // Inject on message content blocks
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (!Array.isArray(msg.content)) continue
      msg.content = msg.content.map((block: any) => injectTtl(block, ttlValue))
    }
  }

  return upstream
}
