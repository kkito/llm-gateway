/**
 * 判断 upstream URL 是否为 Anthropic /v1/messages 端点。
 * Anthropic 格式的请求体才有 system/messages 结构，才能应用 cache 优化。
 */
export function isAnthropicV1Messages(url: string): boolean {
  return url.includes('/v1/messages')
}
