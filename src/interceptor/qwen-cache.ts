/**
 * Qwen 上下文缓存拦截器
 *
 * 当请求的目标模型包含 "qwen" 时，自动在请求体中的适当位置插入
 * cache_control: { type: "ephemeral" } 标记，触发阿里云百炼上下文缓存。
 */

/**
 * 在 tools 数组的最后一条上添加 cache_control。
 * 如果 tools 为空或不存在，返回原数组。
 */
export function addCacheControlToTools(tools: any[] | undefined): any[] | undefined {
  if (!tools || tools.length === 0) return tools
  const last = { ...tools[tools.length - 1], cache_control: { type: 'ephemeral' as const } }
  return [...tools.slice(0, -1), last]
}

/**
 * 在 messages 数组的最后一条的 content 上添加 cache_control。
 * - content 是数组：在 content[0] 上加
 * - content 是字符串：转成 [{ type: 'text', text, cache_control }]
 * - 无 messages 或为空：返回原数组
 */
export function addCacheControlToLastMessage(messages: any[] | undefined): any[] | undefined {
  if (!messages || messages.length === 0) return messages
  const lastIdx = messages.length - 1
  const last = messages[lastIdx]
  if (!last.content) return messages

  let newContent: any[]
  if (Array.isArray(last.content)) {
    newContent = [...last.content]
    if (newContent.length > 0) {
      newContent[0] = { ...newContent[0], cache_control: { type: 'ephemeral' as const } }
    }
  } else if (typeof last.content === 'string') {
    newContent = [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' as const } }]
  } else {
    return messages
  }

  const newLast = { ...last, content: newContent }
  return [...messages.slice(0, lastIdx), newLast]
}

/**
 * 确保 content 是数组格式。
 * 如果是 string，转为 [{ type: 'text', text: content }]。
 * 如果已经是数组，原样返回。其他情况返回 undefined。
 */
export function ensureContentArray(content: any): any[] | undefined {
  if (Array.isArray(content)) return content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return undefined
}

/**
 * 在 content 数组的最后一个 text block 上添加 cache_control。
 * 如果数组为空或没有 text block，返回原数组（不计数）。
 */
export function addCacheControlToLastTextBlock(blocks: any[]): any[] {
  // 从后往前找最后一个 text block（ES2022 不支持 findLastIndex）
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === 'text') {
      const result = [...blocks]
      result[i] = { ...result[i], cache_control: { type: 'ephemeral' as const } }
      return result
    }
  }
  // 没有 text block，不修改
  return blocks
}

/**
 * 在 system messages 上按顺序添加 cache_control，最多不超过 quota 条。
 * 返回处理后的 messages 新数组。
 */
export function addCacheControlToSystemMessages(messages: any[], quota: number): any[] {
  if (quota <= 0) return messages

  let remaining = quota
  return messages.map((msg) => {
    if (msg.role !== 'system' || remaining <= 0) return msg

    const blocks = ensureContentArray(msg.content)
    if (!blocks || blocks.length === 0) return msg // 跳过空 content

    // 从后往前找最后一个 text block（ES2022 不支持 findLastIndex）
    let textIdx = -1
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].type === 'text') {
        textIdx = i
        break
      }
    }
    if (textIdx === -1) return msg // 跳过无 text block 的情况

    remaining--
    const newBlocks = [...blocks]
    newBlocks[textIdx] = { ...newBlocks[textIdx], cache_control: { type: 'ephemeral' as const } }
    return { ...msg, content: newBlocks }
  })
}
