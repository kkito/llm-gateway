/** Whether the URL targets the Anthropic /v1/messages endpoint. */
export function isAnthropicV1Messages(url: string): boolean {
  return url.includes('/v1/messages')
}
