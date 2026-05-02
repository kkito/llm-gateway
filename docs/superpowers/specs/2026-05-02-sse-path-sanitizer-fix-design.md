# SSE 流式路径用户名替换修复设计

## 问题

当前 `sanitizeSSEChunk()` 使用简单的 `split/join` 替换占位符。但当 LLM 返回的路径被截断在两个 SSE chunk 之间时（如 chunk1 结尾 `/home/__`，chunk2 开头 `USER__/app`），无法匹配完整占位符，导致客户端收到的响应中部分路径仍然显示 `__USER__` 占位符。

## 目标

- 修复流式响应中占位符被跨 chunk 截断时的替换问题
- 不引入明显延迟（用户感知不到 buffering）
- 保持现有非流式替换逻辑不变
- 兼容现有测试，新增测试覆盖截断场景

## 架构

```
chunk 进来
  ↓
有 buffer？
  ├─ 有 → 加入 buffer，合并尝试替换
  │        ├─ 成功 → 发送替换内容，清空 buffer
  │        └─ 失败 → 检查 buffer + chunk 是否还兼容占位符前缀
  │                   ├─ 兼容 → 继续等待下一个 chunk
  │                   └─ 不兼容 → flush buffer（原样发送），清空，回到前序匹配
  │
  └─ 无 → 前序匹配？
           ├─ 匹配 → 加入 buffer，等待
           └─ 不匹配 → 直接发送
```

## 核心组件

### 1. `src/privacy/sanitizer.ts`

#### 新数据结构

```typescript
interface SSEBufferState {
  buffer: string[];  // 累积的 chunk
}
```

全局状态：`streamBufferStates = new Map<requestId, SSEBufferState>()`

#### 新函数

**`isPrefixOfAnyPlaceholder(chunkStart: string, mapping: Map): boolean`**

- 检查 chunk 开头是否是 mapping 中任意占位符的前缀
- 取 chunk 的前 N 个字符（N=3，最小 `/ho`、`/Us`、`C:\`）
- 与每个占位符比较：`placeholder.startsWith(chunkStart)` 或 `chunkStart.startsWith(placeholder.slice(0, N))`

**`sanitizeSSEChunk(sseLine, requestId): { output: string, buffered: boolean }`**

- 返回值改为对象，告知调用者是否还在 buffering
- 实现上述完整流程

**`clearStreamBufferState(requestId)`**

- 清理 buffering 状态（流结束时调用）

### 2. `src/routes/chat-completions/stream-handler.ts`

- 导入 `clearStreamBufferState`
- 修改 `sanitizeSSEChunk` 调用，适配新返回值
- 流结束时调用 `clearStreamBufferState`

### 3. `src/routes/messages/stream-handler.ts`

- 同上

## 测试用例

`tests/privacy/sanitizer.test.ts` 新增：

| 场景 | 测试描述 |
|------|---------|
| 正常直通 | chunk 不含占位符前缀，直接返回 |
| 完整替换 | chunk 包含完整占位符，替换后返回 |
| 截断替换 | chunk1 `/home/__` + chunk2 `USER__/app` → 合并替换 |
| 前序匹配失败 | buffer 中 + chunk 不再兼容占位符前缀 → flush buffer |
| 假阳性处理 | chunk 含 `/home` 但不是占位符前缀 → 直接发送 |
| 多占位符 | 请求中有两个路径，stream 中分别截断 |
| 流结束清理 | 流结束时调用 clearStreamBufferState |
| 边界情况 | buffer 为空、mapping 为空、chunk 为空 |

## 修改文件清单

| 文件 | 改动类型 |
|------|---------|
| `src/privacy/sanitizer.ts` | 新增 `isPrefixOfAnyPlaceholder`、修改 `sanitizeSSEChunk`、新增 `clearStreamBufferState` |
| `src/routes/chat-completions/stream-handler.ts` | 适配新返回值 + flush 逻辑 |
| `src/routes/messages/stream-handler.ts` | 同上 |
| `tests/privacy/sanitizer.test.ts` | 新增 8+ 测试用例 |
