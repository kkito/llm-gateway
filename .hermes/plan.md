# LLM Gateway 格式转换架构重构计划

## 当前架构
```
chat-completions/ 和 messages/ 两个路由 90% 逻辑重复
每个路由都有各自的：handler, upstream-request, model-fallback, 
response-processor, non-stream-handler, stream-handler
```

## 目标架构
```
All formats -> OpenAI hub -> common/handler -> output conversion
chat-completions/ 和 messages/ 变成 20-60 行的薄 wrapper
核心逻辑集中在 src/routes/common/
```

## 计划

### Phase 1: 创建 common/ 层 (6个文件)
1. common/upstream-request.ts — 从 chat-completions/upstream-request.ts 提炼
2. common/model-fallback.ts — 从 chat-completions/model-fallback.ts 提炼（messages/msg-fallback 几乎一样）
3. common/response-processor.ts — 从 chat-completions/response-processor.ts 提炼
4. common/non-stream-handler.ts — 合并两路的 non-stream 逻辑
5. common/stream-handler.ts — 合并两路的 stream 逻辑
6. common/handler.ts — 从 chat-completions/handler.ts 提炼，加 outputFormat 参数

### Phase 2: 精简 chat-completions/
- handler.ts → 薄 wrapper (调用 common/handler with outputFormat='openai')
- 删除: response-processor.ts, non-stream-handler.ts, stream-handler.ts, model-fallback.ts

### Phase 3: 精简 messages/
- handler.ts → 薄 wrapper (Anthropic→OpenAI 入站转换, 调用 common/handler with outputFormat='anthropic')
- 删除: msg-response.ts, non-stream-handler.ts, stream-handler.ts, msg-fallback.ts

### Phase 4: 验证
- npx tsc --noEmit 零错误
