# SSE 路径 Sanitizer 修复 — 执行计划

**Spec:** `docs/superpowers/specs/2026-05-02-sse-path-sanitizer-fix-design.md`
**Date:** 2026-05-02
**Branch:** `feature/sse-path-sanitizer-fix`

## 改动清单

### 1. `src/privacy/sanitizer.ts` — 核心逻辑

- 新增 `SSEBufferState` 接口和 `streamBufferStates` Map
- 新增 `isPrefixOfAnyPlaceholder(text, mapping)` 函数
- 修改 `sanitizeSSEChunk` 返回值从 `string` → `{ output: string, buffered: boolean }`
- 新增 `clearStreamBufferState(requestId)` 清理函数

### 2. `src/routes/chat-completions/stream-handler.ts`

- 适配 `sanitizeSSEChunk` 新返回值
- 当 `buffered: true` 时不发送该 chunk
- 流结束时调用 `clearStreamBufferState`

### 3. `src/routes/messages/stream-handler.ts`

- 同上

### 4. `tests/privacy/sanitizer.test.ts` — 新增测试

- 正常直通、完整替换
- 截断替换（开头/中间/结尾）
- 前序匹配失败、假阳性处理
- 流结束清理、边界情况

## 执行顺序

1. 修改 `src/privacy/sanitizer.ts`（核心算法）
2. 修改两个 stream-handler 适配新返回值
3. 编写测试
4. `npm test` 验证
5. 提交推送
