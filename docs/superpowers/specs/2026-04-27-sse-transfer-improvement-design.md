# SSE 转换模块完善与代码清理设计文档

**日期：** 2026-04-27
**分支：** `dev`
**参考项目：** `/home/kkito/study/token_proxy` (docs/SSE_TRANSFER.md)

---

## 概述

完善 OpenAI ↔ Anthropic SSE (Server-Sent Events) 流式转换的事件处理完整性，补齐全方位测试覆盖，同时清理现有代码质量问题。

保持现有直接转换架构（OpenAI ↔ Anthropic），不引入 Responses API 中间层。参考项目用作事件映射表和状态机模式的指导。

---

## 代码清理范围

### 1. 统一 finish_reason 映射

**问题：** 3 个重复的 finish_reason 映射函数散落在 `anthropic-to-openai.ts`、`openai-to-anthropic.ts` 和 `types.ts`。

**方案：** 提取到 `src/converters/shared/finish-reason.ts`，提供两个方向：
- `mapAnthropicToOpenAIFinishReason(stopReason: string): string`
- `mapOpenAIToAnthropicFinishReason(finishReason: string): string`

### 2. 替换 console.log 为项目 logger

**问题：** `messages/stream-handler.ts` 和 `sse-handlers-messages.ts` 使用 `console.log` 调试。

**方案：** 替换为 `logger` 或 `detailLogger`，带 `requestId` 上下文。

### 3. 删除死代码和未使用变量

- `chat-completions/stream-handler.ts` 和 `messages/stream-handler.ts` 中未使用的 `startTime` 变量
- `anthropic-to-openai.ts` 中导出的 `parseSSEData`（被 `parseSSEBlock` 替代）
- 其他无引用导出

### 4. 统一类型定义

**问题：** `AnthropicStreamEvent`、`OpenAIStreamChunk` 等类型在各文件重复定义。

**方案：** 提取到 `src/converters/shared/types.ts`，所有转换器引用共享类型。

### 5. 提取重复的 usage 提取逻辑

**问题：** 两个 stream-handler 各自实现 usage 提取，检查的字段名不同（`cached_tokens` vs `cache_read_input_tokens` vs `cache_creation_input_tokens`）。

**方案：** 提取到 `src/lib/stream-usage.ts`，统一处理所有 usage 字段。

### 6. SSE 解析错误日志

**问题：** JSON 解析错误被空 catch 块静默吞掉。

**方案：** 添加 warn 级别日志，带 `requestId`、`endpoint`、`provider` 上下文。

### 7. OpenRouter 检测

**问题：** 使用 `provider.baseUrl?.includes('openrouter')` 字符串匹配。

**方案：** 改用 provider 类型标识或配置标志。

---

## 转换器事件补齐

### Anthropic → OpenAI (`anthropic-to-openai.ts`)

| 事件类型 | 当前状态 | 补齐后行为 |
|----------|----------|-----------|
| `message_start` | ✅ 已有 | 保持不变 |
| `content_block_start` (text/tool_use/thinking) | ✅ 已有 | 保持不变 |
| `content_block_delta` (text_delta/input_json_delta/thinking_delta) | ✅ 已有 | 保持不变 |
| `content_block_delta` (signature_delta) | 返回空 delta | 保留为空（OpenAI 无对应字段） |
| `content_block_stop` | 返回空 delta | 保留为空（状态机边界） |
| `message_delta` | ✅ 已有 | 保持不变 |
| `message_stop` | ✅ 已有 | 保持不变 |
| `ping` | ❌ 缺失 | 忽略（不转发到下游） |
| `error` | ❌ 缺失 | 记录 error 日志，返回包含错误信息的 chunk |

### OpenAI → Anthropic (`openai-to-anthropic.ts`)

| 事件类型 | 当前状态 | 补齐后行为 |
|----------|----------|-----------|
| 首个 chunk → message_start | ✅ 已有 | 保持不变 |
| `delta.content` → text_delta | ✅ 已有 | 保持不变 |
| `delta.reasoning_content` → thinking_delta | ✅ 已有 | 保持不变 |
| `delta.reasoning_details[]` | 只取第一个元素 | 遍历处理所有元素 |
| `delta.tool_calls[0]` → tool_use | ✅ 已有 | 保持不变 |
| `delta.tool_calls[index > 0]` | ❌ 缺失 | 支持 parallel tool calls |
| `delta.refusal` | ❌ 缺失 | 映射到 text 类型内容块 |
| `finish_reason` → message_delta + message_stop | ✅ 已有 | 保持不变 |
| usage-only chunks | 跳过 | 保持跳过 |

---

## 状态机改进

### 当前模式

```typescript
new ReadableStream({
  async start(controller) {
    const reader = upstream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // 解析 + 转换 → controller.enqueue()
    }
    controller.close();
  }
})
```

### 改进模式：Async Generator

```typescript
async function* convertStream(
  upstream: ReadableStream,
  state: ConverterState
): AsyncGenerator<string> {
  const reader = upstream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // 处理流结束逻辑（发送 done 事件、记录 usage）
        return;
      }
      // 解析 + 转换 → yield
      for (const event of parsedEvents) {
        yield formatEventToSSE(event);
      }
    }
  } finally {
    reader.releaseLock();
    // 清理逻辑（相当于 Rust Drop）
    if (!state.sentDone) {
      logger.warn('Stream ended without [DONE]');
    }
  }
}
```

**原因：**
- async generator 更符合 TypeScript/Node.js 惯例
- `finally` 块天然支持清理（客户端断开时的 Drop 保护）
- 更易于测试（可以直接消费 generator，无需 mock controller）

---

## 测试策略

### 原则

不怕测试多，就怕没有。全方位、多维度测试覆盖。

### 测试层级

| 层级 | 工具 | 覆盖内容 |
|------|------|---------|
| **单元测试** | vitest | 单个转换函数、SSE 解析、状态机 |
| **集成测试** | app.request() + mock fetch | 路由处理、配置读写、完整转换链 |
| **E2E 测试** | app.request() + mock fetch | 端到端流式场景、多 provider 组合 |

### E2E 测试修复

当前 `tests/e2e/sse-response-conversion.e2e.test.ts` 被 skip 的原因：Hono 测试环境无法正确读取 ReadableStream。

**修复方案：**

```typescript
// 修复后的 ReadableStream 消费方式
async function consumeStream(body: ReadableStream | null): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }
  } finally {
    reader.releaseLock();
  }
  return chunks.join('');
}
```

### 新增/修复测试文件清单

#### 转换器单元测试（10 个文件）

| 文件 | 状态 | 新增场景 |
|------|------|---------|
| `tests/converters/anthropic-to-openai/stream-event-conversion.test.ts` | 修复补齐 | tool_use content_block_start、input_json_delta、cache_creation_input_tokens、ping、error 事件 |
| `tests/converters/anthropic-to-openai/sse-parsing.test.ts` | 修复补齐 | event: 前缀行、多行 data 值、SSE 注释行、空数据 |
| `tests/converters/openai-to-anthropic/stream-thinking.test.ts` | 修复补齐 | reasoning_details 多元素、parallel tool calls、refusal 字段 |
| `tests/converters/openai-to-anthropic/stream-event-conversion.test.ts` | **新建** | 完整事件转换测试（对应 Anthropic 方向） |
| `tests/converters/openai-to-anthropic/sse-parsing.test.ts` | **新建** | parseOpenAISSEData 测试 |
| `tests/converters/shared/finish-reason.test.ts` | **新建** | 双向 finish_reason 映射 |
| `tests/converters/shared/sse-parser.test.ts` | **新建** | 统一 SSE 解析器测试 |
| `tests/converters.test.ts` | 修复 | 确保引用新的共享模块 |
| `tests/converters/sse-response-conversion.test.ts` | 保持 | 非流式转换测试 |
| `tests/converters/openai-to-anthropic/stream-text.test.ts` | **新建** | 纯文本流转换的各种场景 |

#### 路由集成测试（6 个文件）

| 文件 | 状态 | 新增场景 |
|------|------|---------|
| `tests/routes/stream-handler.test.ts` | 修复补齐 | cache_creation_input_tokens、tool_calls 流式、mid-stream JSON 错误 |
| `tests/routes/messages-stream-handler.test.ts` | 修复补齐 | thinking 块、tool_calls、OpenRouter 边缘情况、流错误传播 |
| `tests/routes/sse-passthrough.test.ts` | 保持 | 透传场景测试 |
| `tests/routes/utils/sse-handlers.test.ts` | **新建** | parseAndConvertAnthropicSSE 测试 |
| `tests/routes/utils/sse-handlers-messages.test.ts` | 修复补齐 | 补齐 parseOpenAISSEData 相关测试 |
| `tests/routes/utils/stream-usage.test.ts` | **新建** | 统一 usage 提取逻辑测试 |

#### E2E 测试（1 个文件，多场景）

| 文件 | 状态 | 场景 |
|------|------|------|
| `tests/e2e/sse-response-conversion.e2e.test.ts` | 修复取消 skip | 见下方场景清单 |

### E2E 场景清单（按参考项目覆盖）

#### 场景 1：OpenAI 客户端 → OpenAI Provider（透传）

- 纯文本流
- 工具调用流
- thinking/reasoning 流
- usage 信息包含
- 空流（仅 [DONE]）

#### 场景 2：Anthropic 客户端 → Anthropic Provider（透传）

- 纯文本流
- 工具调用流
- thinking 流
- usage 信息包含
- 空流

#### 场景 3：OpenAI 客户端 → Anthropic Provider（转换）

- 纯文本流
- 工具调用流（OpenAI tool_calls → Anthropic tool_use + input_json_delta）
- thinking 流（reasoning_content → thinking_delta）
- 多 content block 交替（thinking → text → tool_use）
- finish_reason 映射
- usage 提取
- 流中途错误

#### 场景 4：Anthropic 客户端 → OpenAI Provider（转换）

- 纯文本流
- 工具调用流（Anthropic tool_use → OpenAI tool_calls）
- thinking 流（thinking_delta → reasoning_content）
- 多 content block 交替
- finish_reason 映射
- usage 提取
- 流中途错误

#### 场景 5：边界情况

- 客户端提前断开连接
- 上游超时
- 超大 chunk（> 64KB）
- 非法 JSON（中间恢复）
- SSE 注释行（`: comment`）
- OpenRouter 处理中注释（`: OPENROUTER PROCESSING`）
- 不完整 SSE 块（跨 TCP 包）

---

## 目录结构变更

```
src/converters/
├── anthropic-to-openai.ts        # 改进后
├── openai-to-anthropic.ts        # 改进后
├── shared/                       # 新建
│   ├── index.ts
│   ├── types.ts                  # 统一类型
│   ├── finish-reason.ts          # 统一 finish_reason 映射
│   └── sse-parser.ts             # 统一 SSE 解析
└── ...

src/routes/
├── chat-completions/
│   └── stream-handler.ts         # 改进后（使用 async generator）
├── messages/
│   └── stream-handler.ts         # 改进后（使用 async generator）
└── utils/
    ├── sse-handlers.ts            # 改进后（引用共享模块）
    └── sse-handlers-messages.ts   # 改进后（引用共享模块）

src/lib/
└── stream-usage.ts               # 新建，统一 usage 提取

tests/
├── converters/
│   ├── shared/                   # 新建
│   │   ├── finish-reason.test.ts
│   │   └── sse-parser.test.ts
│   ├── anthropic-to-openai/
│   │   ├── stream-event-conversion.test.ts  # 修复补齐
│   │   └── sse-parsing.test.ts              # 修复补齐
│   ├── openai-to-anthropic/
│   │   ├── stream-event-conversion.test.ts  # 新建
│   │   ├── stream-thinking.test.ts          # 修复补齐
│   │   ├── sse-parsing.test.ts              # 新建
│   │   └── stream-text.test.ts              # 新建
│   ├── converters.test.ts        # 修复
│   └── sse-response-conversion.test.ts  # 保持
├── routes/
│   ├── stream-handler.test.ts    # 修复补齐
│   ├── messages-stream-handler.test.ts  # 修复补齐
│   ├── sse-passthrough.test.ts   # 保持
│   └── utils/
│       ├── sse-handlers.test.ts  # 新建
│       ├── sse-handlers-messages.test.ts  # 修复补齐
│       └── stream-usage.test.ts  # 新建
└── e2e/
    └── sse-response-conversion.e2e.test.ts  # 修复取消 skip
```

---

## 错误处理策略

### 流内错误

- **上游 JSON 解析错误：** 记录 warn 日志，跳过该 chunk，继续处理后续内容
- **上游连接中断：** finally 块中记录 error，不向下游发送错误事件（客户端已断开）
- **转换逻辑错误：** 记录 error 日志，发送包含错误信息的 chunk（Anthropic 格式用 `message_delta` + `stop_reason: "error"`，OpenAI 格式用 `finish_reason: "error"`）

### 日志级别

| 场景 | 级别 |
|------|------|
| SSE 解析失败（单行） | warn |
| 转换逻辑错误 | error |
| 客户端断开 | debug |
| 流正常结束 | debug |
| 流异常结束（未发 [DONE]） | warn |

---

## 验收标准

1. 所有测试通过（`npm test` 全绿）
2. E2E 测试不再有任何 skip
3. 代码覆盖率不低于现有水平（转换函数 100% 分支覆盖）
4. 无 console.log（全部使用项目 logger）
5. 无 TypeScript 编译错误
6. 无 lint 警告
