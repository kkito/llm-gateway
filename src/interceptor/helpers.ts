/** Whether the URL targets the Anthropic /v1/messages endpoint. */
export function isAnthropicV1Messages(url: string): boolean {
  return url.includes('/v1/messages')
}

/**
 * 判断入口请求路径是否为 Anthropic messages 格式的 endpoint。
 *
 * 系统支持以下 Anthropic 格式入口路径（body 为 Anthropic messages 格式）：
 * - /v1/messages
 * - /messages
 * - /v1/v1/messages
 *
 * @param path - 入口请求路径（ctx.c.req.path）
 * @returns 是否为 Anthropic messages 格式 endpoint
 */
export function isAnthropicEndpoint(path: string | undefined): boolean {
  if (path == null) return false
  return path === '/v1/messages' || path === '/messages' || path.endsWith('/messages')
}
