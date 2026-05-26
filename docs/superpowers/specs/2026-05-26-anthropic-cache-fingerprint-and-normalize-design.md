# Anthropic Cache 优化 — Fingerprint 稳定化 & Claude Code Normalize

**日期:** 2026-05-26

## 概述

将 `claude-code-cache-fix` 项目中剩余的 P0 缓存优化功能移植到 llm-gateway 的 UpstreamInterceptor 框架。分两部分：

1. **`anthropic-billing-cleaner`** — 增加 fingerprint 稳定化功能
2. **`claude-code-normalize`** — 新增拦截器，包含 4 个默认开启的规范化功能

---

## Part A: Fingerprint 稳定化（在 `anthropic-billing-cleaner.ts` 中增加）

### 背景

Claude Code 在每个 API 请求的 `x-anthropic-billing-header` 中注入一个 `cc_version` 字段，格式为 `2.1.87.a3f`。其中 `.a3f`（3 字符 hex）是 fingerprint，计算方式为：

```
SHA256(SALT + msg[4] + msg[7] + msg[20] + version) 的前 3 字符
```

BUG：fingerprint 是从 `messages[0]` 的内容计算的，但 `messages[0]` 包含 `<system-reminder>` meta 块（hooks/skills/deferred-tools/MCP 等）。这些块在不同 turn 之间会变化（工具注册、MCP 重连等）→ fingerprint 变化 → 缓存键变化 → 同一 session 内无法命中缓存。

### 修复方案

在现有 billing header 清理逻辑**之后**，增加一个稳定化步骤：

1. **查找 attribution header block** — 在 `body.system` 中找到包含 `x-anthropic-billing-header:` 的 text block
2. **提取当前 fingerprint** — 从 `cc_version=2.1.87.a3f` 中提取 `a3f`
3. **安全校验（round-trip verification）** — 用真正的用户消息文本重新计算 fingerprint，验证与 CC 发送的值一致。确认 salt/indices 在当前 CC 版本中未变更
4. **稳定化替换** — 用真正的用户消息文本（跳过 `<system-reminder>` 块）重新计算 fingerprint，替换 `cc_version` 中的 fingerprint 部分

### 与现有代码的关系

- 现有 `cleanBillingHeader()` 去除 `x-anthropic-billing-header:` 前缀 + `cc_version=...; cc_entrypoint=...; cch=...;`
- fingerprint 稳定化读取的是**同一个 text block**，在清理之后对 `cc_version` 的 fingerprint 部分做替换
- 两个操作独立，但作用在同一块内容上，适合放在同一个拦截器

### 影响范围

- **没有副作用**：发送到 Anthropic 的 `cc_version` fingerprint 只用于客户端侧的缓存键计算。服务器端不校验此值。即使算错，最坏情况只是不替换（安全校验失败时跳过）。
- **文件变更**：仅修改 `anthropic-billing-cleaner.ts`，追加 `stabilizeFingerprint()` 等函数

---

## Part B: `claude-code-normalize` — 新增拦截器

### 背景

Claude Code 的客户端会在 prompt 中注入各种动态内容（时间戳、session ID、git status、tool_use 序列化等），这些内容在 turn 之间不断变化，导致同一 session 内 prompt 前缀不同，缓存命中率大幅下降。

### 4 个规范化功能

按执行顺序列：

#### 1. `session_start_normalize`

**问题**：CC 每次 resume 时在 messages 中注入 `<session_start>` 块，包含 `SessionStart:resume hook success:`（每次不同）、`<session-id>`（每次不同）、`Last active:`（时间戳每次不同），导致缓存前缀变化。

**修复**：
- `SessionStart:resume hook success:` → 替换为 `SessionStart:startup hook success:`
- 剥离 `<session-id>...</session-id>` 标签及其内容
- 剥离 `Last active: ...` 行

**适用范围**：`user` role 消息中的 `text` block 和 `tool_result.content` 字符串（考虑了 CC 的 smoosh 行为）。

#### 2. `tool_use_input_normalize`

**问题**：CC 序列化 `tool_use.input` 时，可能包含 tool schema 未声明的额外字段。pre-miss 和 post-miss 的序列化结果不同 → 同一位置 byte 不同 → 缓存 miss。

**修复**：
- 遍历所有 `assistant` role 消息的 `tool_use` block
- 在 `body.tools` 中查找对应 tool 的 `input_schema.properties`
- 只保留 schema 声明的 key，按 schema 声明顺序重排
- 未在 `body.tools` 中找到的 tool 跳过

#### 3. `deferred_tools_restore`

**问题**：CC resume 时，如果 MCP 服务器还没重连完，deferred tools 块会缩小（只剩 CC 内置工具），并注入 `no longer available` 标记。这个块位于 `messages[0]`（或附件位置），变化后整个前缀缓存 bust。

**修复**：
- 在首次请求（deferred tools 完整时）持久化快照到 `~/.claude/cache-fix-state/deferred-tools-<sha1(cwd)>.txt`
- 后续请求检测到块包含 "no longer available" 标记且长度小于快照时，用快照替换
- 仅当快照严格更长时恢复（不降级到过时短版本）

#### 4. `cache_control_sticky`

**问题**：CC 在每轮只维护一个 user-side 的 `cache_control` 标记，位于最后一个 user message 的尾部。当标记移动到新 turn 时，旧位置的 block 丢失了 43 字节的 `cache_control` framing → 尾字节 diff → 所有下游缓存 bust。

**修复**：
- 按稳定消息 hash（优先用 `tool_use.id` / `tool_result.tool_use_id`，回退到首 text block 前 256 字符）追踪每个 user message
- 持久化最近 2 个历史标记位置到 `~/.claude/cache-fix-state/cache-control-sticky-<sha1(cwd)>.json`
- 每次请求中，在已有标记不冲突的前提下，恢复历史标记
- 遵守 Anthropic 的 4 个 cache_control 标记上限

### 与其他拦截器的关系

```
当前注册顺序：
  anthropic-billing-cleaner (1)
  claude-code-cache (2)               ← 4个子步骤
  cache-control-normalize (3)          ← 收拢散落标记到尾部
  ttl-management (4)
  claude-code-normalize (5) [新增]     ← session→tool→deferred→sticky
  opencode-session (6)
  qwen-cache (7)
```

`claude-code-normalize` 内部执行顺序（参考 `claude-code-cache-fix` pipeline）：
1. `session_start_normalize` — 最先执行，稳定化 msg[0] 中 session 相关文本
2. `tool_use_input_normalize` — 之后执行，稳定化 assistant tool_use 序列化
3. `deferred_tools_restore` — 恢复 process 之间的 deferred tools 快照
4. `cache_control_sticky` — 最后执行，在 normalize 已确定当前标记位置后，补充历史标记

### 文件结构

```
src/interceptor/
├── anthropic-billing-cleaner.ts    [修改] 追加 fingerprint 稳定化
├── claude-code-normalize.ts         [新增] 4个默认ON的规范化功能
└── ...

tests/interceptor/
├── anthropic-billing-cleaner.test.ts  [修改] 追加 fingerprint 测试
└── claude-code-normalize.test.ts      [新增] 4个功能的测试
```

### 测试策略

每个功能独立 describe 块，使用现有的 `makeUpstream` / `makeCtx` 模式：
- `session_start_normalize` — resume marker 替换、session-id 剥离、Last active 剥离
- `tool_use_input_normalize` — 只保留 schema keys、按 schema 顺序重排、未知 tool 跳过
- `deferred_tools_restore` — 正常时快照、缩小时恢复、快照不存在时跳过
- `cache_control_sticky` — 历史标记注入、hash 稳定性、上限控制
- URL 守卫 — 非 `/v1/messages` 时跳过
- 不可变性 — 不修改原始 upstream 对象
