import type { UpstreamInterceptor } from './types.js'

/**
 * 匹配 Claude Code 注入的 x-anthropic-billing-header 前缀的正则。
 *
 * 格式：x-anthropic-billing-header: cc_version=xxx; cc_entrypoint=xxx; cch=xxx;正文
 * 或：  x-anthropic-billing-header: cc_version=xxx; cc_entrypoint=xxx; cch=xxx正文
 *
 * - i 标志：大小写不敏感
 * - cch= 后面的 ;? 可选（处理最后无分号的情况）
 * - cch 值允许包含空格（如 "e0    bf8"）
 */
export const BILLING_HEADER_RE = /^x-anthropic-billing-header:\s*cc_version=[a-zA-Z0-9._-]+;\s*cc_entrypoint=[a-zA-Z0-9._-]+;\s*cch=[a-zA-Z0-9 ._-]+;?\s*/i

/**
 * 清理字符串中的 billing header 前缀。
 *
 * - 如果字符串以 "x-anthropic-billing-header" 开头但正则无法完整匹配，抛出错误。
 * - 如果字符串以 billing header 开头且匹配成功，去除前缀后返回剩余部分。
 * - 如果不以 billing header 开头，返回 undefined。
 */
export function cleanBillingHeader(text: string): string | undefined {
  if (/^x-anthropic-billing-header\s*:/i.test(text)) {
    // 以 billing header 开头但正则无法完整匹配 => 未知格式，需要人工介入
    const match = text.match(BILLING_HEADER_RE)
    if (!match) {
      throw new Error(
        `Unrecognized anthropic billing header format: ${JSON.stringify(text.slice(0, 120))}`
      )
    }
    return text.slice(match[0].length)
  }
  return undefined
}

/**
 * 判断是否需要拦截（provider 是 anthropic 且 body 有非空 messages）。
 */
function shouldIntercept(ctx: { provider: { provider: string } }, body: any): boolean {
  if (ctx.provider.provider !== 'anthropic') return false
  if (!body?.messages || !Array.isArray(body.messages) || body.messages.length === 0) return false
  return true
}

/**
 * Anthropic Billing Header 清理拦截器。
 *
 * 当 provider 为 anthropic 时，遍历 messages 中 role 为 "system" 的消息，
 * 检查其 content 是否包含 billing header 前缀。
 * 若包含，去除此前缀并返回新对象。
 *
 * 必须注册为第一个拦截器，优先执行。
 */
export const anthropicBillingCleaner: UpstreamInterceptor = async (upstream, ctx) => {
  if (!shouldIntercept(ctx, upstream.body)) return upstream

  const body = upstream.body
  let hasChanges = false

  const newMessages = body.messages.map((msg: any) => {
    if (msg.role !== 'system') return msg
    if (!msg.content) return msg

    let newContent: any

    if (typeof msg.content === 'string') {
      const cleaned = cleanBillingHeader(msg.content)
      if (cleaned !== undefined) {
        hasChanges = true
        newContent = cleaned
      }
    } else if (Array.isArray(msg.content)) {
      const newBlocks = msg.content.map((block: any) => {
        if (block.type === 'text' && typeof block.text === 'string') {
          const cleaned = cleanBillingHeader(block.text)
          if (cleaned !== undefined) {
            hasChanges = true
            return { ...block, text: cleaned }
          }
        }
        return block
      })
      if (newBlocks !== msg.content) {
        newContent = newBlocks
      }
    }

    if (newContent !== undefined) {
      return { ...msg, content: newContent }
    }
    return msg
  })

  if (!hasChanges) return upstream

  return {
    ...upstream,
    body: { ...body, messages: newMessages },
  }
}
