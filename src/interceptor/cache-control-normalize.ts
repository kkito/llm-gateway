import type { UpstreamInterceptor } from './types.js'
import type { UpstreamRequest } from '../routes/chat-completions/upstream-request.js'
import { isAnthropicV1Messages } from './helpers.js'

/**
 * Strip all `cache_control` markers from a user message's content blocks.
 *
 * MUTATES the message in place. Returns the number of markers stripped.
 * Only processes messages with role === 'user' and an Array `content`.
 *
 * @param msg - A message object from the Anthropic messages array
 * @returns The number of cache_control markers removed
 */
export function stripCacheControlMarkers(msg: any): number {
  if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) return 0

  let count = 0
  for (let i = 0; i < msg.content.length; i++) {
    const block = msg.content[i]
    if (block && typeof block === 'object' && 'cache_control' in block) {
      const { cache_control: _removed, ...rest } = block
      msg.content[i] = rest
      count++
    }
  }
  return count
}

/**
 * Count all `cache_control` markers present in user messages within the body.
 *
 * Non-destructive read-only check. Only counts markers on messages with
 * role === 'user' and an Array `content`.
 *
 * @param body - The full upstream request body (Anthropic /v1/messages format)
 * @returns The total number of cache_control markers found
 */
export function countUserCacheControlMarkers(body: any): number {
  if (!body || !Array.isArray(body.messages)) return 0

  let count = 0
  for (const msg of body.messages) {
    if (msg?.role !== 'user' || !Array.isArray(msg.content)) continue
    for (const block of msg.content) {
      if (block && typeof block === 'object' && 'cache_control' in block) {
        count++
      }
    }
  }
  return count
}

/**
 * Apply a canonical `cache_control: { type: "ephemeral" }` to the last content
 * block of the last user message in the messages array.
 *
 * MUTATES the message content in place.
 */
function applyCanonicalCacheControl(messages: any[]): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role !== 'user' || !Array.isArray(msg.content) || msg.content.length === 0) continue

    const lastBlock = msg.content[msg.content.length - 1]
    if (lastBlock && typeof lastBlock === 'object') {
      msg.content[msg.content.length - 1] = {
        ...lastBlock,
        cache_control: { type: 'ephemeral' },
      }
    }
    break
  }
}

/**
 * Cache Control Normalize 拦截器。
 *
 * 1. 仅处理 Anthropic /v1/messages 请求（通过 URL 判断）
 * 2. 统计所有 user message 中的 cache_control 标记数量
 * 3. 若标记数为 0，跳过不做任何修改
 * 4. 剥离所有 user message 中的 cache_control 标记
 * 5. 在最后一条 user message 的最后一个 content block 上应用规范的 cache_control
 * 6. 返回修改后的 upstream
 */
export const cacheControlNormalize: UpstreamInterceptor = async (
  upstream: UpstreamRequest,
  _ctx,
) => {
  if (!isAnthropicV1Messages(upstream.url)) return upstream

  const body = upstream.body
  if (!body?.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return upstream
  }

  const markerCount = countUserCacheControlMarkers(body)
  if (markerCount === 0) return upstream

  // Strip all cache_control from all user messages
  for (const msg of body.messages) {
    if (msg.role === 'user') {
      stripCacheControlMarkers(msg)
    }
  }

  // Apply canonical cache_control at the last block of the last user message
  applyCanonicalCacheControl(body.messages)

  return upstream
}
