import { randomBytes } from 'crypto'
import type { UpstreamInterceptor, UpstreamInterceptorContext } from './types.js'

// ============================================================
// Session ID 生成（参考 try/cache/using_extra_header 分支）
// ============================================================

/**
 * 生成 OpenCode 兼容的 ID
 * 格式：<prefix>_<12hex时间戳><14base62随机字符>（与 OpenCode CLI 兼容）
 *
 * @param prefix - ID 前缀（ses / msg）
 * @param direction - 时间排序方向
 * @param reuse - 是否复用已生成的 ID（仅对 session 生效）
 */
function generateOpenCodeId(
  prefix: string,
  direction: 'ascending' | 'descending',
  reuse: boolean = false,
): string {
  // session 复用已有值
  if (reuse && prefix === 'ses' && _currentSessionId) {
    return _currentSessionId
  }

  const currentTimestamp = Date.now()

  if (currentTimestamp !== _lastRequestTimestamp) {
    _lastRequestTimestamp = currentTimestamp
    _requestCounter = 0
  }
  _requestCounter++

  let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(_requestCounter)
  now = direction === 'descending' ? ~now : now

  const timeBytes = Buffer.alloc(6)
  for (let i = 0; i < 6; i++) {
    timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
  }

  const hex = timeBytes.toString('hex')
  const random = randomBytes(14)
    .toString('base64url')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 14)

  const id = `${prefix}_${hex}${random}`

  if (reuse && prefix === 'ses') {
    _currentSessionId = id
  }

  return id
}

// 生成器的内部状态
let _currentSessionId: string | null = null
let _requestCounter = 0
let _lastRequestTimestamp = 0

// ============================================================
// Session 缓存管理（按 IP 维度，10 分钟滑动过期）
// ============================================================

const SESSION_TTL_MS = 10 * 60 * 1000 // 10 分钟

interface SessionEntry {
  sessionId: string
  expiresAt: number
}

const sessionMap = new Map<string, SessionEntry>()

/**
 * 惰性清理——遍历 Map，移除过期条目。
 * 每次需要操作 Map 时调用，限制最多检查 50 个 key 避免阻塞。
 */
function lazyCleanup(): void {
  const now = Date.now()
  let checked = 0
  for (const [ip, entry] of sessionMap) {
    if (checked >= 50) break
    if (entry.expiresAt <= now) {
      sessionMap.delete(ip)
    }
    checked++
  }
}

/**
 * 获取指定 IP 的 session。
 * - session 存在且未过期 → 复用并续期
 * - session 过期或不存在 → 生成新 session
 */
function getOrCreateSession(ip: string): string {
  const now = Date.now()
  const existing = sessionMap.get(ip)

  if (existing && existing.expiresAt > now) {
    // 续期（滑动窗口）
    existing.expiresAt = now + SESSION_TTL_MS
    return existing.sessionId
  }

  // 过期或不存在，生成新 session
  const sessionId = generateOpenCodeId('ses', 'descending')
  sessionMap.set(ip, { sessionId, expiresAt: now + SESSION_TTL_MS })

  // 惰性清理
  lazyCleanup()

  return sessionId
}

// ============================================================
// 触发条件判断
// ============================================================

const OPENCODE_DOMAINS = ['opencode.ai']
const TARGET_MODELS = ['kimi', 'glm', 'mino']

function shouldIntercept(ctx: UpstreamInterceptorContext): boolean {
  const baseUrl = ctx.provider.baseUrl?.toLowerCase() ?? ''
  const realModel = ctx.provider.realModel?.toLowerCase() ?? ''

  const matchDomain = OPENCODE_DOMAINS.some(d => baseUrl.includes(d))
  if (!matchDomain) return false

  const matchModel = TARGET_MODELS.some(m => realModel.includes(m))
  return matchModel
}

// ============================================================
// 拦截器入口
// ============================================================

/**
 * OpenCode Session 拦截器。
 *
 * 当 baseUrl 含 "opencode.ai" 且 realModel 小写含 "kimi"/"glm"/"mino" 时：
 * - header 添加 x-opencode-session
 * - body 添加 prompt_cache_key
 *
 * Session 按客户端 IP 独立管理，10 分钟滑动过期。
 */
export const opencodeSessionInterceptor: UpstreamInterceptor = async (upstream, ctx) => {
  if (!shouldIntercept(ctx)) return upstream

  const ip = ctx.clientIp ?? 'unknown'
  const sessionId = getOrCreateSession(ip)

  return {
    ...upstream,
    headers: {
      ...upstream.headers,
      'x-opencode-session': sessionId,
    },
    body: {
      ...upstream.body,
      prompt_cache_key: sessionId,
    },
  }
}

// 导出，便于测试重置
/** @internal 测试用：重置 session 缓存 */
export function resetSessionCache(): void {
  sessionMap.clear()
  _currentSessionId = null
  _requestCounter = 0
  _lastRequestTimestamp = 0
}
