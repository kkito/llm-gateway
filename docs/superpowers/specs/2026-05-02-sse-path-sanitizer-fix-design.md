# SSE 流式路径用户名替换修复设计

## 问题

当前 `sanitizeSSEChunk()` 使用简单的 `split/join` 替换占位符。但当 LLM 返回的路径被截断在两个 SSE chunk 之间时（如 chunk1 结尾 `/home/__`，chunk2 开头 `USER__/app`），无法匹配完整占位符，导致客户端收到的响应中部分路径仍然显示 `__USER__` 占位符。

## 目标

- 修复流式响应中占位符被跨 chunk 截断时的替换问题
- 不引入明显延迟（用户感知不到 buffering）
- 保持现有非流式替换逻辑不变
- 兼容现有测试，新增测试覆盖截断场景

## 核心流程

```
chunk 进来
  ↓
步骤1：完整替换检查
  buffer + chunk 合并后，是否包含完整占位符？
  ├─ 是 → 替换，发送替换后的内容，清空 buffer
  └─ 否 → 继续
       ↓
步骤2：前序兼容性检查
  取 buffer + chunk 的最后 N 个字符
  检查是否是 mapping 中任意占位符的前缀？
  ├─ 是 → 保存 buffer，等待下一个 chunk
  └─ 否 → flush buffer（原样发送），清空状态
```

## 详细设计

### sanitizeSSEChunk 核心逻辑

```
输入：sseLine (chunk), requestId
输出：{ output: string, buffered: boolean }

已知条件：
- mapping 中的占位符在请求阶段已经确定（如 /home/__USER__/app/main.py）
- 只可能有一个占位符被截断（请求时只有一条路径被替换）
- N = mapping 中最长占位符的长度（已知最大值，不会无限增长）

步骤：
1. 获取 mapping，无 mapping → 直接返回 { output: sseLine, buffered: false }
2. 获取或创建 buffer state
3. 合并 buffer + sseLine → combined
4. 尝试完整替换：tryReplaceAll(combined, mapping)
   - 成功 → 返回 { output: replaced, buffered: false }，清空 buffer
5. 前序兼容性检查：
   - 取 combined 最后 N 个字符（N = 最长占位符长度）
   - 检查 combined 的尾部是否是 mapping 中占位符的前缀：
     placeholder.startsWith(tail)
   - 兼容 → 保存 combined 到 buffer，返回 { output: '', buffered: true }
   - 不兼容 → flush combined（原样发送），清空 buffer，返回 { output: combined, buffered: false }
```

### 前序匹配函数

```typescript
function isPrefixCompatible(text: string, mapping: Map<string, string>): boolean {
  // 取最长占位符长度作为 N
  let maxLen = 0;
  for (const p of mapping.keys()) {
    if (p.length > maxLen) maxLen = p.length;
  }
  
  const N = maxLen;
  const tail = text.slice(-N);
  
  // 检查 tail 是否是任意占位符的前缀
  for (const placeholder of mapping.keys()) {
    if (placeholder.startsWith(tail)) return true;
  }
  return false;
}
```

### 边界情况处理

| 情况 | 处理方式 |
|------|---------|
| 流结束但 buffer 有内容 | 原样发送 buffer，不清空 |
| buffer 无限增长 | 不可能，N 已知（占位符长度），超过 N 必然能判断是否兼容 |
| 多个占位符 | 不可能，请求阶段只有一条路径被替换 |
| chunk 不含占位符前缀 | 直接发送，不进入 buffer |
| 完整替换成功 | 立即发送替换内容，清空 buffer |

### 架构

```
无 buffer 状态：
  chunk 进来 → 步骤1（完整替换）→ 步骤2（前序检查）
    ├─ 完整匹配 → 替换发送
    ├─ 前序兼容 → 进入 buffer
    └─ 都不匹配 → 直接发送

有 buffer 状态：
  chunk 进来 → 合并 buffer → 步骤1 → 步骤2
    ├─ 完整匹配 → 替换发送，清空 buffer
    ├─ 前序兼容 → 更新 buffer，继续等待
    └─ 都不兼容 → flush buffer（原样发送），清空

流结束：
  buffer 有内容 → 原样发送 buffer
```

## 核心组件

### 1. `src/privacy/sanitizer.ts`

#### 新数据结构

```typescript
interface SSEBufferState {
  buffer: string;  // 累积的内容（合并后的字符串）
}
```

全局状态：`streamBufferStates = new Map<requestId, SSEBufferState>()`

#### 新函数

**`isPrefixCompatible(text: string, mapping: Map): boolean`**

- 检查 text 的尾部是否是 mapping 中占位符的前缀
- N = mapping 中最长占位符的长度
- 取 text 最后 N 个字符，检查是否是占位符前缀

**`sanitizeSSEChunk(sseLine, requestId): { output: string, buffered: boolean }`**

- 返回值改为对象，告知调用者是否还在 buffering
- 实现上述完整流程（步骤1：完整替换 → 步骤2：前序检查）

**`clearStreamBufferState(requestId)`**

- 清理 buffering 状态（流结束时调用，可选）

### 2. `src/routes/chat-completions/stream-handler.ts`

- 导入 `clearStreamBufferState`
- 修改 `sanitizeSSEChunk` 调用，适配新返回值
- 流结束时调用 `clearStreamBufferState`（可选）

### 3. `src/routes/messages/stream-handler.ts`

- 同上

## 测试用例

`tests/privacy/sanitizer.test.ts` 新增：

| 场景 | 测试描述 |
|------|---------|
| 正常直通 | chunk 不含占位符前缀，直接返回 |
| 完整替换 | chunk 包含完整占位符，替换后返回 |
| 截断替换（开头） | chunk1 `/home/__` + chunk2 `USER__/app` → 合并替换 |
| 截断替换（中间） | chunk1 `The file /home/__` + chunk2 `USER__` + chunk3 `/app/main.py` → 合并替换 |
| 截断替换（结尾） | chunk1 `/home/__USER__/app/main.py` 结尾被截断 |
| 前序匹配失败 | buffer 中 + chunk 不再兼容占位符前缀 → flush buffer |
| 假阳性处理 | chunk 含 `/home` 但不是占位符前缀 → 直接发送 |
| 流结束清理 | 流结束但 buffer 有内容 → 原样发送 |
| 边界情况 | buffer 为空、mapping 为空、chunk 为空 |

## 修改文件清单

| 文件 | 改动类型 |
|------|---------|
| `src/privacy/sanitizer.ts` | 新增 `isPrefixOfAnyPlaceholder`、修改 `sanitizeSSEChunk`、新增 `clearStreamBufferState` |
| `src/routes/chat-completions/stream-handler.ts` | 适配新返回值 + flush 逻辑 |
| `src/routes/messages/stream-handler.ts` | 同上 |
| `tests/privacy/sanitizer.test.ts` | 新增 8+ 测试用例 |
