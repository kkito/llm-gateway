# SSE 隐私保护 — 滑动窗口缓冲设计

## 问题

开启隐私保护后，LLM 返回的 SSE 流中可能包含用户路径占位符（如 `/home/__USER__/file.txt`）。当前实现在聚合响应上恢复路径后写入日志，但用户实时收到的 SSE chunk 仍保留占位符。

核心难点：路径被 LLM 的 tokenizer 拆成碎片跨 chunk 传输，单个 chunk 无法独立替换。

## 目标

- **无隐私模式**：SSE 零延迟实时转发，行为不变
- **隐私模式**：缓冲 3 个 chunk 后做滑动窗口替换，在低延迟下恢复占位符
- 不遗漏任何字符，替换后的 chunk 完整拼接后与原始内容一致

## 架构

### 数据流

```
┌─────────────────────────────────────────────────────────────┐
│                     handleStream()                          │
│                                                              │
│  privacyOn = privacySettings.enabled && sanitizeFilePaths   │
│                                                              │
│  while (读取上游 SSE chunk) {                                 │
│    解析 → 标准化 OpenAI 格式                                   │
│                                                              │
│    if (!privacyOn) {                                         │
│      controller.enqueue(chunk)  ← 实时转发，零延迟              │
│      continue                                                 │
│    }                                                         │
│                                                              │
│    /* 隐私模式：滑动窗口缓冲 */                                 │
│    privacyBuffer.push(chunk)                                 │
│                                                              │
│    if (privacyBuffer.length >= 3) {                          │
│      flushWindow()  ← 替换后发送最老的 chunk                     │
│    }                                                         │
│  }                                                           │
│                                                              │
│  流结束：                                                      │
│    flushRemaining()  ← 发送剩余 chunk (最多 2 个)                │
│    controller.close()                                        │
└─────────────────────────────────────────────────────────────┘
```

### 滑动窗口替换

```
C1="Hello /home/__USE"  C2="R__/data"  C3="next"

1. 拼接: combined = C1 + C2 + C3
   = "Hello /home/__USER__/datanext"

2. 替换: result = applyPathMappings(combined)
   = "Hello /home/zhangsan/file.txtnext"

3. 按原始 chunk 的字符比例拆分:
   - 原始 C1 长度: 17 字符 (占 combined 的 17/24)
   - 原始 C2 长度: 10 字符 (占 combined 的 10/24)
   - 原始 C3 长度: 4  字符 (占 combined 的 4/24)

   - 发送 C1' = result 的前 17 字符
   - 保留 C2' = result 的中间 10 字符
   - 保留 C3' = result 的最后 4 字符

4. controller.enqueue(C1')
   privacyBuffer = [C2', C3']
```

### 比例拆分算法

```ts
function splitByOriginalLengths(restored: string, originalLengths: number[]): string[] {
  const totalLen = originalLengths.reduce((a, b) => a + b, 0);
  const result: string[] = [];
  let offset = 0;

  for (let i = 0; i < originalLengths.length; i++) {
    const ratio = originalLengths[i] / totalLen;
    const chunkLen = Math.round(restored.length * ratio);
    // 最后一个 chunk 取剩余所有字符，避免精度丢失
    const actualLen = i === originalLengths.length - 1
      ? restored.length - offset
      : chunkLen;
    result.push(restored.slice(offset, offset + actualLen));
    offset += actualLen;
  }

  return result;
}
```

### 边界处理

**流结束时缓冲 < 3 个 chunk**：

```
buffer = [C1, C2]  (2 个)
→ 拼接 → 替换 → 按长度比例拆成 2 个 → 全部发送
```

**单个 chunk 包含完整占位符**：

```
buffer = [C1="/home/__USER__/foo"]
→ 直接替换 → 发送
```

**chunk 不含占位符**：

映射表中无匹配，`applyPathMappings` 返回原文，不影响性能。

### 接口

在 `src/privacy/sanitizer.ts` 新增：

```ts
/**
 * 对拼接后的完整文本做路径替换，返回替换后的文本。
 * 不清除映射表（供滑动窗口多次调用）。
 */
export function applyPathMappings(
  text: string,
  requestId: string
): string;

/**
 * 获取路径映射的副本（不删除）。
 */
export function getPathMappingsCopy(requestId: string): Map<string, string> | undefined;
```

在 `src/routes/chat-completions/stream-handler.ts` 新增：

```ts
function flushWindow(
  buffer: string[],
  requestId: string,
  controller: ReadableStreamDefaultController
): { remaining: string[] } {
  // 取前 3 个
  const windowChunks = buffer.slice(0, 3);
  const originalLengths = windowChunks.map(c => c.length);

  // 拼接 → 替换
  const combined = windowChunks.join('');
  const restored = applyPathMappings(combined, requestId);

  // 按原始长度比例拆分
  const split = splitByOriginalLengths(restored, originalLengths);

  // 发送最老的 chunk
  controller.enqueue(new TextEncoder().encode(split[0]));

  // 返回剩余的 (split[1..2] + 未处理的新 chunk)
  return { remaining: [...split.slice(1), ...buffer.slice(3)] };
}
```

## 测试策略

### 新增测试文件

`tests/routes/stream-handler-privacy.test.ts`

| 测试用例 | 场景 |
|---------|------|
| 无隐私模式：实时转发 | 验证每个 chunk 到达后立即输出 |
| 隐私模式：完整占位符 | 单个 chunk 内完整占位符被替换 |
| 隐私模式：跨 2 个 chunk | 占位符跨 C1/C2，滑动窗口 3 时正确替换 |
| 隐私模式：跨 3 个 chunk | 占位符跨 C1/C2/C3 |
| 隐私模式：流结束缓冲 < 3 | buffer 只有 1-2 个 chunk 时 flush |
| 隐私模式：Anthropic 格式 | Anthropic 转 OpenAI 后滑动窗口替换 |
| 隐私模式：tool_calls | 含 tool_calls 的 chunk 正确处理 |
| 无字符遗漏 | 替换后所有 chunk 拼接 = 原始内容替换后结果 |

### 现有测试

`tests/routes/stream-handler.test.ts` 现有 12 个测试保持通过（无隐私模式行为不变）。

## 风险

1. **占位符跨 >3 个 chunk**：极端情况（单个用户名被拆成 4+ 个 token）会导致部分占位符无法替换。实际极少发生。聚合日志 `converted_response.log` 仍可完整恢复。
2. **精度误差**：`Math.round` 可能导致 1 个字符偏差。最后一个 chunk 取剩余所有字符补偿。
