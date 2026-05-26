import { createHash } from 'node:crypto'
import type { UpstreamInterceptor, UpstreamInterceptorContext } from './types.js'
import type { UpstreamRequest } from '../routes/chat-completions/upstream-request.js'

const FINGERPRINT_SALT = '59cf53e54c78'
const FINGERPRINT_INDICES = [4, 7, 20]

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
  const prefix = text.slice(0, 120).toLowerCase()
  if (prefix.includes('x-anthropic-billing-header')) {
    // 以 billing header 开头但正则无法完整匹配 => 未知格式，需要人工介入
    const match = text.match(BILLING_HEADER_RE)
    if (!match) {
      console.log(`  [cleanBillingHeader] ❌ UNRECOGNIZED format: ${JSON.stringify(text.slice(0, 120))}`)
      throw new Error(
        `Unrecognized anthropic billing header format: ${JSON.stringify(text.slice(0, 120))}`
      )
    }
    const removed = text.slice(match[0].length)
    console.log(`  [cleanBillingHeader] ✅ MATCHED regex, removed ${match[0].length} chars, remaining=${JSON.stringify(removed.slice(0, 100))}`)
    return removed
  }
  // billing header not found at start — check if partial prefix exists (debug)
  if (prefix.includes('billing-header') || prefix.includes('cc_version=')) {
    console.log(`  [cleanBillingHeader] ⚠️  partial match (billing-header or cc_version= found but not x-anthropic-billing-header at start): prefix=${JSON.stringify(prefix.slice(0, 80))}`)
  }
  return undefined
}

function shouldIntercept(upstream: UpstreamRequest, ctx?: UpstreamInterceptorContext): boolean {
  const prefix = `[anthropic-billing-cleaner/shouldIntercept]`
  // 只有 OpenAI provider 的 body 是 OpenAI 格式；其他所有 provider（anthropic/deepseek/custom 等）
  // 的 body 都会被转为 Anthropic 格式，billing header 只出现在 Anthropic 格式的 body 中。
  if (ctx?.provider?.provider === 'openai') {
    console.log(`  ${prefix} SKIP: provider=openai, url=${upstream.url}`)
    return false
  }
  const body = upstream.body
  if (!body?.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    console.log(`  ${prefix} SKIP: no messages array in body. bodyKeys=${JSON.stringify(body ? Object.keys(body) : null)}`)
    return false
  }
  console.log(`  ${prefix} PASS: provider=${ctx?.provider?.provider}, url=${upstream.url}, messages.length=${body.messages.length}, hasSystemArray=${Array.isArray(body.system)}`)
  return true
}

// ============ Fingerprint Stabilization ============

/**
 * Compute 3-char hex fingerprint SHA256(SALT + chars + version)[:3].
 */
export function computeFingerprint(messageText: string, version: string): string {
  const chars = FINGERPRINT_INDICES.map((i) => messageText[i] || '0').join('')
  const input = `${FINGERPRINT_SALT}${chars}${version}`
  return createHash('sha256').update(input).digest('hex').slice(0, 3)
}

/**
 * Extract the text of the first real user message, skipping <system-reminder> blocks.
 */
export function extractRealUserMessageText(messages: any[]): string {
  for (const msg of messages) {
    if (msg.role !== 'user') continue
    const content = msg.content
    if (!Array.isArray(content)) {
      if (typeof content === 'string' && !content.startsWith('<system-reminder>')) {
        return content
      }
      continue
    }
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string' && !block.text.startsWith('<system-reminder>')) {
        return block.text
      }
    }
  }
  return ''
}

/**
 * Extract text from the first user message (for legacy round-trip verification).
 */
export function extractFirstMessageText(messages: any[]): string {
  if (!Array.isArray(messages) || messages.length === 0) return ''
  const first = messages[0]
  if (!first || first.role !== 'user') return ''
  const content = first.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      return block.text
    }
  }
  return ''
}

/**
 * Stabilize the cc_version fingerprint in the x-anthropic-billing-header block.
 *
 * 1. Find billing header block in system array
 * 2. Extract cc_version, baseVersion, oldFingerprint
 * 3. Round-trip verify: check if old fingerprint matches either real user text or messages[0]
 * 4. Compute stable fingerprint from real user text
 * 5. If already stable, return null
 * 6. Replace cc_version in block text
 */
export function stabilizeFingerprint(system: any[], messages: any[]): { attrIdx: number; newText: string; oldFingerprint: string; stableFingerprint: string } | null {
  const fpPrefix = `[stabilizeFingerprint]`
  if (!Array.isArray(system)) {
    console.log(`  ${fpPrefix} SKIP: system is not array`)
    return null
  }
  const attrIdx = system.findIndex(
    (b: any) => b.type === 'text' && typeof b.text === 'string' && b.text.includes('cc_version=')
  )
  if (attrIdx === -1) {
    console.log(`  ${fpPrefix} SKIP: no block with 'cc_version=' in system array (${system.length} blocks)`)
    return null
  }
  const attrBlock = system[attrIdx]
  const versionMatch = attrBlock.text.match(/cc_version=([^;]+)/)
  if (!versionMatch) {
    console.log(`  ${fpPrefix} SKIP: cc_version= found but regex match failed, text=${JSON.stringify(attrBlock.text.slice(0, 80))}`)
    return null
  }
  const fullVersion = versionMatch[1]
  const dotParts = fullVersion.split('.')
  if (dotParts.length < 4) {
    console.log(`  ${fpPrefix} SKIP: cc_version=${fullVersion} has fewer than 4 dot parts, no fingerprint to stabilize`)
    return null
  }
  const baseVersion = dotParts.slice(0, 3).join('.')
  const oldFingerprint = dotParts[3]

  // Round-trip safety: try both real and legacy paths
  const realText = extractRealUserMessageText(messages)
  const realVerification = computeFingerprint(realText, baseVersion)
  const legacyText = extractFirstMessageText(messages)
  const legacyVerification = computeFingerprint(legacyText, baseVersion)

  let verificationPassed = false
  let verificationPath = ''
  if (realVerification === oldFingerprint) {
    verificationPassed = true
    verificationPath = 'real'
  } else if (legacyVerification === oldFingerprint) {
    verificationPassed = true
    verificationPath = 'legacy'
  }
  if (!verificationPassed) {
    console.log(`  ${fpPrefix} SKIP: round-trip verification failed. oldFingerprint=${oldFingerprint}, realCalc=${realVerification}, legacyCalc=${legacyVerification}, baseVersion=${baseVersion}, realText=${JSON.stringify(realText.slice(0, 60))}, legacyText=${JSON.stringify(legacyText.slice(0, 60))}, realTextLen=${realText.length}, legacyTextLen=${legacyText.length}`)
    return null
  }

  const stableFingerprint = computeFingerprint(realText, baseVersion)
  if (stableFingerprint === oldFingerprint) {
    console.log(`  ${fpPrefix} SKIP: already stable. fingerprint=${oldFingerprint}, path=${verificationPath}`)
    return null
  }

  const newVersion = `${baseVersion}.${stableFingerprint}`
  const newText = attrBlock.text.replace(`cc_version=${fullVersion}`, `cc_version=${newVersion}`)
  console.log(`  ${fpPrefix} ✅ REPLACED: cc_version=${fullVersion} -> cc_version=${newVersion}, verificationPath=${verificationPath}, realText=${JSON.stringify(realText.slice(0, 40))}`)
  return { attrIdx, newText, oldFingerprint, stableFingerprint }
}

/**
 * Anthropic Billing Header 清理 & Fingerprint 稳定化拦截器。
 *
 * 1. 遍历 messages 中所有 role=system 的消息，去除 billing header 前缀。
 * 2. 处理 body.system（顶层 system 数组）中的 billing header。
 * 3. 在 billing header 清理后，对 body.system 中的 cc_version fingerprint 进行稳定化。
 *
 * 必须注册为第一个拦截器，优先执行。
 */
export const anthropicBillingCleaner: UpstreamInterceptor = async (upstream, ctx) => {
  console.log(`\n[anthropic-billing-cleaner] ====== CALLED ====== provider=${ctx.provider.customModel}, providerType=${ctx.provider.provider}, stream=${ctx.stream}, url=${upstream.url}`)
  if (!shouldIntercept(upstream, ctx)) return upstream

  const body = upstream.body
  let hasChanges = false

  // ---- Step 1: 清理 body.system（顶层 system 数组）中的 billing header 前缀 ----
  let newSystem: any[] | undefined
  if (Array.isArray(body.system)) {
    console.log(`  [Step 1] body.system has ${body.system.length} blocks`)
    body.system.forEach((block: any, i: number) => {
      if (block.type === 'text' && typeof block.text === 'string') {
        console.log(`  [Step 1]   block[${i}].text[:80]=${JSON.stringify(block.text.slice(0, 80))}`)
      } else {
        console.log(`  [Step 1]   block[${i}] type=${block.type}, text type=${typeof block.text}`)
      }
    })
    const cleanedSystem = body.system.map((block: any) => {
      if (block.type === 'text' && typeof block.text === 'string') {
        const cleaned = cleanBillingHeader(block.text)
        if (cleaned !== undefined) {
          hasChanges = true
          return { ...block, text: cleaned }
        }
      }
      return block
    })
    if (cleanedSystem !== body.system) {
      newSystem = cleanedSystem as any[]
      console.log(`  [Step 1] ✅ Billing header prefix(es) cleaned`)
      newSystem.forEach((block: any, i: number) => {
        if (block.type === 'text') {
          console.log(`  [Step 1]   after block[${i}].text[:80]=${JSON.stringify(block.text.slice(0, 80))}`)
        }
      })
    } else {
      console.log(`  [Step 1] No billing header prefix found in body.system blocks`)
    }

    // 清理 billing header 后，运行 fingerprint 稳定化
    if (hasChanges) {
      console.log(`  [Step 1-fingerprint] Running stabilizeFingerprint after cleaning`)
      const systemToStabilize = newSystem ?? body.system
      const fpResult = stabilizeFingerprint(systemToStabilize, body.messages)
      if (fpResult) {
        newSystem = systemToStabilize.map((block: any, i: number) => {
          if (i === fpResult.attrIdx) {
            return { ...block, text: fpResult.newText }
          }
          return block
        })
        console.log(`  [Step 1-fingerprint] ✅ Fingerprint stabilized`)
      }
    }
  } else {
    console.log(`  [Step 1] body.system is not array: ${typeof body.system}, value=${JSON.stringify(body.system?.toString?.()?.slice?.(0, 80) ?? body.system)}`)
  }

  // ---- Step 2: 处理 body.messages 中的 system 消息 ----
  console.log(`  [Step 2] messages.length=${body.messages.length}`)
  body.messages.forEach((msg: any, idx: number) => {
    if (msg.role === 'system') {
      const contentPreview = typeof msg.content === 'string'
        ? JSON.stringify(msg.content.slice(0, 80))
        : Array.isArray(msg.content)
          ? `[array length=${msg.content.length}]`
          : `${typeof msg.content}`
      console.log(`  [Step 2]   msg[${idx}] role=system, content=${contentPreview}`)
    }
  })
  const newMessages = body.messages.map((msg: any) => {
    if (msg.role !== 'system') return msg
    if (!msg.content) return msg

    let newContent: any

    if (typeof msg.content === 'string') {
      const cleaned = cleanBillingHeader(msg.content)
      if (cleaned !== undefined) {
        hasChanges = true
        console.log(`  [Step 2] ✅ msg[${body.messages.indexOf(msg)}] string content cleaned, len=${msg.content.length} -> ${cleaned.length}`)
        newContent = cleaned
      }
    } else if (Array.isArray(msg.content)) {
      const newBlocks = msg.content.map((block: any, bidx: number) => {
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

  if (!hasChanges) {
    console.log(`  [anthropic-billing-cleaner] 👋 NO changes made, returning upstream unchanged\n`)
    return upstream
  }

  const newBody: any = { ...body, messages: newMessages }
  if (newSystem !== undefined) {
    newBody.system = newSystem as any[]
    console.log(`  [anthropic-billing-cleaner] ✅ system array replaced (${newBody.system.length} blocks)`)
  }
  console.log(`  [anthropic-billing-cleaner] ✅ Modified upstream returned, hasChanges=true\n`)
  return { ...upstream, body: newBody }
}
