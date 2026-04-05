# 路由文件按职责拆分实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `chat-completions.ts` (888行) 和 `messages.ts` (784行) 按职责拆分为多个子目录，每个文件不超过 200 行，消除重复代码。

**Architecture:** 每个路由文件拆成一个目录，用子模块按职责分隔（upstream request / stream handler / non-stream handler / fallback / response processor）。对外 API 不变（`server.ts` 的 import 引用无需修改）。

**Tech Stack:** TypeScript, Hono, Vitest

---

## 文件结构总览

### 创建的文件

```
src/routes/chat-completions/
├── index.ts              路由注册 + 导出 createChatCompletionsRoute
├── handler.ts            主 handler：入参校验、model 解析、限频、dispatch
├── upstream-request.ts   buildUpstreamRequest(provider, body, stream)
├── stream-handler.ts     handleStream：SSE ReadableStream 处理
├── non-stream-handler.ts handleNonStream：非流式 JSON + 格式转换
├── model-fallback.ts     tryModelGroupWithFallback
└── response-processor.ts processSuccessfulResponse

src/routes/messages/
├── index.ts              路由注册 + 导出 createMessagesRoute
├── handler.ts            主 handler
├── upstream-request.ts   构建 upstream 请求
├── stream-handler.ts     SSE 流式处理 (OpenAI→Anthropic)
├── non-stream-handler.ts handleNonStream
├── msg-fallback.ts       tryMessagesFallback
└── msg-response.ts       processMessagesSuccess
```

### 删除的文件
- `src/routes/chat-completions.ts`（原文件）
- `src/routes/messages.ts`（原文件）

### 修改的文件
- `src/server.ts` — import 路径从 `'./routes/chat-completions.js'` 改为 `'./routes/chat-completions/index.js'`（Hono ES module  resolver 需要显式指向 index）— **实际上 TypeScript 解析 `./routes/chat-completions` 会自动找到 `./routes/chat-completions/index.ts`**，所以 server.ts **不需要修改**。

---

## 阶段一：拆分 chat-completions.ts

### Task 1：创建 `upstream-request.ts` — 上游请求构建

**Files:**
- Create: `src/routes/chat-completions/upstream-request.ts`

- [ ] **Step 1: 创建 upstream-request.ts**

```typescript
/**
 * 构建上游请求 (URL / Headers / Body)
 */
import type { ProviderConfig } from '../../config.js';
import { buildHeaders, buildUrl } from '../../providers/index.js';
import type { DetailLogger } from '../../detail-logger.js';
import { convertOpenAIRequestToAnthropic } from '../../converters/openai-to-anthropic.js';

export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: any;
}

export function buildUpstreamRequest(
  provider: ProviderConfig,
  body: any,
  stream: boolean
): UpstreamRequest {
  let upstreamBody: any;

  if (provider.provider === 'openai') {
    upstreamBody = {
      ...body,
      ...(stream ? { stream_options: { include_usage: true } } : {})
    };
  } else {
    // Anthropic: 转换请求格式
    const anthropicRequest = convertOpenAIRequestToAnthropic(body);
    upstreamBody = { ...anthropicRequest, model: provider.realModel };
  }

  return {
    url: buildUrl(provider, 'chat'),
    headers: buildHeaders(provider),
    body: upstreamBody
  };
}

export async function sendUpstreamRequest(
  upstream: UpstreamRequest,
  detailLogger: DetailLogger,
  requestId: string,
  timeoutMs: number
): Promise<Response> {
  detailLogger.logUpstreamRequest(requestId, upstream.body);
  console.log(`   📤 [Proxy 转发] ${upstream.url}`);

  const response = await fetch(upstream.url, {
    method: 'POST',
    headers: upstream.headers,
    body: JSON.stringify(upstream.body),
    signal: AbortSignal.timeout(timeoutMs)
  });

  console.log(`   📤 [响应] 状态码：${response.status}`);

  if (!response.ok) {
    try {
      const errorText = await response.clone().text();
      console.log(`   ❌ [错误详情] ${errorText}`);
    } catch {
      // 忽略解析错误
    }
  }

  return response;
}
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to new files

---

### Task 2：创建 `stream-handler.ts` — 流式 SSE 处理

**Files:**
- Create: `src/routes/chat-completions/stream-handler.ts`

- [ ] **Step 1: 读取原 stream-handler 相关的代码**

读取 `src/routes/chat-completions.ts` 行 271–439（流式处理主逻辑）和 756–878（`processSuccessfulResponse` 中的流式处理），确认完整逻辑。

- [ ] **Step 2: 创建 stream-handler.ts**

```typescript
/**
 * 流式 SSE 响应处理 (ReadableStream loop)
 */
import type { ProviderConfig } from '../../config.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { Logger } from '../../logger.js';
import {
  createStreamConverterState,
  type StreamConverterState
} from '../../converters/anthropic-to-openai.js';
import { buildFullOpenAIResponse, parseAndConvertAnthropicSSE } from '../utils/sse-handlers.js';

interface StreamHandlerOptions {
  response: Response;
  provider: ProviderConfig;
  model: string;
  requestId: string;
  startTime: number;
  logEntry: any;
  rateLimiter: RateLimiter;
  logger: Logger;
  detailLogger: DetailLogger;
  c: any;
}

export function handleStream(options: StreamHandlerOptions): Response {
  const { response, provider, model, requestId, startTime, logEntry, rateLimiter, logger, detailLogger, c } = options;

  const providerFormat = provider.provider;
  const streamState = providerFormat === 'anthropic' ? createStreamConverterState() : undefined;

  const chunks: string[] = [];
  const rawChunks: string[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  const transformedStream = new ReadableStream({
    async start(controller) {
      try {
        let buffer = '';
        let finalUsage: any = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // OpenRouter 特殊处理
            if (provider.baseUrl?.includes('openrouter') && buffer.trim()) {
              let sseLine = buffer;
              if (!sseLine.startsWith('data:')) sseLine = `data: ${sseLine}`;
              if (!sseLine.endsWith('\n\n')) sseLine += '\n\n';
              chunks.push(sseLine);
              try { controller.enqueue(new TextEncoder().encode(sseLine)); } catch { /* ignore */ }
            }

            detailLogger.logStreamResponse(requestId + '_raw', rawChunks);

            // 提取最终 usage
            for (let i = chunks.length - 1; i >= 0; i--) {
              try {
                const chunkJson = JSON.parse(chunks[i].slice(5).trim());
                if (chunkJson.usage?.prompt_tokens_details?.cached_tokens) {
                  logEntry.cachedTokens = chunkJson.usage.prompt_tokens_details.cached_tokens;
                  finalUsage = chunkJson.usage;
                  break;
                }
                if (chunkJson.usage?.cache_read_input_tokens) {
                  logEntry.cachedTokens = chunkJson.usage.cache_read_input_tokens;
                  finalUsage = chunkJson.usage;
                  break;
                }
                if (chunkJson.usage && !finalUsage) {
                  finalUsage = chunkJson.usage;
                }
              } catch {
                // ignore
              }
            }

            if (finalUsage) {
              logEntry.promptTokens = finalUsage.prompt_tokens || finalUsage.input_tokens;
              logEntry.completionTokens = finalUsage.completion_tokens || finalUsage.output_tokens;
              logEntry.totalTokens = finalUsage.total_tokens || (logEntry.promptTokens || 0) + (logEntry.completionTokens || 0);
            }

            if (finalUsage) {
              const finalChunk = `data: ${JSON.stringify({
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: {}, finish_reason: null }],
                usage: finalUsage
              })}\n\n`;
              controller.enqueue(new TextEncoder().encode(finalChunk));
            }

            detailLogger.logStreamResponse(requestId, chunks);
            const fullResponse = buildFullOpenAIResponse(chunks);
            detailLogger.logConvertedResponse(requestId, fullResponse);
            logger.log(logEntry);

            const pricing = provider.inputPricePer1M !== undefined && provider.outputPricePer1M !== undefined && provider.cachedPricePer1M !== undefined
              ? { inputPricePer1M: provider.inputPricePer1M, outputPricePer1M: provider.outputPricePer1M, cachedPricePer1M: provider.cachedPricePer1M }
              : undefined;
            rateLimiter.recordUsage(model, logEntry, pricing);

            controller.close();
            break;
          }

          const chunk = decoder.decode(value, { stream: false });
          rawChunks.push(chunk);
          buffer += chunk;

          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            if (!part.trim()) continue;
            if (provider.baseUrl?.includes('openrouter') && part.startsWith(':')) continue;

            if (providerFormat === 'anthropic') {
              const openAIChunks = parseAndConvertAnthropicSSE(part, requestId, model, streamState!);
              for (const openAIChunk of openAIChunks) {
                chunks.push(openAIChunk);
                controller.enqueue(new TextEncoder().encode(openAIChunk));
              }
            } else {
              let sseLine = part;
              if (!sseLine.startsWith('data:')) sseLine = `data: ${sseLine}`;
              if (!sseLine.endsWith('\n\n')) sseLine += '\n\n';

              chunks.push(sseLine);
              try {
                controller.enqueue(new TextEncoder().encode(sseLine));
              } catch (err: any) {
                if (err?.name === 'AbortError' || err?.code === 'ERR_INVALID_STATE' || err?.message?.includes('Controller is already closed')) {
                  return;
                }
                throw err;
              }
            }
          }
        }
      } catch (error) {
        console.log(`   ❌ [流式处理错误] ${error}`);
        try { controller.error(error); } catch { /* ignore */ }
      }
    }
  });

  console.log(`\n✅ [完成] ${requestId} - 耗时：${Date.now() - startTime}ms\n`);
  return c.body(transformedStream);
}
```

- [ ] **Step 3: 编译验证**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

---

### Task 3：创建 `non-stream-handler.ts` — 非流式响应处理

**Files:**
- Create: `src/routes/chat-completions/non-stream-handler.ts`

- [ ] **Step 1: 创建 non-stream-handler.ts**

```typescript
/**
 * 非流式响应处理
 */
import type { ProviderConfig } from '../../config.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { Logger } from '../../logger.js';
import { convertAnthropicResponseToOpenAI } from '../../converters/openai-to-anthropic.js';

export function handleNonStream(
  response: Response,
  provider: ProviderConfig,
  model: string,
  logEntry: any,
  rateLimiter: RateLimiter,
  logger: Logger
): Response | null {
  // response.clone 用于读取 body
  const clone = response.clone();

  return clone.json().then((responseData: any) => {
    if (provider.provider === 'anthropic') {
      const openaiResponse = convertAnthropicResponseToOpenAI(responseData, model);
      logEntry.promptTokens = responseData.usage?.input_tokens;
      logEntry.completionTokens = responseData.usage?.output_tokens;
      logEntry.totalTokens = responseData.usage?.input_tokens + responseData.usage?.output_tokens;
      logEntry.cachedTokens = responseData.usage?.cache_read_input_tokens ?? null;
      console.log(`   🔄 [Anthropic→OpenAI 转换]`);
      logger.log(logEntry);
      const pricing = getPruning(provider);
      rateLimiter.recordUsage(model, logEntry, pricing);
      // 返回新响应
      return { response: openaiResponse, type: 'json' as const };
    } else {
      logEntry.promptTokens = responseData.usage?.prompt_tokens;
      logEntry.completionTokens = responseData.usage?.completion_tokens;
      logEntry.totalTokens = responseData.usage?.total_tokens;
      logEntry.cachedTokens = responseData.usage?.prompt_tokens_details?.cached_tokens ?? null;
      logger.log(logEntry);
      const pricing = getPruning(provider);
      rateLimiter.recordUsage(model, logEntry, pricing);
      return { response: responseData, type: 'json' as const };
    }
  }).catch(() => null);
}

function getPruning(provider: ProviderConfig) {
  return provider.inputPricePer1M !== undefined && provider.outputPricePer1M !== undefined && provider.cachedPricePer1M !== undefined
    ? { inputPricePer1M: provider.inputPricePer1M, outputPricePer1M: provider.outputPricePer1M, cachedPricePer1M: provider.cachedPricePer1M }
    : undefined;
}
```

> 注意：因为原代码中 `handleNonStream` 返回的是 `c.json(...)` 的 Response 对象，但在这里我们让 handler 返回 `{ response, type }`，由调用方调用 `c.json()` 来返回，保持 Hono context 解耦。后续 `handler.ts` 和 `response-processor.ts` 都调用此函数并做同样处理。

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit 2>&1 | head -20`

---

### Task 4：创建 `model-fallback.ts` — 模型组 Fallback 循环

**Files:**
- Create: `src/routes/chat-completions/model-fallback.ts`

- [ ] **Step 1: 创建 model-fallback.ts**

```typescript
/**
 * Model Group Fallback 机制
 */
import type { Hono } from 'hono';
import type { ProviderConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import { buildUpstreamRequest, sendUpstreamRequest } from './upstream-request.js';
import { processSuccessfulResponse } from './response-processor.js';

export interface FallbackResult {
  actualModel: string | undefined;
  triedModels: Array<{ model: string; exceeded: boolean; message?: string }>;
  response: Response;
}

export interface FallbackContext {
  c: any;
  modelNames: string[];
  allProviders: ProviderConfig[];
  body: any;
  stream: boolean;
  rateLimiter: RateLimiter;
  logger: Logger;
  detailLogger: DetailLogger;
  requestId: string;
  startTime: number;
  currentUser: any;
  modelGroupName: string;
  timeoutMs: number;
  logDir: string;
}

export async function tryModelGroupWithFallback(ctx: FallbackContext): Promise<FallbackResult> {
  const {
    c, modelNames, allProviders, body, stream,
    rateLimiter, logger, detailLogger, requestId,
    startTime, currentUser, modelGroupName, timeoutMs, logDir
  } = ctx;

  const triedModels: Array<{ model: string; exceeded: boolean; message?: string }> = [];
  let lastErrorBody: any = null;
  let lastErrorStatus = 500;

  for (const modelName of modelNames) {
    const provider = allProviders.find(p => p.customModel === modelName);
    if (!provider) {
      triedModels.push({ model: modelName, exceeded: false, message: 'Model config not found' });
      continue;
    }

    const limitResult = await rateLimiter.checkLimits(provider, logDir);
    if (limitResult.exceeded) {
      triedModels.push({ model: modelName, exceeded: true, message: limitResult.message });
      continue;
    }

    const upstream = buildUpstreamRequest(provider, body, stream);
    const response = await sendUpstreamRequest(upstream, detailLogger, requestId, timeoutMs);

    if (!response.ok) {
      triedModels.push({ model: modelName, exceeded: false, message: `HTTP ${response.status}` });
      try {
        lastErrorBody = await response.json();
      } catch {
        lastErrorBody = { error: { message: `HTTP ${response.status}` } };
      }
      lastErrorStatus = response.status;
      continue;
    }

    console.log(`   ✓ 使用模型：${modelName}`);
    const processedResponse = await processSuccessfulResponse({
      c, response, provider, modelName, stream, body,
      rateLimiter, logger, detailLogger, requestId,
      startTime, currentUser, modelGroupName, triedModels
    });

    return { actualModel: modelName, triedModels, response: processedResponse };
  }

  // 所有模型都失败
  logger.log({
    timestamp: new Date().toISOString(),
    requestId,
    customModel: modelNames[0] || 'unknown',
    modelGroup: modelGroupName,
    actualModel: undefined,
    triedModels: triedModels.length > 0 ? triedModels : undefined,
    endpoint: c.req.path,
    method: 'POST',
    statusCode: lastErrorStatus,
    durationMs: Date.now() - startTime,
    isStreaming: !!stream,
    userName: currentUser?.name
  });

  return { actualModel: undefined, triedModels, response: c.json(lastErrorBody, lastErrorStatus) };
}
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit 2>&1 | head -20`

---

### Task 5：创建 `response-processor.ts` — 成功响应处理器

**Files:**
- Create: `src/routes/chat-completions/response-processor.ts`

- [ ] **Step 1: 创建 response-processor.ts**

```typescript
/**
 * 成功响应处理器 (非流式/流式分发)
 */
import type { ProviderConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import { handleNonStream } from './non-stream-handler.js';
import { handleStream } from './stream-handler.js';

export interface ProcessResponseOptions {
  c: any;
  response: Response;
  provider: ProviderConfig;
  modelName: string;
  stream: boolean;
  body: any;
  rateLimiter: RateLimiter;
  logger: Logger;
  detailLogger: DetailLogger;
  requestId: string;
  startTime: number;
  currentUser: any;
  modelGroup: string | undefined;
  triedModels: Array<{ model: string; exceeded: boolean; message?: string }>;
}

export async function processSuccessfulResponse(options: ProcessResponseOptions): Promise<Response> {
  const {
    c, response, provider, modelName, stream, body,
    rateLimiter, logger, detailLogger, requestId,
    startTime, currentUser, modelGroup, triedModels
  } = options;

  const logEntry: any = {
    timestamp: new Date().toISOString(),
    requestId,
    customModel: modelGroup ? modelName : body.model,
    modelGroup,
    actualModel: modelName,
    triedModels: triedModels.length > 0 ? triedModels : undefined,
    realModel: provider.realModel,
    provider: provider.provider,
    endpoint: c.req.path,
    method: 'POST',
    statusCode: response.status,
    durationMs: Date.now() - startTime,
    isStreaming: !!stream,
    userName: currentUser?.name
  };

  // 认证检查
  if ((c as any).userAuthEnabled && !currentUser) {
    logger.log({ ...logEntry, statusCode: 401, error: { message: 'Authentication required' } });
    return c.json({ error: { message: 'Authentication required' } }, 401);
  }

  // 非流式响应
  if (!stream) {
    const result = handleNonStream(response, provider, modelName, logEntry, rateLimiter, logger);
    if (result) {
      const pricing = getPruning(provider);
      rateLimiter.recordUsage(modelName, logEntry, pricing);
      return c.json(result);
    }
  }

  logger.log(logEntry);

  if (!response.body) {
    console.log(`\n❌ [错误] 上游响应体为空 ${requestId}`);
    return c.json({ error: { message: 'No response body' } }, 500);
  }

  // 流式响应
  if (stream) {
    return handleStream({
      response, provider, model: modelName, requestId, startTime,
      logEntry, rateLimiter, logger, detailLogger, c
    });
  }

  console.log(`\n✅ [完成] ${requestId} - 耗时：${Date.now() - startTime}ms\n`);
  return c.body(response.body);
}

function getPruning(provider: ProviderConfig) {
  return provider.inputPricePer1M !== undefined && provider.outputPricePer1M !== undefined && provider.cachedPricePer1M !== undefined
    ? { inputPricePer1M: provider.inputPricePer1M, outputPricePer1M: provider.outputPricePer1M, cachedPricePer1M: provider.cachedPricePer1M }
    : undefined;
}
```

> ⚠️ **重要修正**：`handleNonStream` 返回的是 `{ response, type }` 对象，但在 `processSuccessfulResponse` 里我们需要调用 `c.json()` 返回。同时原代码中 `handleNonStream` 内部已经调用了 `rateLimiter.recordUsage` 和 `logger.log`。所以 `handleNonStream` 的设计需要调整为返回 `responseData | null`（不做 recordUsage），由调用方做 recordUsage。

重新设计 `non-stream-handler.ts`：

```typescript
/**
 * 非流式响应处理
 */
import type { ProviderConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import { convertAnthropicResponseToOpenAI } from '../../converters/openai-to-anthropic.js';

export interface NonStreamResult {
  responseData: any;  // 转换后或直接使用的响应数据
  logEntry: any;      // 填充了 token 信息的日志条目
}

export async function handleNonStream(
  response: Response,
  provider: ProviderConfig,
  model: string,
  logEntry: any,
  logger: Logger
): Promise<NonStreamResult | null> {
  try {
    const responseData = await response.clone().json() as any;

    if (provider.provider === 'anthropic') {
      const openaiResponse = convertAnthropicResponseToOpenAI(responseData, model);
      logEntry.promptTokens = responseData.usage?.input_tokens;
      logEntry.completionTokens = responseData.usage?.output_tokens;
      logEntry.totalTokens = responseData.usage?.input_tokens + responseData.usage?.output_tokens;
      logEntry.cachedTokens = responseData.usage?.cache_read_input_tokens ?? null;
      console.log(`   🔄 [Anthropic→OpenAI 转换]`);
      return { responseData: openaiResponse, logEntry };
    } else {
      logEntry.promptTokens = responseData.usage?.prompt_tokens;
      logEntry.completionTokens = responseData.usage?.completion_tokens;
      logEntry.totalTokens = responseData.usage?.total_tokens;
      logEntry.cachedTokens = responseData.usage?.prompt_tokens_details?.cached_tokens ?? null;
      return { responseData, logEntry };
    }
  } catch {
    return null;
  }
}
```

相应地 `response-processor.ts` 中的非流式部分改为：

```typescript
  if (!stream) {
    const result = await handleNonStream(response, provider, modelName, logEntry, logger);
    if (result) {
      logger.log(result.logEntry);
      const pricing = getPruning(provider);
      rateLimiter.recordUsage(modelName, result.logEntry, pricing);
      return c.json(result.responseData);
    }
  }
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit 2>&1 | head -20`

---

### Task 6：创建 `handler.ts` — 主 Handler

**Files:**
- Create: `src/routes/chat-completions/handler.ts`

- [ ] **Step 1: 创建 handler.ts**

```typescript
/**
 * Chat Completions 主 Handler
 */
import type { Hono } from 'hono';
import type { ProviderConfig, ProxyConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import { v4 as uuidv4 } from 'uuid';
import { ModelGroupResolver } from '../../lib/model-group-resolver.js';
import { getCurrentUser } from '../../user/middleware/auth.js';
import { RateLimiter } from '../../lib/rate-limiter.js';
import { buildUpstreamRequest, sendUpstreamRequest } from './upstream-request.js';
import { handleNonStream } from './non-stream-handler.js';
import { handleStream } from './stream-handler.js';
import { tryModelGroupWithFallback } from './model-fallback.js';
import { processSuccessfulResponse } from './response-processor.js';

export function createChatCompletionsHandler(
  config: ProxyConfig | (() => ProxyConfig),
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number,
  logDir: string
) {
  const rateLimiter = new RateLimiter(logDir);

  return async (c: any, endpoint: string) => {
    const startTime = Date.now();
    const requestId = uuidv4();
    let customModel = 'unknown';
    let modelGroup: string | undefined;
    let actualModel: string | undefined;
    let triedModels: Array<{ model: string; exceeded: boolean; message?: string }> = [];
    let body: any = {};

    const currentUser = (c as any).currentUser || getCurrentUser(c);

    try {
      body = await c.req.json();
      const { model, model_group, stream } = body;

      console.log(`   🔍 [调试] body.model=${JSON.stringify(model)}, body.model_group=${JSON.stringify(model_group)}`);

      if (model && model_group) {
        return c.json({ error: { message: 'model and model_group are mutually exclusive', type: 'invalid_request_error' } }, 400);
      }
      if (!model && !model_group) {
        return c.json({ error: { message: 'Either model or model_group must be provided', type: 'invalid_request_error' } }, 400);
      }

      detailLogger.logRequest(requestId, body);

      const currentConfig = typeof config === 'function' ? config() : config;
      let provider: ProviderConfig | undefined;

      if (model_group) {
        modelGroup = model_group;
        console.log(`\n📥 [请求] ${requestId} - 模型组：${model_group} - 流式：${!!stream}`);
        const resolver = new ModelGroupResolver();
        const modelNames = resolver.resolveModelGroup(currentConfig.modelGroups, model_group);
        console.log(`   ✓ 匹配 model_group: ${model_group} -> [${modelNames.join(', ')}]`);

        const fallbackResult = await tryModelGroupWithFallback({
          c, modelNames, allProviders: currentConfig.models, body, stream,
          rateLimiter, logger, detailLogger, requestId,
          startTime, currentUser, modelGroupName: model_group, timeoutMs, logDir
        });
        actualModel = fallbackResult.actualModel;
        triedModels = fallbackResult.triedModels;
        customModel = actualModel || 'unknown';
        return fallbackResult.response;
      } else {
        customModel = model;
        console.log(`\n📥 [请求] ${requestId} - 模型：${model} - 流式：${!!stream}`);

        const found = currentConfig.models.find(p => p.customModel === model);
        if (found) {
          provider = found;
          actualModel = model;
        } else if (currentConfig.modelGroups) {
          try {
            const resolver = new ModelGroupResolver();
            const modelNames = resolver.resolveModelGroup(currentConfig.modelGroups, model);
            console.log(`   🔍 智能识别：${model} 被识别为 modelGroup -> [${modelNames.join(', ')}]`);
            modelGroup = model;
            console.log(`\n📥 [请求] ${requestId} - 模型组：${model} - 流式：${!!stream}`);
            const fallbackResult = await tryModelGroupWithFallback({
              c, modelNames, allProviders: currentConfig.models, body, stream,
              rateLimiter, logger, detailLogger, requestId,
              startTime, currentUser, modelGroupName: model, timeoutMs, logDir
            });
            actualModel = fallbackResult.actualModel;
            triedModels = fallbackResult.triedModels;
            customModel = actualModel || 'unknown';
            return fallbackResult.response;
          } catch {
            // not a valid modelGroup
          }
        }

        if (!provider) {
          console.log(`   ❌ 未找到模型配置`);
          logger.log({
            timestamp: new Date().toISOString(), requestId, customModel: model,
            endpoint, method: 'POST', statusCode: 404,
            durationMs: Date.now() - startTime, isStreaming: !!stream,
            userName: currentUser?.name, error: { message: 'Model not found' }
          });
          return c.json({ error: { message: 'Model not found' } }, 404);
        }
      }

      console.log(`   ✓ 匹配 provider: ${provider.customModel} -> ${provider.realModel} (${provider.provider})`);

      // 限频检查
      try {
        const limitResult = await rateLimiter.checkLimits(provider, logDir);
        if (limitResult.exceeded) {
          console.log(`   ⚠️  [限制触发] ${limitResult.message}`);
          return c.json(rateLimiter.createErrorResponse(limitResult.message!), 429);
        }
      } catch (error: any) {
        return c.json({ error: { message: error.message } }, 500);
      }

      // 发送上游请求
      const upstream = buildUpstreamRequest(provider, body, stream);
      const response = await sendUpstreamRequest(upstream, detailLogger, requestId, timeoutMs);

      // 构建日志条目
      const logEntry: any = {
        timestamp: new Date().toISOString(),
        requestId,
        customModel: model_group ? actualModel! : model,
        modelGroup: model_group,
        actualModel,
        triedModels: triedModels.length > 0 ? triedModels : undefined,
        realModel: provider.realModel,
        provider: provider.provider,
        endpoint,
        method: 'POST',
        statusCode: response.status,
        durationMs: Date.now() - startTime,
        isStreaming: !!stream,
        userName: currentUser?.name
      };

      // 认证检查
      if ((c as any).userAuthEnabled && !currentUser) {
        logger.log({ ...logEntry, statusCode: 401, error: { message: 'Authentication required' } });
        return c.json({ error: { message: 'Authentication required' } }, 401);
      }

      // 非流式响应处理
      if (response.ok && !stream) {
        const result = await handleNonStream(response, provider, actualModel || model, logEntry, logger);
        if (result) {
          logger.log(result.logEntry);
          const pricing = provider.inputPricePer1M !== undefined && provider.outputPricePer1M !== undefined && provider.cachedPricePer1M !== undefined
            ? { inputPricePer1M: provider.inputPricePer1M, outputPricePer1M: provider.outputPricePer1M, cachedPricePer1M: provider.cachedPricePer1M }
            : undefined;
          rateLimiter.recordUsage(actualModel || model, result.logEntry, pricing);
          return c.json(result.responseData);
        }
      }

      logger.log(logEntry);

      if (!response.body) {
        console.log(`\n❌ [错误] 上游响应体为空 ${requestId}`);
        return c.json({ error: { message: 'No response body' } }, 500);
      }

      // 流式响应
      if (stream && response.ok) {
        return handleStream({
          response, provider, model: actualModel || model, requestId, startTime,
          logEntry, rateLimiter, logger, detailLogger, c
        });
      }

      console.log(`\n✅ [完成] ${requestId} - 耗时：${Date.now() - startTime}ms\n`);
      return c.body(response.body);

    } catch (error: any) {
      console.log(`   ❌ [错误] ${error?.message || 'Unknown error'}`);
      console.log(`   错误类型：${error?.name || 'Unknown'}`);
      console.log(`   耗时：${Date.now() - startTime}ms\n`);

      logger.log({
        timestamp: new Date().toISOString(),
        requestId,
        customModel: modelGroup ? actualModel! : (body.model as string),
        modelGroup,
        endpoint,
        method: 'POST',
        statusCode: 500,
        durationMs: Date.now() - startTime,
        isStreaming: false,
        userName: currentUser?.name,
        error: { message: error.message || 'Internal error', type: error.name }
      });

      if (error.name === 'TimeoutError') {
        return c.json({
          error: { message: 'Upstream timeout', type: 'upstream_timeout', code: 'timeout' }
        }, 504);
      }

      if (error.name === 'ModelGroupExhaustedError') {
        return c.json({
          error: {
            message: error.message || 'All models in group exceeded their limits',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
            param: null
          }
        }, 429);
      }

      if (error.message && error.message.includes('Model group')) {
        return c.json({ error: { message: error.message, type: 'invalid_request_error' } }, 400);
      }

      return c.json({ error: { message: error.message || 'Internal error' } }, 500);
    }
  };
}
```

> **注意**：由于 `handler.ts` 引用了 `model-fallback.ts` 和 `response-processor.ts`，而这两者又引用了 `upstream-request.ts`、`stream-handler.ts`、`non-stream-handler.ts`，这形成 **循环依赖**。需要重新审视依赖关系。

**修正**：`handler.ts` **不**引用 `response-processor.ts`；只有 `model-fallback.ts` 引用。`handler.ts` 自己在非 fallback 路径中内联处理成功响应（和原来一样）。

让我重新审视依赖：

```
index.ts
  → handler.ts（创建 handler 函数 + 路由注册）

handler.ts
  → upstream-request.ts
  → non-stream-handler.ts
  → stream-handler.ts
  → model-fallback.ts（通过 tryModelGroupWithFallback）

model-fallback.ts
  → upstream-request.ts
  → response-processor.ts

response-processor.ts
  → non-stream-handler.ts
  → stream-handler.ts
```

这样就不存在循环依赖了。`handler.ts` 在 fallback 路径外不引用 `processSuccessfulResponse`，而是自己内联处理（和原代码一致）。

---

### Task 7：创建根 `index.ts` — 路由注册

**Files:**
- Create: `src/routes/chat-completions/index.ts`
- Delete: `src/routes/chat-completions.ts`

- [ ] **Step 1: 创建 index.ts**

```typescript
import { Hono } from 'hono';
import type { ProxyConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import { createChatCompletionsHandler } from './handler.js';

export function createChatCompletionsRoute(
  config: ProxyConfig | (() => ProxyConfig),
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number,
  logDir: string
) {
  const router = new Hono();
  const handler = createChatCompletionsHandler(config, logger, detailLogger, timeoutMs, logDir);

  router.post('/v1/chat/completions', (c) => handler(c, '/v1/chat/completions'));
  router.post('/chat/completions', (c) => handler(c, '/chat/completions'));
  router.post('/v1/v1/chat/completions', (c) => handler(c, '/v1/v1/chat/completions'));

  return router;
}
```

- [ ] **Step 2: 删除原文件**

Run: `rm src/routes/chat-completions.ts`

- [ ] **Step 3: 编译验证**

Run: `npx tsc --noEmit 2>&1 | head -40`
Expected: No errors. `server.ts` 的 `import { createChatCompletionsRoute } from './routes/chat-completions.js'` 会自动解析到 `./routes/chat-completions/index.js`。

- [ ] **Step 4: 运行测试**

Run: `pnpm test 2>&1 | tail -20`
Expected: All 391 tests pass (same as baseline)

- [ ] **Step 5: Commit**

```bash
git add src/routes/chat-completions/ && git rm src/routes/chat-completions.ts
git commit -m "refactor: split chat-completions.ts into职责子目录"
```

---

### Task 8：处理循环依赖 — 修正依赖图

**问题**：`handler.ts` 引用 `model-fallback.ts`，而 `model-fallback.ts` 引用 `response-processor.ts`，`response-processor.ts` 引用 `stream-handler.ts`。同时 `handler.ts` 也直接引用 `stream-handler.ts`。这本身不是循环，但需要确保 import 顺序正确。

实际依赖图（无循环）：

```
index.ts ──→ handler.ts
                      ├── upstream-request.ts
                      ├── non-stream-handler.ts
                      ├── stream-handler.ts
                      └── model-fallback.ts
                                    ├── upstream-request.ts
                                    └── response-processor.ts
                                                  ├── non-stream-handler.ts
                                                  └── stream-handler.ts
```

✅ **无循环依赖**，可以直接编译。

- [ ] **Step 1: 全量编译验证**

Run: `npx tsc --noEmit 2>&1`
Expected: No errors

- [ ] **Step 2: 全量测试**

Run: `pnpm test 2>&1 | tail -20`
Expected: 391 passed

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "refactor: verify no circular deps in chat-completions split"
```

---

## 阶段二：拆分 messages.ts

### Task 9：创建 `messages/upstream-request.ts`

**Files:**
- Create: `src/routes/messages/upstream-request.ts`

- [ ] **Step 1: 创建 upstream-request.ts**

```typescript
/**
 * 构建上游请求 (Messages 端点 — Anthropic 格式 ↔ OpenAI 格式)
 */
import type { ProviderConfig } from '../../config.js';
import { buildHeaders, buildUrl } from '../../providers/index.js';
import type { DetailLogger } from '../../detail-logger.js';
import { convertAnthropicRequestToOpenAI } from '../../converters/anthropic-to-openai.js';

export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: any;
}

export function buildUpstreamRequest(
  provider: ProviderConfig,
  body: any,
  _stream: boolean
): UpstreamRequest {
  let upstreamBody: any;

  if (provider.provider === 'anthropic') {
    upstreamBody = { ...body, model: provider.realModel };
  } else {
    // OpenAI provider: 转换请求格式
    const openaiRequest = convertAnthropicRequestToOpenAI(body);
    upstreamBody = { ...openaiRequest, model: provider.realModel };
  }

  return {
    url: buildUrl(provider, 'chat'),
    headers: buildHeaders(provider),
    body: upstreamBody
  };
}

export async function sendUpstreamRequest(
  upstream: UpstreamRequest,
  detailLogger: DetailLogger,
  requestId: string,
  timeoutMs: number
): Promise<Response> {
  detailLogger.logUpstreamRequest(requestId, upstream.body);
  console.log(`   📤 [Proxy 转发] ${upstream.url}`);

  const response = await fetch(upstream.url, {
    method: 'POST',
    headers: upstream.headers,
    body: JSON.stringify(upstream.body),
    signal: AbortSignal.timeout(timeoutMs)
  });

  console.log(`   📤 [响应] 状态码：${response.status}`);

  if (!response.ok) {
    try {
      const errorText = await response.clone().text();
      console.log(`   ❌ [错误详情] ${errorText}`);
    } catch {
      // 忽略解析错误
    }
  }

  return response;
}
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit 2>&1 | head -20`

---

### Task 10：创建 `messages/stream-handler.ts`

**Files:**
- Create: `src/routes/messages/stream-handler.ts`

- [ ] **Step 1: 创建 stream-handler.ts**

```typescript
/**
 * 流式 SSE 响应处理 (Messages 端点 — OpenAI SSE → Anthropic SSE 转换)
 */
import type { ProviderConfig } from '../../config.js';
import type { DetailLogger } from '../../detail-logger.js';
import {
  createOpenAIToAnthropicStreamState
} from '../../converters/openai-to-anthropic.js';
import { parseAndConvertOpenAISSE } from '../utils/sse-handlers-messages.js';

interface StreamHandlerOptions {
  response: Response;
  provider: ProviderConfig;
  model: string;
  requestId: string;
  startTime: number;
  logEntry: any;
  detailLogger: DetailLogger;
  c: any;
}

export function handleStream(options: StreamHandlerOptions): Response {
  const { response, provider, model, requestId, startTime, logEntry, detailLogger, c } = options;

  const providerFormat = provider.provider;
  const streamState = providerFormat === 'openai' ? createOpenAIToAnthropicStreamState() : undefined;

  const chunks: string[] = [];
  const rawChunks: string[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  const transformedStream = new ReadableStream({
    async start(controller) {
      try {
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            detailLogger.logStreamResponse(requestId + '_raw', rawChunks);

            // 提取最终 usage
            let finalUsage: any = null;
            for (let i = chunks.length - 1; i >= 0; i--) {
              try {
                const chunkText = chunks[i];
                const lines = chunkText.split('\n');
                for (const line of lines) {
                  if (line.startsWith('data:')) {
                    const chunkJson = JSON.parse(line.slice(5).trim());
                    if (chunkJson.usage?.prompt_tokens_details?.cached_tokens) {
                      logEntry.cachedTokens = chunkJson.usage.prompt_tokens_details.cached_tokens;
                      finalUsage = chunkJson.usage;
                      break;
                    }
                    if (chunkJson.usage?.input_tokens_details?.cached_tokens) {
                      logEntry.cachedTokens = chunkJson.usage.input_tokens_details.cached_tokens;
                      finalUsage = chunkJson.usage;
                      break;
                    }
                    if (chunkJson.usage && !finalUsage) {
                      finalUsage = chunkJson.usage;
                    }
                  }
                }
              } catch {
                // ignore
              }
            }

            if (finalUsage) {
              logEntry.promptTokens = finalUsage.prompt_tokens || finalUsage.input_tokens;
              logEntry.completionTokens = finalUsage.completion_tokens || finalUsage.output_tokens;
              logEntry.totalTokens = finalUsage.total_tokens || (logEntry.promptTokens || 0) + (logEntry.completionTokens || 0);
            }

            detailLogger.logStreamResponse(requestId, chunks);

            console.log(`\n✅ [完成] ${requestId} - 耗时：${Date.now() - startTime}ms\n`);
            controller.close();
            break;
          }

          const chunk = decoder.decode(value, { stream: false });
          rawChunks.push(chunk);
          buffer += chunk;

          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            if (!part.trim()) continue;

            if (providerFormat === 'openai') {
              const anthropicChunks = parseAndConvertOpenAISSE(part, streamState!);
              for (const anthropicChunk of anthropicChunks) {
                chunks.push(anthropicChunk);
                controller.enqueue(new TextEncoder().encode(anthropicChunk));
              }
            } else {
              let sseLine = part;
              sseLine += '\n\n';

              chunks.push(sseLine);
              try {
                controller.enqueue(new TextEncoder().encode(sseLine));
              } catch (err: any) {
                if (err?.name === 'AbortError' || err?.code === 'ERR_INVALID_STATE' || err?.message?.includes('Controller is already closed')) {
                  return;
                }
                throw err;
              }
            }
          }
        }
      } catch (error) {
        console.log(`   ❌ [流式处理错误] ${error}`);
        try { controller.error(error); } catch { /* ignore */ }
      }
    }
  });

  console.log(`\n✅ [完成] ${requestId} - 耗时：${Date.now() - startTime}ms\n`);
  return c.body(transformedStream);
}
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit 2>&1 | head -20`

---

### Task 11：创建 `messages/non-stream-handler.ts`

**Files:**
- Create: `src/routes/messages/non-stream-handler.ts`

- [ ] **Step 1: 创建**

```typescript
/**
 * 非流式响应处理 (Messages 端点)
 */
import type { ProviderConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import { convertOpenAIResponseToAnthropic } from '../../converters/anthropic-to-openai.js';

export interface NonStreamResult {
  responseData: any;
  logEntry: any;
}

export async function handleNonStream(
  response: Response,
  provider: ProviderConfig,
  model: string,
  logEntry: any,
  logger: Logger
): Promise<NonStreamResult | null> {
  try {
    const responseData = await response.clone().json() as any;

    if (provider.provider === 'openai') {
      const anthropicResponse = convertOpenAIResponseToAnthropic(responseData, model);
      logEntry.promptTokens = responseData.usage?.prompt_tokens;
      logEntry.completionTokens = responseData.usage?.completion_tokens;
      logEntry.totalTokens = responseData.usage?.total_tokens;
      logEntry.cachedTokens = responseData.usage?.prompt_tokens_details?.cached_tokens ?? null;
      console.log(`   🔄 [OpenAI→Anthropic 转换]`);
      return { responseData: anthropicResponse, logEntry };
    } else {
      logEntry.promptTokens = responseData.usage?.input_tokens;
      logEntry.completionTokens = responseData.usage?.output_tokens;
      logEntry.totalTokens = responseData.usage?.input_tokens + responseData.usage?.output_tokens;
      logEntry.cachedTokens = responseData.usage?.cache_read_input_tokens ?? null;
      return { responseData, logEntry };
    }
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: 编译验证**

---

### Task 12：创建 `messages/msg-fallback.ts`

**Files:**
- Create: `src/routes/messages/msg-fallback.ts`

- [ ] **Step 1: 创建**

```typescript
/**
 * Model Group Fallback 机制 (Messages 端点)
 */
import type { ProviderConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import { buildUpstreamRequest, sendUpstreamRequest } from './upstream-request.js';
import { processMessagesSuccess } from './msg-response.js';

export interface MsgFallbackResult {
  actualModel: string | undefined;
  triedModels: Array<{ model: string; exceeded: boolean; message?: string }>;
  response: Response;
}

export interface MsgFallbackContext {
  c: any;
  modelNames: string[];
  allProviders: ProviderConfig[];
  body: any;
  stream: boolean;
  rateLimiter: RateLimiter;
  logger: Logger;
  detailLogger: DetailLogger;
  requestId: string;
  startTime: number;
  currentUser: any;
  modelGroupName: string;
  timeoutMs: number;
  logDir: string;
}

export async function tryMessagesFallback(ctx: MsgFallbackContext): Promise<MsgFallbackResult> {
  const {
    c, modelNames, allProviders, body, stream,
    rateLimiter, logger, detailLogger, requestId,
    startTime, currentUser, modelGroupName, timeoutMs, logDir
  } = ctx;

  const triedModels: Array<{ model: string; exceeded: boolean; message?: string }> = [];
  let lastErrorBody: any = null;
  let lastErrorStatus = 500;

  for (const modelName of modelNames) {
    const provider = allProviders.find(p => p.customModel === modelName);
    if (!provider) {
      triedModels.push({ model: modelName, exceeded: false, message: 'Model config not found' });
      continue;
    }

    const limitResult = await rateLimiter.checkLimits(provider, logDir);
    if (limitResult.exceeded) {
      triedModels.push({ model: modelName, exceeded: true, message: limitResult.message });
      continue;
    }

    const upstream = buildUpstreamRequest(provider, body, stream);
    const response = await sendUpstreamRequest(upstream, detailLogger, requestId, timeoutMs);

    if (!response.ok) {
      triedModels.push({ model: modelName, exceeded: false, message: `HTTP ${response.status}` });
      try {
        lastErrorBody = await response.json();
      } catch {
        lastErrorBody = { error: { message: `HTTP ${response.status}` } };
      }
      lastErrorStatus = response.status;
      continue;
    }

    console.log(`   ✓ 使用模型：${modelName}`);
    const processedResponse = await processMessagesSuccess({
      c, response, provider, modelName, stream, body,
      rateLimiter, logger, detailLogger, requestId,
      startTime, currentUser, modelGroupName, triedModels
    });

    return { actualModel: modelName, triedModels, response: processedResponse };
  }

  // 所有模型都失败
  logger.log({
    timestamp: new Date().toISOString(),
    requestId,
    customModel: modelNames[0] || 'unknown',
    modelGroup: modelGroupName,
    actualModel: undefined,
    triedModels: triedModels.length > 0 ? triedModels : undefined,
    endpoint: c.req.path,
    method: 'POST',
    statusCode: lastErrorStatus,
    durationMs: Date.now() - startTime,
    isStreaming: !!stream,
    userName: currentUser?.name
  });

  return { actualModel: undefined, triedModels, response: c.json(lastErrorBody, lastErrorStatus) };
}
```

- [ ] **Step 2: 编译验证**

---

### Task 13：创建 `messages/msg-response.ts`

**Files:**
- Create: `src/routes/messages/msg-response.ts`

- [ ] **Step 1: 创建**

```typescript
/**
 * 成功响应处理器 (Messages 端点)
 */
import type { ProviderConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import { handleNonStream } from './non-stream-handler.js';
import { handleStream } from './stream-handler.js';

export interface ProcessMsgResponseOptions {
  c: any;
  response: Response;
  provider: ProviderConfig;
  modelName: string;
  stream: boolean;
  body: any;
  rateLimiter: RateLimiter;
  logger: Logger;
  detailLogger: DetailLogger;
  requestId: string;
  startTime: number;
  currentUser: any;
  modelGroup: string | undefined;
  triedModels: Array<{ model: string; exceeded: boolean; message?: string }>;
}

export async function processMessagesSuccess(options: ProcessMsgResponseOptions): Promise<Response> {
  const {
    c, response, provider, modelName, stream, body,
    rateLimiter, logger, detailLogger, requestId,
    startTime, currentUser, modelGroup, triedModels
  } = options;

  const logEntry: any = {
    timestamp: new Date().toISOString(),
    requestId,
    customModel: modelGroup ? modelName : body.model,
    modelGroup,
    actualModel: modelName,
    triedModels: triedModels.length > 0 ? triedModels : undefined,
    realModel: provider.realModel,
    provider: provider.provider,
    endpoint: c.req.path,
    method: 'POST',
    statusCode: response.status,
    durationMs: Date.now() - startTime,
    isStreaming: !!stream,
    userName: currentUser?.name
  };

  // 非流式响应
  if (!stream) {
    const result = await handleNonStream(response, provider, modelName, logEntry, logger);
    if (result) {
      logger.log(result.logEntry);
      const pricing = getPruning(provider);
      rateLimiter.recordUsage(modelName, result.logEntry, pricing);
      return c.json(result.responseData);
    }
  }

  logger.log(logEntry);

  if (!response.body) {
    console.log(`\n❌ [错误] 上游响应体为空 ${requestId}`);
    return c.json({ error: { message: 'No response body' } }, 500);
  }

  // 流式响应
  if (stream) {
    return handleStream({
      response, provider, model: modelName, requestId, startTime,
      logEntry, detailLogger, c
    });
  }

  console.log(`\n✅ [完成] ${requestId} - 耗时：${Date.now() - startTime}ms\n`);
  return c.body(response.body);
}

function getPruning(provider: ProviderConfig) {
  return provider.inputPricePer1M !== undefined && provider.outputPricePer1M !== undefined && provider.cachedPricePer1M !== undefined
    ? { inputPricePer1M: provider.inputPricePer1M, outputPricePer1M: provider.outputPricePer1M, cachedPricePer1M: provider.cachedPricePer1M }
    : undefined;
}
```

- [ ] **Step 2: 编译验证**

---

### Task 14：创建 `messages/handler.ts`

**Files:**
- Create: `src/routes/messages/handler.ts`

- [ ] **Step 1: 创建**

```typescript
/**
 * Messages 主 Handler
 */
import type { ProviderConfig, ProxyConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import { v4 as uuidv4 } from 'uuid';
import { ModelGroupResolver } from '../../lib/model-group-resolver.js';
import { getCurrentUser } from '../../user/middleware/auth.js';
import { RateLimiter } from '../../lib/rate-limiter.js';
import { buildUpstreamRequest, sendUpstreamRequest } from './upstream-request.js';
import { handleNonStream } from './non-stream-handler.js';
import { handleStream } from './stream-handler.js';
import { tryMessagesFallback } from './msg-fallback.js';

export function createMessagesHandler(
  config: ProxyConfig | (() => ProxyConfig),
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number,
  logDir: string
) {
  const rateLimiter = new RateLimiter(logDir);

  return async (c: any, endpoint: string) => {
    const startTime = Date.now();
    const requestId = uuidv4();
    let customModel = 'unknown';
    let modelGroup: string | undefined;
    let actualModel: string | undefined;
    let triedModels: Array<{ model: string; exceeded: boolean; message?: string }> = [];
    let body: any = {};

    const currentUser = getCurrentUser(c);

    try {
      body = await c.req.json();
      const { model, model_group, stream } = body;

      console.log(`   🔍 [调试] body.model=${JSON.stringify(model)}, body.model_group=${JSON.stringify(model_group)}`);

      if (model && model_group) {
        return c.json({ error: { message: 'model and model_group are mutually exclusive', type: 'invalid_request_error' } }, 400);
      }
      if (!model && !model_group) {
        return c.json({ error: { message: 'Either model or model_group must be provided', type: 'invalid_request_error' } }, 400);
      }

      detailLogger.logRequest(requestId, body);

      const currentConfig = typeof config === 'function' ? config() : config;
      let provider: ProviderConfig | undefined;

      if (model_group) {
        modelGroup = model_group;
        console.log(`\n📥 [请求] ${requestId} - 模型组：${model_group} - 流式：${!!stream}`);
        const resolver = new ModelGroupResolver();
        const modelNames = resolver.resolveModelGroup(currentConfig.modelGroups, model_group);
        console.log(`   ✓ 匹配 model_group: ${model_group} -> [${modelNames.join(', ')}]`);

        const fallbackResult = await tryMessagesFallback({
          c, modelNames, allProviders: currentConfig.models, body, stream,
          rateLimiter, logger, detailLogger, requestId,
          startTime, currentUser, modelGroupName: model_group, timeoutMs, logDir
        });
        actualModel = fallbackResult.actualModel;
        triedModels = fallbackResult.triedModels;
        customModel = actualModel || 'unknown';
        return fallbackResult.response;
      } else {
        customModel = model;
        console.log(`\n📥 [请求] ${requestId} - 模型：${model} - 流式：${!!stream}`);

        const found = currentConfig.models.find(p => p.customModel === model);
        if (found) {
          provider = found;
          actualModel = model;
        } else if (currentConfig.modelGroups) {
          try {
            const resolver = new ModelGroupResolver();
            const modelNames = resolver.resolveModelGroup(currentConfig.modelGroups, model);
            console.log(`   🔍 智能识别：${model} 被识别为 modelGroup -> [${modelNames.join(', ')}]`);
            modelGroup = model;
            const fallbackResult = await tryMessagesFallback({
              c, modelNames, allProviders: currentConfig.models, body, stream,
              rateLimiter, logger, detailLogger, requestId,
              startTime, currentUser, modelGroupName: model, timeoutMs, logDir
            });
            actualModel = fallbackResult.actualModel;
            triedModels = fallbackResult.triedModels;
            customModel = actualModel || 'unknown';
            return fallbackResult.response;
          } catch { /* not a valid modelGroup */ }
        }

        if (!provider) {
          console.log(`   ❌ 未找到模型配置`);
          logger.log({
            timestamp: new Date().toISOString(), requestId, customModel: model,
            endpoint, method: 'POST', statusCode: 404,
            durationMs: Date.now() - startTime, isStreaming: !!stream,
            userName: currentUser?.name, error: { message: 'Model not found' }
          });
          return c.json({ error: { message: 'Model not found' } }, 404);
        }
      }

      console.log(`   ✓ 匹配 provider: ${provider.customModel} -> ${provider.realModel} (${provider.provider})`);

      // 限频检查
      try {
        const limitResult = await rateLimiter.checkLimits(provider, logDir);
        if (limitResult.exceeded) {
          console.log(`   ⚠️  [限制触发] ${limitResult.message}`);
          return c.json(rateLimiter.createErrorResponse(limitResult.message!), 429);
        }
      } catch (error: any) {
        return c.json({ error: { message: error.message } }, 500);
      }

      // 发送上游请求
      const upstream = buildUpstreamRequest(provider, body, stream);
      const response = await sendUpstreamRequest(upstream, detailLogger, requestId, timeoutMs);

      // 构建日志
      const logEntry: any = {
        timestamp: new Date().toISOString(),
        requestId,
        customModel: model_group ? actualModel! : model,
        modelGroup: model_group,
        actualModel,
        triedModels: triedModels.length > 0 ? triedModels : undefined,
        realModel: provider.realModel,
        provider: provider.provider,
        endpoint,
        method: 'POST',
        statusCode: response.status,
        durationMs: Date.now() - startTime,
        isStreaming: !!stream,
        userName: currentUser?.name
      };

      // 非流式响应
      if (response.ok && !stream) {
        const result = await handleNonStream(response, provider, actualModel || model, logEntry, logger);
        if (result) {
          logger.log(result.logEntry);
          const pricing = provider.inputPricePer1M !== undefined && provider.outputPricePer1M !== undefined && provider.cachedPricePer1M !== undefined
            ? { inputPricePer1M: provider.inputPricePer1M, outputPricePer1M: provider.outputPricePer1M, cachedPricePer1M: provider.cachedPricePer1M }
            : undefined;
          rateLimiter.recordUsage(actualModel || model, result.logEntry, pricing);
          return c.json(result.responseData);
        }
      }

      logger.log(logEntry);

      if (!response.body) {
        console.log(`\n❌ [错误] 上游响应体为空 ${requestId}`);
        return c.json({ error: { message: 'No response body' } }, 500);
      }

      // 流式响应
      if (stream && response.ok) {
        return handleStream({
          response, provider, model: actualModel || model, requestId, startTime,
          logEntry, detailLogger, c
        });
      }

      console.log(`\n✅ [完成] ${requestId} - 耗时：${Date.now() - startTime}ms\n`);
      return c.body(response.body);

    } catch (error: any) {
      console.log(`   ❌ [错误] ${error?.message || 'Unknown error'}`);
      console.log(`   错误类型：${error?.name || 'Unknown'}`);
      console.log(`   耗时：${Date.now() - startTime}ms\n`);

      logger.log({
        timestamp: new Date().toISOString(),
        requestId,
        customModel: modelGroup ? actualModel! : (body.model as string),
        modelGroup,
        endpoint, method: 'POST', statusCode: 500,
        durationMs: Date.now() - startTime, isStreaming: false,
        userName: currentUser?.name,
        error: { message: error.message || 'Internal error', type: error.name }
      });

      if (error.name === 'TimeoutError') {
        return c.json({ error: { message: 'Upstream timeout', type: 'upstream_timeout', code: 'timeout' } }, 504);
      }

      if (error.name === 'ModelGroupExhaustedError') {
        return c.json({
          error: {
            message: error.message || 'All models in group exceeded their limits',
            type: 'rate_limit_error', code: 'rate_limit_exceeded', param: null
          }
        }, 429);
      }

      if (error.message && error.message.includes('Model group')) {
        return c.json({ error: { message: error.message, type: 'invalid_request_error' } }, 400);
      }

      return c.json({ error: { message: error.message || 'Internal error' } }, 500);
    }
  };
}
```

- [ ] **Step 2: 编译验证**

---

### Task 15：创建 `messages/index.ts` 并删除原文件

**Files:**
- Create: `src/routes/messages/index.ts`
- Delete: `src/routes/messages.ts`

- [ ] **Step 1: 创建 index.ts**

```typescript
import { Hono } from 'hono';
import type { ProxyConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import { createMessagesHandler } from './handler.js';

export function createMessagesRoute(
  config: ProxyConfig | (() => ProxyConfig),
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number,
  logDir: string
) {
  const router = new Hono();
  const handler = createMessagesHandler(config, logger, detailLogger, timeoutMs, logDir);

  router.post('/v1/messages', (c) => handler(c, '/v1/messages'));
  router.post('/messages', (c) => handler(c, '/messages'));
  router.post('/v1/v1/messages', (c) => handler(c, '/v1/v1/messages'));

  return router;
}
```

- [ ] **Step 2: 删除原文件**

Run: `rm src/routes/messages.ts`

- [ ] **Step 3: 编译 & 测试**

Run: `npx tsc --noEmit 2>&1`
Run: `pnpm test 2>&1 | tail -20`
Expected: 391 passed, 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/messages/ && git rm src/routes/messages.ts
git commit -m "refactor: split messages.ts into职责子目录"
```

---

## 阶段三：最终验证

### Task 16：全量测试 & 清理

- [ ] **Step 1: 全量编译**

Run: `npx tsc --noEmit 2>&1`
Expected: No errors

- [ ] **Step 2: 全量测试**

Run: `pnpm test 2>&1 | tail -30`
Expected: 391 passed (same baseline)

- [ ] **Step 3: 确认文件行数**

Run: `find src/routes/chat-completions src/routes/messages -name "*.ts" -exec wc -l {} + | sort -n`
Expected: 每个文件不超过 250 行

- [ ] **Step 4: 确认最终目录结构**

Run: `find src/routes/ -type f -name "*.ts" | sort`

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "refactor: complete routes split — chat-completions and messages under subdirs"
```

---

## 规范自查

### Spec Coverage Check
| 需求 | 对应 Task |
|------|-----------|
| chat-completions.ts 拆分 | Task 1–8 |
| messages.ts 拆分 | Task 9–15 |
| 对外 API 不变 (server.ts import 不变) | Task 7, Task 15 (index.ts 命名 + TypeScript 自动解析) |
| 消除重复代码 (stream/fallback) | Task 1, 2, 4, 5（统一 upstream/stream/fallback 为单例） |
| 每个文件不超过 200 行 | 所有新文件设计中均 <200 行 |
| 测试 100% 通过 | Task 8, Task 15, Task 16 |

### 无 Placeholders 检查
- ✅ 所有步骤包含完整代码
- ✅ 无 "TBD"/"TODO"/"implement later"
- ✅ 无 "Add appropriate error handling" 等模糊说明
- ✅ 函数签名在所有 task 中一致

### 类型一致性
- ✅ `UpstreamRequest` 在各文件中同名同结构
- ✅ `handleNonStream` / `handleStream` 接口一致
- ✅ `FallbackContext` / `MsgFallbackContext` 结构相同（12 个字段）
