# 星型格式转换架构 + 落地 OpenAI Responses API

- 日期：2026-07-10
- 状态：已与用户确认设计
- 参考项目：`/Users/kkito/proj/study/cc-switch`（Rust Tauri 代理，含 `transform_responses.rs` / `streaming_responses.rs`）

## 背景与目标

当前 `llm-gateway` 的转换层是**网状直连**：每种格式两两互转。

- `src/converters/openai-to-anthropic.ts`：OpenAI Chat → Anthropic（请求/响应/SSE）
- `src/converters/anthropic-to-openai.ts`：Anthropic → OpenAI Chat（请求/响应/SSE）

每新增一种格式（如 OpenAI Responses API、Gemini），需补 N-1 对转换器，维护与测试成本随格式数平方增长。

目标：改为**星型（hub-and-spoke）** 架构——以 OpenAI Chat 消息格式作为统一内部格式（canonical），每种格式只实现"对 chat 的入站/出站"两组函数。新格式只需写这一组即可接入。同时**全量落地 OpenAI Responses API**（既作客户端入站格式，也作 provider 出站格式），并把 cc-switch 的 Responses 转换逻辑（含保真项）移植过来。

### 转换短路规则（重要）
- 仅当 **source 格式 ≠ provider 格式** 时才过 chat 中转。
- source == provider（如 anthropic→anthropic、chat→chat）直接透传（passthrough），不做任何转换。
- 这跟星型不冲突，是"同格式短路"优化。

## 决策记录

| 议题 | 决定 |
| --- | --- |
| 改造范围 | B：重构架构 + 真正落地 OpenAI Responses API（入站+出站，全保真） |
| canonical 内部格式 | C：复用 OpenAI 类型，新增带 `[FIDELITY-SLOT]` 注释的保真扩展槽 |
| Responses 保真度 | 全量参考 cc-switch，含 `encrypted_content` / `include` / `previous_response_id` 短接 |
| 流式转换器形态 | 方案 1：每格式一对"有状态流式实例" + 纯函数做 JSON |

## 设计

### 1. 统一内部格式（canonical，选项 C）

将 `src/converters/types.ts` 的 OpenAI 类型作为 canonical，迁移到 `src/converters/canonical/types.ts` 并重命名为 `Chat*` 家族：

- `ChatMessage`（由 `OpenAIMessage` 演化）
- `ChatRequest`（由 `OpenAIRequest` 演化）
- `ChatResponse`（由 `OpenAIResponse` 演化）
- `ChatStreamChunk`（由 `OpenAIStreamChunk` 演化，流式 chunk）

**新增保真扩展槽（统一以 `// [FIDELITY-SLOT]` 注释标明用途与来源，默认 undefined，不影响现有逻辑）：**

- `ChatMessage.thinkingSignature?: string` —— 来源 Anthropic `thinking.signature`，保真短接时携带。
- `ChatRequest.previousResponseId?: string` —— 来源 Responses `previous_response_id`，多轮对话延续。
- `ChatRequest.responseInstructions?: string` —— 来源 Responses `instructions`，落地前的系统提示（若 provider 不支持独立 instructions 字段则并入 system）。
- `ChatResponse.responsesEncryptedContent?: string` —— 来源 Responses `include: reasoning.encrypted_content`，保真短接携带，避免走 chat 中转时丢失。
- 其余厂商差异字段按需追加，均遵循 `[FIDELITY-SLOT]` 注释约定。

现有 `reasoning` / `reasoning_content` 字段保留并继续作为 thinking 的标准映射目标。

### 2. 转换器目录结构（星型，替换网状）

```
src/converters/
  canonical/
    types.ts                 # Chat* 类型 + [FIDELITY-SLOT] 扩展槽
    index.ts
  formats/
    chat/
      index.ts               # 恒等适配器：toChat/fromChat = 透传；stream 实例 = 直传
    anthropic/
      request.ts             # anthropicRequestToChat / chatToAnthropicRequest（纯函数）
      response.ts            # anthropicResponseToChat / chatToAnthropicResponse（纯函数）
      stream.ts              # AnthropicUpstreamStream / AnthropicDownstreamStream（有状态）
      index.ts               # 导出 FormatAdapter
    responses/               # 新增
      request.ts             # responsesRequestToChat / chatToResponsesRequest
      response.ts            # responsesResponseToChat / chatToResponsesResponse
      stream.ts              # ResponsesUpstreamStream / ResponsesDownstreamStream（有状态）
      index.ts
  router.ts                  # (sourceFormat, providerFormat) -> 选择转换链 / 透传
  index.ts
```

#### 统一适配器接口

每个格式模块导出：

```ts
type FormatName = 'chat' | 'anthropic' | 'responses';

interface FormatAdapter {
  name: FormatName;

  // JSON（纯函数，无状态）
  toChatRequest(req: any): ChatRequest;
  fromChatRequest(chat: ChatRequest): any;
  toChatResponse(resp: any): ChatResponse;
  fromChatResponse(chat: ChatResponse): any;

  // 流式（工厂返回有状态实例）
  createUpstreamStream(): StreamConverter;   // 入站：上游 Format chunk -> ChatChunk[]
  createDownstreamStream(): StreamConverter; // 出站：ChatChunk[] -> 客户端 Format SSE
}
```

`StreamConverter` 接口（方案 1）：

```ts
interface StreamConverter {
  transform(chunk: any): any[]; // 一条上游 chunk -> 0..n 条下游 chunk
  flush(): any[];               // 收尾（补 message_stop / [DONE] 等）
}
```

- 现有 `openai-to-anthropic.ts` / `anthropic-to-openai.ts` 的逻辑**平移**进 `formats/anthropic/`（即 anthropic→chat 与 chat→anthropic 两个方向），行为不变。
- `chat` 格式即 canonical 本身：`toChat*` 恒等、`fromChat*` 恒等；stream 实例直传 chunk（仅做必要校验）。

### 3. 路由中介（router.ts）

输入 `(sourceFormat, providerFormat)`：

- `source === provider` → 双向透传（passthrough），不实例化转换器。
- `source !== provider` →
  - 请求：`source.toChatRequest(req)` → `provider.fromChatRequest(chat)`
  - 响应流：先 `provider.createUpstreamStream()` 把上游 Format chunk 转成 ChatChunk，再 `source.createDownstreamStream()` 把 ChatChunk 转成客户端 Format SSE。两条腿各持自己的 stateful 实例，串联在 handler 的 ReadableStream 里。

### 4. 接入 OpenAI Responses API

- **客户端入站（新路由）**：新增 `src/routes/responses/`（镜像 `messages` 与 `chat-completions` 的 handler 结构）。路由入口按路径判定 source 为 `responses`，调用 `router.ts` 走转换链。
- **provider 出站（新类型）**：`src/config.ts:5` 的 `ProviderType` 由 `'openai' | 'anthropic'` 扩展为 `'openai' | 'anthropic' | 'response-api'`。provider 为 `response-api` 时，router 使用 `formats/responses` 的 `fromChat*` 发射，并以 Responses 命名事件 SSE 返回。
- **`formats/responses/` 全量移植 cc-switch**：
  - `transform_responses.rs`（1713 行）：`instructions` / `previous_response_id` 持久化 / `tools` / `include` / `encrypted_content` 保真，以及 Read 工具参数清洗（`sanitize_anthropic_tool_use_input`）。
  - `streaming_responses.rs`（1185 行）：命名事件状态机 `response.created → output_item.added → content_part.added → output_text.delta → … → response.completed`，含 `reasoning.delta`、`refusal.delta`、`function_call_arguments.delta/done` 到 Anthropic 事件的映射，以及 dangling block 收尾。

### 5. 测试

cc-switch 测试为 Rust（`cargo test`），当前项目为 TypeScript（`vitest`），无法直接执行。策略：

- 将 cc-switch `streaming_responses.rs` / `transform_responses.rs` 的**关键用例（输入 + 期望输出）** 移植为 `tests/converters/responses/*.test.ts`，断言方式对齐现有 `tests/converters/**`（函数调用 + 流式字符串包含断言）。覆盖：
  - function_call 流式（content_block_start/input_json_delta/tool_use/stop_reason）
  - Read 工具空 `pages` 参数清洗
  - reasoning delta → thinking_delta
  - refusal delta
  - 多轮 `previous_response_id` 延续
  - usage 透传（input_tokens/output_tokens）
- 现有 `tests/converters/**` 随目录迁移保留。
- 交付前运行 `npm test`（vitest run）确保全绿，视为完成门槛。

### 6. 实施步骤（增量，每步带测试）

1. 建立 `canonical/types.ts`（Chat* + `[FIDELITY-SLOT]` 槽），迁移现有类型。
2. 定义 `FormatAdapter` / `StreamConverter` 接口与 `router.ts` 骨架。
3. 平移 `anthropic` 适配器（请求/响应 JSON + 有状态流），迁移现有测试到 `tests/converters/anthropic/`，接 router，跑测试确认等价。
4. 实现 `chat` 恒等适配器。
5. 新增 `responses` 适配器：先请求 JSON，再响应 JSON，最后流式（全量移植 cc-switch）。
6. 新增 `/v1/responses` 路由 + `ProviderType` 扩展 `'response-api'`。
7. 移植 cc-switch Responses 测试用例到 `tests/converters/responses/`，`npm test` 全绿。

### 7. 风险与边界

- Responses 全量移植工作量约 3000 行等效 TS，按第 6 节分三步增量，避免一次性大改动。
- 保真短接（anthropic↔responses 直接转、保留 `encrypted_content`）通过 canonical 的 `[FIDELITY-SLOT]` 槽位承载，不破坏星型统一性；若未来确有性能/保真强需求，可在 `router.ts` 加 `source===anthropic && provider===responses` 之类的直接短接特例（本期不实现，留扩展点）。
- 现有 `/v1/messages`、`/v1/chat/completions` 行为必须保持不变（仅重构内部转换组织方式，不改外部语义）。

## 成功标准

- 新增格式只需实现一组 `FormatAdapter`（4 个纯函数 + 2 个流工厂）即可接入，无需改动其他格式代码。
- `/v1/messages`、`/v1/chat/completions` 行为不变，现有测试全绿。
- `/v1/responses` 端到端可用（入站 + `response-api` provider 出站），含流式与保真项。
- `npm test` 全绿，且包含从 cc-switch 移植的 Responses 转换用例。
