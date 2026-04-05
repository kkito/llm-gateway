# 路由文件按职责拆分设计

## 目标

将 `src/routes/chat-completions.ts` (888行) 和 `src/routes/messages.ts` (784行) 按职责拆分为多个子目录，每个文件不超过 200 行，消除重复代码，保持对外 API 不变。

## 拆分方案

### 一、chat-completions.ts

```
src/routes/chat-completions/
├── index.ts              (~15行)   路由注册，导出 createChatCompletionsRoute
├── handler.ts            (~140行)  主 handler：入参校验、model/modelGroup 解析、限频检查、调度
├── upstream-request.ts   (~60行)   buildUpstreamRequest(provider, body, stream) → {url, headers, body}
├── stream-handler.ts     (~180行)  handleStream(response, provider, requestId, model, logEntry, ...) → ReadableStream
├── non-stream-handler.ts (~60行)   handleNonStream(response, provider, model, logEntry, rateLimiter, ...) → Response
├── model-fallback.ts     (~200行)  tryModelGroupWithFallback (从 13 参数改为 context 对象)
└── response-processor.ts (~200行)  processSuccessfulResponse: 成功后调用 handleNonStream 或 handleStream
```

### 二、messages.ts

```
src/routes/messages/
├── index.ts              (~15行)   路由注册，导出 createMessagesRoute
├── handler.ts            (~130行)  主 handler：入参校验、model/modelGroup 解析
├── upstream-request.ts   (~50行)   构建 upstream 请求 (Anthropic 格式 ↔ OpenAI 格式)
├── stream-handler.ts     (~170行)  handleStream (OpenAI SSE → Anthropic SSE 转换)
├── non-stream-handler.ts (~50行)   handleNonStream
├── msg-fallback.ts       (~200行)  tryMessagesFallback
└── msg-response.ts       (~170行)  processMessagesSuccess
```

### 三、模块依赖关系

```
chat-completions/index.ts
  └── handler
        ├── upstream-request.buildUpstreamRequest
        ├── non-stream-handler.handleNonStream
        ├── stream-handler.handleStream
        ├── response-processor.processSuccessfulResponse
        └── model-fallback.tryModelGroupWithFallback

chat-completions/model-fallback.ts
  ├── upstream-request.buildUpstreamRequest
  └── response-processor.processSuccessfulResponse

chat-completions/response-processor.ts
  ├── non-stream-handler.handleNonStream
  └── stream-handler.handleStream
```

## 关键约束

1. **对外 API 不变** — `server.ts` 的 `import { createChatCompletionsRoute } from './routes/chat-completions.js'` 和 `import { createMessagesRoute } from './routes/messages.js'` 完全不需要修改
2. **零逻辑变更** — 提取的函数内部行为不变，只是移动到新文件
3. **消除重复** — upstream 请求构建、流式 SSE 处理在原文件中各出现 2 次，拆分后只保留一份
4. **函数参数精简** — `tryModelGroupWithFallback` / `processSuccessfulResponse` 用 context 对象替代 12-13 个独立参数
5. **测试同步更新** — 所有现有测试（`tests/routes*`, `tests/e2e/proxy*`, `tests/e2e/model-group*` 等）必须通过，必要时更新 import 路径

## 错误处理

拆分后错误处理逻辑不变：
- `TimeoutError` → 504
- `ModelGroupExhaustedError` → 429
- `Model group` 配置错误 → 400
- 其他 → 500

这些在 `handler.ts` 的 catch 块中保持原样。

## 测试策略

1. 拆分前：`pnpm test` 确认 baseline 全通过
2. 拆分过程中：先提工具函数（upstream-request, stream-handler），编译确认无错误
3. 拆分完成后：`pnpm test` 确认全通过，重点关注：
   - `tests/routes.test.ts`
   - `tests/routes-alias.test.ts`
   - `tests/e2e/proxy.e2e.test.ts`
   - `tests/e2e/model-group.e2e.test.ts`
   - `tests/e2e/sse-response-conversion.e2e.test.ts`
   - `tests/routes/sse-passthrough.test.ts`
