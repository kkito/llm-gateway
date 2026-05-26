# Anthropic Cache 优化 — 实施计划

> 基于设计文档：`docs/superpowers/specs/2026-05-26-anthropic-cache-fingerprint-and-normalize-design.md`
> 参考实现：`claude-code-cache-fix/preload.mjs`
> 方法：TDD（先写测试，再实现）

## 任务概览

| # | 任务 | 文件 | 测试文件 |
|---|------|------|----------|
| 1 | `anthropic-billing-cleaner` — 追加 fingerprint 稳定化 | `anthropic-billing-cleaner.ts` | 追加到已有测试 |
| 2 | `claude-code-normalize` — session_start_normalize | `claude-code-normalize.ts` | `claude-code-normalize.test.ts` |
| 3 | `claude-code-normalize` — tool_use_input_normalize | 同上 | 同上 |
| 4 | `claude-code-normalize` — deferred_tools_restore | 同上 | 同上 |
| 5 | `claude-code-normalize` — cache_control_sticky | 同上 | 同上 |
| 6 | 注册新拦截器到 `server.ts` | `server.ts` | - |
| 7 | 运行全部测试 | - | - |

## Task 1: Fingerprint 稳定化

### 修改文件

`src/interceptor/anthropic-billing-cleaner.ts`

### 新增函数

```typescript
// =============================================================
// Fingerprint 稳定化（Bug 2: cc_version fingerprint instability）
// =============================================================

const FINGERPRINT_SALT = "59cf53e54c78"
const FINGERPRINT_INDICES = [4, 7, 20]

/**
 * 重新计算 fingerprint，方式和 CC 源码相同：
 *   SHA256(SALT + msg[4] + msg[7] + msg[20] + version) 的前 3 字符
 * 但不是用 messages[0]（可能包含 meta/attachment 块），
 * 而是用真正的用户消息文本。
 */
function computeFingerprint(messageText: string, version: string): string

/**
 * 在 messages 中找到第一个真正的用户消息文本
 * （跳过 <system-reminder> 开头的 meta 块）。
 */
function extractRealUserMessageText(messages: any[]): string

/**
 * 从系统 prompt 中提取当前 cc_version 并重新计算稳定 fingerprint。
 * 返回 { attrIdx, newText, oldFingerprint, stableFingerprint } | null。
 * 内部包含 round-trip safety check。
 */
function stabilizeFingerprint(system: any[], messages: any[]): {
  attrIdx: number
  newText: string
  oldFingerprint: string
  stableFingerprint: string
} | null
```

### 在 `anthropicBillingCleaner` 函数中追加步骤

在清理 billing header 之后，在返回之前追加：

```typescript
// 如果清理了 header，先更新 body，然后在更新后的 body.system 中做 fingerprint 稳定化
```

### 测试用例（追加到 `anthropic-billing-cleaner.test.ts`）

```
describe('anthropicBillingCleaner - fingerprint stabilization')
  ✓ should stabilize fingerprint when cc_version has meta-block drift
  ✓ should skip when no x-anthropic-billing-header block exists
  ✓ should skip when cc_version has no fingerprint (no dot parts)
  ✓ should skip when fingerprint is already stable
  ✓ should handle round-trip verification failure safely
  ✓ should work with real user message path (v2.1.108+)

describe('computeFingerprint')
  ✓ should compute correct 3-char hex fingerprint
  ✓ should produce same result for same input
  ✓ should produce different result for different input

describe('extractRealUserMessageText')
  ✓ should skip system-reminder blocks
  ✓ should return first non-system-reminder text
  ✓ should handle string content
```

## Task 2-5: `claude-code-normalize` 拦截器

### 新增文件

`src/interceptor/claude-code-normalize.ts`

### 整体结构

```typescript
import { isAnthropicV1Messages } from './helpers.js'
import type { UpstreamInterceptor } from './types.js'

// ---- session_start_normalize 相关 ----
const SESSION_START_RESUME_MARKER = /SessionStart:resume hook success:/g
const SESSION_START_ID_TAG = /\n?<session-id>[^<]*<\/session-id>/g
const SESSION_START_LAST_ACTIVE_LINE = /\nLast active:[^\n]*/g

export function normalizeSessionStartText(text: string): [string, number]

// ---- tool_use_input_normalize 相关 ----
export function normalizeToolUseInputsInBody(body: any): number

// ---- deferred_tools_restore 相关 ----
const DEFERRED_TOOLS_AVAILABLE_MARKER = "The following deferred tools are now available via ToolSearch"
const DEFERRED_TOOLS_UNAVAILABLE_MARKER = "The following deferred tools are no longer available"
const DEFERRED_TOOLS_SNAPSHOT_DIR = join(homedir(), ".claude", "cache-fix-state")

export function deferredToolsSnapshotPath(key: string): string
export function findDeferredToolsBlockInBody(body: any): { msgIdx: number; blockIdx: number; text: string } | null

// ---- cache_control_sticky 相关 ----
const CACHE_CONTROL_STICKY_DIR = join(homedir(), ".claude", "cache-fix-state")
const CACHE_CONTROL_STICKY_MAX_POSITIONS = 2

export function computeStickyMessageHash(msg: any): string | null
export function readCacheControlStickyState(key: string): { version: number; positions: any[] }
export function writeCacheControlStickyState(key: string, state: any): void
export function updateCacheControlStickyState(body: any, priorState: any): { newState: any; mutations: any[] }
export function applyCacheControlSticky(body: any, key: string): number

// ---- 主拦截器 ----
export const claudeCodeNormalize: UpstreamInterceptor = async (upstream, ctx) => {
  // 1. URL guard
  // 2. session_start_normalize（遍历 user messages 的 text block 和 tool_result.content）
  // 3. tool_use_input_normalize（遍历 assistant 消息的 tool_use block）
  // 4. deferred_tools_restore（快照/恢复 deferred tools 块）
  // 5. cache_control_sticky（读取状态、计算 mutations、写回）
}
```

### Task 2: session_start_normalize

**核心逻辑**（直接移植 `claude-code-cache-fix/preload.mjs:369`）：

```typescript
export function normalizeSessionStartText(text: string): [string, number] {
  if (typeof text !== "string" || !text.includes("SessionStart:")) return [text, 0]
  let count = 0
  let out = text
  if (SESSION_START_RESUME_MARKER.test(out)) {
    out = out.replace(SESSION_START_RESUME_MARKER, "SessionStart:startup hook success:")
    count++
  }
  if (SESSION_START_ID_TAG.test(out)) {
    out = out.replace(SESSION_START_ID_TAG, "")
    count++
  }
  if (SESSION_START_LAST_ACTIVE_LINE.test(out)) {
    out = out.replace(SESSION_START_LAST_ACTIVE_LINE, "")
    count++
  }
  return [out, count]
}
```

**拦截器中调用**：遍历所有 user messages 的 text block（`.text`）和 tool_result（`.content`），对包含 "SessionStart:" 的调用 `normalizeSessionStartText`。

### Task 3: tool_use_input_normalize

**核心逻辑**（移植 `preload.mjs:678`）：

```typescript
export function normalizeToolUseInputsInBody(body: any): number {
  // 1. 从 body.tools 构建 toolSchemas: { toolName: orderedKeys[] }
  //    （仅包含有 input_schema.properties 的 tool）
  // 2. 遍历所有 assistant role 消息的 tool_use block
  // 3. 对每个 tool_use，如果 toolName 在 toolSchemas 中匹配：
  //    a. 提取当前 keys
  //    b. 检查是否有非 schema key 或 key 顺序与 schema 声明顺序不同
  //    c. 如有差异，重建 input（只含 schema keys，按 schema 顺序）
  // 4. 返回修改的 block 数量
}
```

### Task 4: deferred_tools_restore

**核心逻辑**（移植 `preload.mjs:488, 2287`）：

```typescript
export function findDeferredToolsBlockInBody(body: any): {
  msgIdx: number; blockIdx: number; text: string
} | null {
  // 在 body.messages 中查找包含 DEFERRED_TOOLS_AVAILABLE_MARKER 的 text block
  // 跳过 assistant role 的消息
  // 返回位置和完整文本
}
```

**拦截器中调用**：
1. 调用 `findDeferredToolsBlockInBody` 查找 deferred tools 块
2. 如找到且是完整状态（不含 `UNAVAILABLE_MARKER`）→ 持久化快照到 `~/.claude/cache-fix-state/deferred-tools-<sha1(cwd)>.txt`
3. 如找到且包含 `UNAVAILABLE_MARKER` → 检查快照是否存在且更长 → 替换

### Task 5: cache_control_sticky

**核心逻辑**（移植 `preload.mjs:810-1005`）：

```typescript
export function computeStickyMessageHash(msg: any): string | null {
  // 优先用 tool_use.id / tool_result.tool_use_id
  // 回退到首 text block 前 256 字符
  // SHA1(role|type|id) 返回前 16 字符
}

export function updateCacheControlStickyState(body: any, priorState: any): {
  newState: any; mutations: Array<{ msgIdx: number; blockIdx: number; marker: any }>
} {
  // 1. 遍历 user messages，建立 hash→msgIdx 索引
  // 2. 观察每个消息上已有的 cache_control marker
  // 3. 合并 priorState: 新观察的 hash 追加，已有的保留
  // 4. 上限 CACHE_CONTROL_STICKY_MAX_POSITIONS=2
  // 5. 对未满上限的消息生成 mutation
  // 6. 遵守 Anthropic 4 标记上限
}

export function applyCacheControlSticky(body: any, key: string): number {
  // 包装器：read → update → apply → write
}
```

**拦截器中调用**：`applyCacheControlSticky(body, process.cwd())`

## Task 6: 注册到 server.ts

在 `src/server.ts` 中：

```typescript
import { claudeCodeNormalize } from './interceptor/claude-code-normalize.js'

// 注册顺序：在 ttl-management 之后，opencode-session 之前
interceptors.use(anthropicBillingCleaner)
interceptors.use(claudeCodeCache)
interceptors.use(cacheControlNormalize)
interceptors.use(ttlManagement)
interceptors.use(claudeCodeNormalize)   // [新增]
interceptors.use(opencodeSessionInterceptor)
interceptors.use(qwenCacheInterceptor)
```

## Task 7: 运行测试

```bash
# 运行拦截器相关全部测试
npx vitest run tests/interceptor/
```

## 实施顺序

1. Task 1（fingerprint 稳定化）— 修改现有文件，范围最小
2. Task 2（session_start_normalize）— 纯字符串变换，无 I/O，最易测试
3. Task 3（tool_use_input_normalize）— 纯数据变换，无 I/O
4. Task 4（deferred_tools_restore）— 有文件 I/O，需 mock
5. Task 5（cache_control_sticky）— 有文件 I/O，最复杂
6. Task 6（注册到 server.ts）
7. Task 7（全部测试通过）
