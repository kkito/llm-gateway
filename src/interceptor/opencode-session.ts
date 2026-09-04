import { createHash, randomBytes } from 'node:crypto'
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
 */
// 生成器的内部状态
let _requestCounter = 0
let _lastRequestTimestamp = 0

function generateOpenCodeId(
  prefix: 'ses' | 'msg',
  direction: 'ascending' | 'descending',
): string {
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

  return id
}

// ============================================================
// Session 缓存管理（按指纹维度，20 分钟滑动过期）
// ============================================================

const SESSION_TTL_MS = 20 * 60 * 1000 // 20 分钟

interface SessionEntry {
  sessionId: string
  expiresAt: number
}

const sessionMap = new Map<string, SessionEntry>()

const SESSION_HEADER_BLACKLIST = ['authorization', 'cookie', 'set-cookie', 'apikey', 'token']

function getClientHeader(ctx: UpstreamInterceptorContext, name: string): string | null {
  try {
    const v = ctx.c?.req?.header?.(name) ?? ctx.c?.req?.header?.(name.toLowerCase())
    if (typeof v === 'string' && v.trim()) return v
  } catch { /* ignore */ }
  try {
    const raw = ctx.c?.req?.raw?.headers
    const get = (k: string) => {
      if (!raw) return null
      if (typeof raw.get === 'function') return raw.get(k) ?? raw.get(k.toLowerCase())
      return raw[k] ?? raw[k.toLowerCase()] ?? null
    }
    const v = get(name)
    if (typeof v === 'string' && v.trim()) return v
  } catch { /* ignore */ }
  return null
}

function listClientHeaderNames(ctx: UpstreamInterceptorContext): string[] {
  try {
    const raw = ctx.c?.req?.raw?.headers
    if (raw && typeof raw.keys === 'function') return [...raw.keys()]
    if (raw && typeof raw === 'object') return Object.keys(raw)
  } catch { /* ignore */ }
  return []
}

function findSessionHeaderValue(ctx: UpstreamInterceptorContext): string | null {
  const names = listClientHeaderNames(ctx)
  const usable = (name: string): string | null => {
    const lower = name.toLowerCase()
    if (SESSION_HEADER_BLACKLIST.some(b => lower.includes(b))) return null
    const v = getClientHeader(ctx, name)
    return v && v.trim() ? v.trim() : null
  }
  // 第一优先级：名含 session-id
  for (const name of names) {
    if (!name.toLowerCase().includes('session-id')) continue
    const v = usable(name)
    if (v) return v
  }
  // 第二优先级：名含 session
  for (const name of names) {
    if (!name.toLowerCase().includes('session')) continue
    const v = usable(name)
    if (v) return v
  }
  return null
}

function stainlessFingerprint(ctx: UpstreamInterceptorContext): string | null {
  const parts = ['x-stainless-lang', 'x-stainless-package-version', 'x-stainless-runtime', 'x-stainless-runtime-version']
    .map(n => getClientHeader(ctx, n) ?? '')
  return parts.some(p => p) ? parts.join('|') : null
}

function computeFingerprint(ctx: UpstreamInterceptorContext): string {
  const ip = ctx.clientIp ?? 'unknown'
  const user = ctx.currentUser?.name ?? ''
  const realModel = (ctx.provider.realModel ?? '').toLowerCase()
  const sessionHead = findSessionHeaderValue(ctx)
  if (sessionHead) {
    return createHash('sha256').update([sessionHead, ip, user, realModel].join('\n')).digest('hex')
  }
  const ua = getClientHeader(ctx, 'user-agent') ?? ''
  const stainless = stainlessFingerprint(ctx)
  const material = stainless
    ? [stainless, ip, ua, user, realModel].join('\n')
    : [ip, ua, user, realModel].join('\n')
  return createHash('sha256').update(material).digest('hex')
}

/**
 * 惰性清理——顺带移除过期条目，有界扫描避免大 Map 阻塞 event loop。
 * 每次 getOrCreateSession 调用时触发（命中复用也要触发，不只新建）。
 * 单次最多扫描 100 个 key（扫描到 100 即 break），删除其中的过期项。
 */
function lazyCleanup(): void {
  const now = Date.now()
  let scanned = 0
  for (const [key, entry] of sessionMap) {
    if (scanned >= 100) break
    scanned++
    if (entry.expiresAt <= now) {
      sessionMap.delete(key)
    }
  }
}

/**
 * 获取指定指纹的 session。
 * - session 存在且未过期 → 复用并续期
 * - session 过期或不存在 → 生成新 session
 */
function getOrCreateSession(key: string): string {
  // 每次调用都顺带清理（命中复用也要触发），有界扫描开销可控
  lazyCleanup()

  const now = Date.now()
  const existing = sessionMap.get(key)

  if (existing && existing.expiresAt > now) {
    // 续期（滑动窗口）
    existing.expiresAt = now + SESSION_TTL_MS
    return existing.sessionId
  }

  // 过期或不存在，生成新 session
  const sessionId = generateOpenCodeId('ses', 'descending')
  sessionMap.set(key, { sessionId, expiresAt: now + SESSION_TTL_MS })

  return sessionId
}

// ============================================================
// 触发条件判断
// ============================================================

const OPENCODE_DOMAINS = ['opencode.ai']

function shouldIntercept(ctx: UpstreamInterceptorContext): boolean {
  const baseUrl = ctx.provider.baseUrl?.toLowerCase() ?? ''
  return OPENCODE_DOMAINS.some(d => baseUrl.includes(d))
}

// ============================================================
// 拦截器入口
// ============================================================

/**
 * OpenCode Session 拦截器。
 *
 * 当 baseUrl 含 "opencode.ai" 时（全模型）：
 * - header 添加 x-opencode-session
 * - body 添加 prompt_cache_key
 *
 * Session 按客户端指纹三档管理（session 头 / stainless / IP+UA+user+realModel），20 分钟滑动过期。
 */
export const opencodeSessionInterceptor: UpstreamInterceptor = async (upstream, ctx) => {
  if (!shouldIntercept(ctx)) return upstream

  const sessionId = getOrCreateSession(computeFingerprint(ctx))

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
  _requestCounter = 0
  _lastRequestTimestamp = 0
}
