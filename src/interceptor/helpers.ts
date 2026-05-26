/** Whether the URL targets the Anthropic /v1/messages endpoint. */
export function isAnthropicV1Messages(url: string): boolean {
  return url.includes('/v1/messages')
}

/**
 * 判断入口请求路径是否为 Anthropic 格式的 endpoint。
 *
 * 系统支持以下 Anthropic 格式入口路径（body 为 Anthropic messages 格式）：
 * - /v1/messages
 * - /messages
 * - /v1/v1/messages
 *
 * @param path - 入口请求路径（ctx.c.req.path）
 * @returns 是否为 Anthropic 格式 endpoint
 */
export function isAnthropicEndpoint(path: string | undefined): boolean {
  if (path == null) return false
  return path === '/v1/messages' || path === '/messages' || path.endsWith('/messages')
}

/**
 * 判断入口请求路径是否为 OpenAI chat/completions 格式的 endpoint。
 *
 * 系统支持以下 OpenAI 格式入口路径（body 会被转为 Anthropic 格式后发送）：
 * - /v1/chat/completions
 * - /chat/completions
 * - /v1/v1/chat/completions
 *
 * @param path - 入口请求路径（ctx.c.req.path）
 * @returns 是否为 chat/completions 格式 endpoint
 */
export function isChatCompletionsEndpoint(path: string | undefined): boolean {
  if (path == null) return false
  return path === '/v1/chat/completions' || path === '/chat/completions' || path.endsWith('/chat/completions')
}
