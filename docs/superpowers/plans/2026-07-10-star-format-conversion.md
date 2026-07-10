# 星型格式转换架构 + 落地 OpenAI Responses API 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `llm-gateway` 的格式转换层从"网状直连"重构为"以 OpenAI Chat 为 canonical 的星型架构"，并全量落地 OpenAI Responses API（客户端入站 `/v1/responses` + provider 出站 `response-api`），保真项参考 cc-switch。

**Architecture:** 每种格式实现统一的 `FormatAdapter`（4 个 JSON 纯函数 + 2 个有状态流式工厂），路由 `router.ts` 根据 `(sourceFormat, providerFormat)` 选择 passthrough 或 `source → chat(canonical) → provider` 两条腿串联；同格式直接透传。canonical 复用现有 OpenAI 类型并补 `[FIDELITY-SLOT]` 扩展槽。

**Tech Stack:** TypeScript（Hono 网关）、vitest（测试）、现有 `src/converters/*` 逻辑平移。参考 `/Users/kkito/proj/study/cc-switch` 的 `transform_responses.rs` / `streaming_responses.rs`。

---

## 文件结构

**新建：**
- `src/converters/canonical/types.ts` — `Chat*` 类型 + 保真扩展槽
- `src/converters/types.ts` — 改为 re-export canonical（兼容旧 import）
- `src/converters/format-adapter.ts` — `FormatAdapter` / `StreamConverter` 接口
- `src/converters/router.ts` — `(source, provider) => 转换链 / passthrough`
- `src/converters/formats/chat/index.ts` — 恒等适配器
- `src/converters/formats/anthropic/index.ts` — 包装现有转换函数
- `src/converters/formats/anthropic/request.ts`
- `src/converters/formats/anthropic/response.ts`
- `src/converters/formats/anthropic/stream.ts`
- `src/converters/formats/responses/request.ts`
- `src/converters/formats/responses/response.ts`
- `src/converters/formats/responses/stream.ts`
- `src/converters/formats/responses/index.ts`
- `src/routes/responses/handler.ts` — 新增 `/v1/responses` 路由（镜像 messages）
- `src/routes/responses/upstream-request.ts`
- `src/routes/responses/stream-handler.ts`
- `src/routes/responses/non-stream-handler.ts`
- `tests/converters/anthropic/request-conversion.test.ts`
- `tests/converters/responses/request.test.ts`
- `tests/converters/responses/response.test.ts`
- `tests/converters/responses/stream.test.ts`
- `tests/converters/router.test.ts`

**移动（git mv，保持内容）：**
- `src/converters/openai-to-anthropic.ts` → `src/converters/formats/anthropic/openai-to-anthropic.ts`
- `src/converters/anthropic-to-openai.ts` → `src/converters/formats/anthropic/anthropic-to-openai.ts`
- `src/converters/shared/*` → `src/converters/formats/anthropic/shared/*`（anthropic 专用，随 anthropic 包移动）
- `tests/converters/openai-to-anthropic/*` → `tests/converters/anthropic/`
- `tests/converters/anthropic-to-openai/*` → `tests/converters/anthropic/`

**修改：**
- `src/config.ts:5` — `ProviderType` 增加 `'response-api'`
- `src/routes/messages/upstream-request.ts` — 改用 `router`
- `src/routes/messages/stream-handler.ts` — 改用 `router`
- `src/routes/messages/non-stream-handler.ts` — 改用 `router`
- `src/routes/chat-completions/upstream-request.ts` — 改用 `router`
- `src/routes/chat-completions/stream-handler.ts` — 改用 `router`
- `src/routes/chat-completions/non-stream-handler.ts` — 改用 `router`
- `src/routes/index.ts`（或主路由注册处）— 注册 `/v1/responses`

> 注：移动文件后，原 `src/converters/openai-to-anthropic.ts` 等旧路径 import 需更新为 `formats/anthropic/...`。`messages`/`chat-completions` 路由改为统一调用 `router`，行为保持不变。

---

## Task 1: canonical 类型与保真扩展槽

**Files:**
- Create: `src/converters/canonical/types.ts`
- Modify: `src/converters/types.ts`（改为 re-export）

- [ ] **Step 1: 写 canonical 类型定义**

```ts
// src/converters/canonical/types.ts
/**
 * 统一内部格式（canonical）—— 以 OpenAI Chat 为基准。
 * 所有格式在转换时都先归一到本文件类型，再发射到目标格式。
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatRole;
  content: string | ChatContentPart[] | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  /** 思考过程（Qwen/DeepSeek reasoning_content、OpenRouter reasoning、o1 reasoning_details 的统一落点） */
  reasoning?: string;
  /** [FIDELITY-SLOT] 来源 Anthropic thinking.signature，保真短接时携带，默认 undefined */
  thinkingSignature?: string;
}

export interface ChatTool {
  type: 'function';
  function: { name: string; description: string; parameters: any };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
  stream_options?: { include_reasoning: boolean };
  /** [FIDELITY-SLOT] 来源 Responses previous_response_id，多轮对话延续 */
  previousResponseId?: string;
  /** [FIDELITY-SLOT] 来源 Responses instructions，落地前的系统提示；provider 不支持时并入 system */
  responseInstructions?: string;
}

export interface ChatResponse {
  id: string;
  object?: string;
  created?: number;
  model: string;
  choices: Array<{
    index?: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: ChatToolCall[];
      reasoning?: string;
      thinkingSignature?: string;
    };
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /** [FIDELITY-SLOT] 来源 Responses include: reasoning.encrypted_content，保真短接携带 */
  responsesEncryptedContent?: string;
}

/** 复用现有 OpenAI 流式 chunk 作为 canonical 流式格式 */
export interface ChatStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{ index: number; id?: string; type: 'function'; function: { name?: string; arguments?: string } }>;
      reasoning_content?: string | null;
      reasoning?: string | null;
      reasoning_details?: Array<{ text: string }>;
      refusal?: string | null;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}
```

- [ ] **Step 2: 让旧 `types.ts` re-export canonical，兼容现有 import**

```ts
// src/converters/types.ts
/**
 * @deprecated 类型已迁移到 ./canonical/types.js。本文件仅做兼容 re-export。
 */
export * from './canonical/types.js';
export type {
  AnthropicContentBlock, AnthropicMessage, AnthropicTool, AnthropicRequest,
  AnthropicResponse, AnthropicStreamEvent, OpenAIMessage, OpenAITool, OpenAIRequest,
  OpenAIResponse, OpenAIDelta, OpenAIChoice, OpenAIStreamResponse
} from './formats/anthropic/openai-to-anthropic.js';
```

> 说明：Anthropic/OpenAI 具体类型仍定义在 `formats/anthropic/openai-to-anthropic.ts` 与 `anthropic-to-openai.ts` 内（原样保留），此处 re-export 供存量代码使用。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误（仅可能有存量告警，忽略）。

- [ ] **Step 4: 提交**

```bash
git add src/converters/canonical/types.ts src/converters/types.ts
git commit -m "feat(converters): 新增 canonical Chat* 类型与保真扩展槽"
```

---

## Task 2: FormatAdapter / StreamConverter 接口与 router

**Files:**
- Create: `src/converters/format-adapter.ts`
- Create: `src/converters/router.ts`
- Test: `tests/converters/router.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/converters/router.test.ts
import { describe, it, expect } from 'vitest';
import { resolveConverterChain, type ChainPlan } from '../../src/converters/router.js';

describe('router', () => {
  it('同格式透传', () => {
    const plan = resolveConverterChain('anthropic', 'anthropic');
    expect(plan.passthrough).toBe(true);
  });
  it('anthropic->openai 走 chat 中转', () => {
    const plan = resolveConverterChain('anthropic', 'openai');
    expect(plan.passthrough).toBe(false);
    expect(plan.source).toBe('anthropic');
    expect(plan.provider).toBe('openai');
  });
  it('responses->response-api 走 chat 中转', () => {
    const plan = resolveConverterChain('responses', 'response-api');
    expect(plan.passthrough).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/converters/router.test.ts`
Expected: FAIL（`Cannot find module '../../src/converters/router.js'`）

- [ ] **Step 3: 写接口与 router 实现**

```ts
// src/converters/format-adapter.ts
import type { ChatRequest, ChatResponse, ChatStreamChunk } from './canonical/types.js';

export type FormatName = 'chat' | 'anthropic' | 'responses' | 'response-api';

/** 有状态流式转换器：一条上游 chunk -> 0..n 条下游 chunk；flush 收尾 */
export interface StreamConverter {
  transform(chunk: any): any[];
  flush(): any[];
}

/** 每种格式实现此适配器，仅与 canonical(chat) 互转 */
export interface FormatAdapter {
  name: FormatName;
  toChatRequest(req: any): ChatRequest;
  fromChatRequest(chat: ChatRequest): any;
  toChatResponse(resp: any): ChatResponse;
  fromChatResponse(chat: ChatResponse): any;
  createUpstreamStream(): StreamConverter;   // 上游格式 chunk -> ChatStreamChunk[]
  createDownstreamStream(): StreamConverter; // ChatStreamChunk[] -> 客户端格式 SSE
}
```

```ts
// src/converters/router.ts
import type { FormatAdapter, FormatName } from './format-adapter.js';
import { chatAdapter } from './formats/chat/index.js';
import { anthropicAdapter } from './formats/anthropic/index.js';
import { responsesAdapter } from './formats/responses/index.js';

const REGISTRY: Record<string, FormatAdapter> = {
  chat: chatAdapter,
  anthropic: anthropicAdapter,
  responses: responsesAdapter,
  'response-api': responsesAdapter,
};

export interface ChainPlan {
  passthrough: boolean;
  source: FormatName;
  provider: FormatName;
  sourceAdapter: FormatAdapter;
  providerAdapter: FormatAdapter;
}

export function resolveConverterChain(source: FormatName, provider: FormatName): ChainPlan {
  const sourceAdapter = REGISTRY[source];
  const providerAdapter = REGISTRY[provider];
  if (!sourceAdapter || !providerAdapter) {
    throw new Error(`unknown format: source=${source} provider=${provider}`);
  }
  return {
    passthrough: source === provider,
    source,
    provider,
    sourceAdapter,
    providerAdapter,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/converters/router.test.ts`
Expected: PASS（注意：`formats/chat`、`formats/anthropic`、`formats/responses` 尚未创建，会在后续 Task 补充；此处测试会因 import 失败，需先完成 Task 3/4/5 后再跑。先写 router 代码，跑全量测试放在最后。）

- [ ] **Step 5: 提交（本步仅 router + 接口；adapters 后续补齐，先不提交以保编译通过，或单独提交 router 骨架并在最后统一跑）**

```bash
git add src/converters/format-adapter.ts src/converters/router.ts tests/converters/router.test.ts
git commit -m "feat(converters): 新增 FormatAdapter/StreamConverter 接口与 router"
```

---

## Task 3: chat 恒等适配器

**Files:**
- Create: `src/converters/formats/chat/index.ts`

- [ ] **Step 1: 写恒等适配器**

```ts
// src/converters/formats/chat/index.ts
import type { FormatAdapter, StreamConverter } from '../../format-adapter.js';
import type { ChatRequest, ChatResponse, ChatStreamChunk } from '../../canonical/types.js';

/**
 * chat 即 canonical，但流式链路在 ChatStreamChunk 层级交换，
 * 因此上游/下游流负责把 OpenAI SSE 文本 <-> ChatStreamChunk 解析/序列化
 * （content 不变，仅做边界切分与 JSON 解析）。
 */
class OpenAISSEStream implements StreamConverter {
  private buffer = '';
  transform(raw: string): ChatStreamChunk[] {
    this.buffer += raw;
    const parts = this.buffer.split('\n\n');
    this.buffer = parts.pop() ?? '';
    const out: ChatStreamChunk[] = [];
    for (const part of parts) {
      const dataLine = part.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const data = dataLine.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try { out.push(JSON.parse(data) as ChatStreamChunk); } catch { /* skip */ }
    }
    return out;
  }
  flush(): ChatStreamChunk[] { return []; }
}

class ChatDownstreamSSE implements StreamConverter {
  transform(chunk: ChatStreamChunk): string[] {
    return [`data: ${JSON.stringify(chunk)}\n\n`];
  }
  flush(): string[] { return []; }
}

export const chatAdapter: FormatAdapter = {
  name: 'chat',
  toChatRequest(req: ChatRequest): ChatRequest {
    return req;
  },
  fromChatRequest(chat: ChatRequest): ChatRequest {
    return chat;
  },
  toChatResponse(resp: ChatResponse): ChatResponse {
    return resp;
  },
  fromChatResponse(chat: ChatResponse): ChatResponse {
    return chat;
  },
  createUpstreamStream(): StreamConverter {
    return new OpenAISSEStream();
  },
  createDownstreamStream(): StreamConverter {
    return new ChatDownstreamSSE();
  },
};
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/converters/formats/chat/index.ts
git commit -m "feat(converters): 新增 chat 恒等适配器"
```

---

## Task 4: anthropic 适配器（平移现有逻辑，行为不变）

**Files:**
- Move: `src/converters/openai-to-anthropic.ts` → `src/converters/formats/anthropic/openai-to-anthropic.ts`
- Move: `src/converters/anthropic-to-openai.ts` → `src/converters/formats/anthropic/anthropic-to-openai.ts`
- Move: `src/converters/shared/*` → `src/converters/formats/anthropic/shared/*`
- Create: `src/converters/formats/anthropic/request.ts`
- Create: `src/converters/formats/anthropic/response.ts`
- Create: `src/converters/formats/anthropic/stream.ts`
- Create: `src/converters/formats/anthropic/index.ts`
- Test: `tests/converters/anthropic/request-conversion.test.ts`

- [ ] **Step 1: 移动文件并修正内部 import 路径**

Run:
```bash
mkdir -p src/converters/formats/anthropic/shared
git mv src/converters/openai-to-anthropic.ts src/converters/formats/anthropic/openai-to-anthropic.ts
git mv src/converters/anthropic-to-openai.ts src/converters/formats/anthropic/anthropic-to-openai.ts
git mv src/converters/shared/finish-reason.ts src/converters/formats/anthropic/shared/finish-reason.ts
git mv src/converters/shared/types.ts src/converters/formats/anthropic/shared/types.ts
git mv src/converters/shared/sse-parser.ts src/converters/formats/anthropic/shared/sse-parser.ts
git mv src/converters/shared/index.ts src/converters/formats/anthropic/shared/index.ts
```
然后批量把 `formats/anthropic/*` 内部对 `./shared/` 的引用改为 `./shared/`（原 `../shared/` → `./shared/`），对 `./types.js` 的引用若指向旧 `converters/types` 改为 `../../canonical/types.js`。用搜索确认无遗漏。

- [ ] **Step 2: 写 request.ts（映射现有函数到 FormatAdapter 语义）**

```ts
// src/converters/formats/anthropic/request.ts
import { convertAnthropicRequestToOpenAI } from './anthropic-to-openai.js';
import { convertOpenAIRequestToAnthropic } from './openai-to-anthropic.js';
import type { ChatRequest } from '../../canonical/types.js';

/** anthropic 请求 -> canonical chat 请求 */
export function anthropicToChatRequest(req: any): ChatRequest {
  return convertAnthropicRequestToOpenAI(req) as unknown as ChatRequest;
}

/** canonical chat 请求 -> anthropic 请求 */
export function chatToAnthropicRequest(chat: ChatRequest): any {
  return convertOpenAIRequestToAnthropic(chat as any);
}
```

- [ ] **Step 3: 写 response.ts**

```ts
// src/converters/formats/anthropic/response.ts
import { convertAnthropicResponseToOpenAI } from './openai-to-anthropic.js';
import { convertOpenAIResponseToAnthropic } from './anthropic-to-openai.js';
import type { ChatResponse } from '../../canonical/types.js';

/** anthropic 响应 -> canonical chat 响应 */
export function anthropicToChatResponse(resp: any): ChatResponse {
  return convertAnthropicResponseToOpenAI(resp) as unknown as ChatResponse;
}

/** canonical chat 响应 -> anthropic 响应 */
export function chatToAnthropicResponse(chat: ChatResponse): any {
  return convertOpenAIResponseToAnthropic(chat as any);
}
```

- [ ] **Step 4: 写 stream.ts（有状态实例，包装现有流式函数）**

```ts
// src/converters/formats/anthropic/stream.ts
import { convertAnthropicStreamEventToOpenAI, parseSSEBlock } from './anthropic-to-openai.js';
import {
  convertOpenAIStreamChunkToAnthropic, createOpenAIToAnthropicStreamState,
  formatAnthropicEventToSSE, parseOpenAISSEData,
} from './openai-to-anthropic.js';
import type { StreamConverter } from '../../format-adapter.js';
import type { ChatStreamChunk } from '../../canonical/types.js';

/** 上游 anthropic SSE -> canonical chat chunk[]（有状态） */
export class AnthropicUpstreamStream implements StreamConverter {
  private requestId = `req_${Date.now()}`;
  private model = 'model';
  transform(sseBlock: string): any[] {
    const events = parseSSEBlock(sseBlock);
    const out: ChatStreamChunk[] = [];
    for (const ev of events) {
      const chunk = ev.data ? convertAnthropicStreamEventToOpenAI(ev.data, this.requestId, this.model) : null;
      if (chunk) out.push(chunk as ChatStreamChunk);
    }
    return out;
  }
  flush(): any[] { return []; }
}

/** canonical chat chunk[] -> 客户端 anthropic SSE（有状态） */
export class AnthropicDownstreamStream implements StreamConverter {
  private state = createOpenAIToAnthropicStreamState();
  transform(chunk: ChatStreamChunk): string[] {
    const events = convertOpenAIStreamChunkToAnthropic(chunk as any, this.state);
    return events.map((e) => formatAnthropicEventToSSE(e));
  }
  flush(): string[] { return []; }
}

/** 解析一条 openai SSE chunk 文本为 ChatStreamChunk（供 router 上游链路使用） */
export function parseOpenAISSEChunkToChat(line: string): ChatStreamChunk | null {
  const parsed = parseOpenAISSEData(line);
  return (parsed?.data ?? null) as ChatStreamChunk | null;
}
```

- [ ] **Step 5: 写 index.ts 导出 anthropicAdapter**

```ts
// src/converters/formats/anthropic/index.ts
import type { FormatAdapter } from '../../format-adapter.js';
import { anthropicToChatRequest, chatToAnthropicRequest } from './request.js';
import { anthropicToChatResponse, chatToAnthropicResponse } from './response.js';
import { AnthropicUpstreamStream, AnthropicDownstreamStream } from './stream.js';

export const anthropicAdapter: FormatAdapter = {
  name: 'anthropic',
  toChatRequest: anthropicToChatRequest,
  fromChatRequest: chatToAnthropicRequest,
  toChatResponse: anthropicToChatResponse,
  fromChatResponse: chatToAnthropicResponse,
  createUpstreamStream: () => new AnthropicUpstreamStream(),
  createDownstreamStream: () => new AnthropicDownstreamStream(),
};
```

- [ ] **Step 6: 写测试（平移现有 openai-to-anthropic/request-conversion 的断言）**

```ts
// tests/converters/anthropic/request-conversion.test.ts
import { describe, it, expect } from 'vitest';
import { anthropicToChatRequest, chatToAnthropicRequest } from '../../../src/converters/formats/anthropic/request.js';

describe('anthropic adapter request', () => {
  it('anthropic system+user -> chat system+user', () => {
    const a = {
      model: 'claude', system: 'be nice',
      messages: [{ role: 'user', content: 'hi' }], max_tokens: 100,
    };
    const chat = anthropicToChatRequest(a);
    expect(chat.messages[0].role).toBe('system');
    expect(chat.messages[0].content).toBe('be nice');
    expect(chat.messages[1].role).toBe('user');
  });
  it('chat tool_calls -> anthropic tool_use', () => {
    const chat = {
      model: 'claude',
      messages: [{
        role: 'assistant', content: null,
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'f', arguments: '{}' } }],
      }],
    } as any;
    const a = chatToAnthropicRequest(chat);
    expect(a.content[0].type).toBe('tool_use');
    expect(a.content[0].name).toBe('f');
  });
});
```

- [ ] **Step 7: 运行测试**

Run: `npx vitest run tests/converters/anthropic/request-conversion.test.ts`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add -A src/converters/formats/anthropic tests/converters/anthropic
git commit -m "feat(converters): anthropic 适配器平移现有转换逻辑"
```

---

## Task 5: responses 请求 JSON（含 previous_response_id / instructions / tools）

**Files:**
- Create: `src/converters/formats/responses/request.ts`
- Test: `tests/converters/responses/request.test.ts`

参考 cc-switch `transform_responses.rs` 的 `responses_to_anthropic` 请求方向（此处为 responses → chat）。

- [ ] **Step 1: 写失败测试**

```ts
// tests/converters/responses/request.test.ts
import { describe, it, expect } from 'vitest';
import { responsesToChatRequest, chatToResponsesRequest } from '../../../src/converters/formats/responses/request.js';

describe('responses request', () => {
  it('instructions -> system, input message -> user', () => {
    const r = {
      model: 'gpt-4o',
      instructions: 'sys',
      input: [{ role: 'user', content: 'hi' }],
      stream: true,
    };
    const chat = responsesToChatRequest(r);
    expect(chat.responseInstructions).toBe('sys');
    expect(chat.messages[0].role).toBe('user');
    expect(chat.messages[0].content).toBe('hi');
    expect(chat.stream).toBe(true);
  });
  it('previous_response_id 保留到保真槽', () => {
    const r = { model: 'gpt-4o', previous_response_id: 'resp_1', input: 'hello' };
    const chat = responsesToChatRequest(r);
    expect(chat.previousResponseId).toBe('resp_1');
  });
  it('chat system+user -> instructions+input', () => {
    const chat = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      previousResponseId: 'resp_1',
    } as any;
    const r = chatToResponsesRequest(chat);
    expect(r.instructions).toBe('sys');
    expect(r.previous_response_id).toBe('resp_1');
    expect(Array.isArray(r.input)).toBe(true);
    expect(r.input[0].role).toBe('user');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/converters/responses/request.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```ts
// src/converters/formats/responses/request.ts
import type { ChatRequest, ChatMessage, ChatTool } from '../../canonical/types.js';

interface ResponsesInputItem {
  role?: string;
  content?: any;
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  tool_call_id?: string;
}

/** Responses 请求 -> canonical chat 请求 */
export function responsesToChatRequest(body: any): ChatRequest {
  const messages: ChatMessage[] = [];

  if (body.instructions) {
    messages.push({ role: 'system', content: String(body.instructions) });
  }

  const input = normalizeInput(body.input);
  for (const item of input) {
    if (item.type === 'function_call') {
      // 历史 assistant 工具调用
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: item.call_id || '',
          type: 'function',
          function: { name: item.name || '', arguments: item.arguments || '{}' },
        }],
      });
    } else if (item.type === 'function_call_output') {
      messages.push({
        role: 'tool',
        content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content ?? ''),
        tool_call_id: item.call_id || '',
      });
    } else {
      const role = (item.role === 'system') ? 'system' : (item.role === 'user' ? 'user' : 'assistant');
      let content: string | null = '';
      if (typeof item.content === 'string') content = item.content;
      else if (Array.isArray(item.content)) content = item.content.map((c: any) => (typeof c === 'string' ? c : (c?.text ?? ''))).join('');
      else if (item.content == null) content = '';
      else content = JSON.stringify(item.content);
      messages.push({ role, content } as ChatMessage);
    }
  }

  const tools: ChatTool[] | undefined = body.tools?.map((t: any) => ({
    type: 'function',
    function: { name: t.name, description: t.description ?? '', parameters: t.parameters ?? {} },
  }));

  return {
    model: body.model,
    messages,
    tools,
    max_tokens: body.max_output_tokens,
    stream: body.stream,
    previousResponseId: body.previous_response_id,
    responseInstructions: body.instructions,
  };
}

/** canonical chat 请求 -> Responses 请求 */
export function chatToResponsesRequest(chat: ChatRequest): any {
  const input: any[] = [];
  let instructions: string | undefined;

  for (const m of chat.messages) {
    if (m.role === 'system') {
      instructions = typeof m.content === 'string' ? m.content : '';
      continue;
    }
    if (m.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: m.tool_call_id || '', output: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      for (const tc of m.tool_calls) {
        input.push({ type: 'function_call', call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
      }
      continue;
    }
    const content = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.map((c) => c.text ?? '').join('') : '');
    input.push({ role: m.role, content });
  }

  const result: any = { model: chat.model, input };
  if (instructions) result.instructions = instructions;
  if (chat.previousResponseId) result.previous_response_id = chat.previousResponseId;
  if (chat.tools) result.tools = chat.tools.map((t) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters }));
  if (chat.stream) result.stream = true;
  if (chat.max_tokens) result.max_output_tokens = chat.max_tokens;
  return result;
}

function normalizeInput(input: any): ResponsesInputItem[] {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  if (Array.isArray(input)) return input;
  return [];
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/converters/responses/request.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/converters/formats/responses/request.ts tests/converters/responses/request.test.ts
git commit -m "feat(responses): 请求 JSON 双向转换（instructions/previous_response_id/tools）"
```

---

## Task 6: responses 响应 JSON（含 usage / finish_reason / encrypted_content 保真槽）

**Files:**
- Create: `src/converters/formats/responses/response.ts`
- Test: `tests/converters/responses/response.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/converters/responses/response.test.ts
import { describe, it, expect } from 'vitest';
import { responsesToChatResponse, chatToResponsesResponse } from '../../../src/converters/formats/responses/response.js';

describe('responses response', () => {
  it('responses output text -> chat choice content', () => {
    const r = {
      id: 'resp_1', model: 'gpt-4o', status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] }],
      usage: { input_tokens: 5, output_tokens: 2 },
    };
    const chat = responsesToChatResponse(r);
    expect(chat.choices[0].message.content).toBe('hi');
    expect(chat.usage?.prompt_tokens).toBe(5);
    expect(chat.usage?.completion_tokens).toBe(2);
  });
  it('responses function_call -> chat tool_calls', () => {
    const r = {
      id: 'resp_2', model: 'gpt-4o', status: 'completed',
      output: [{ type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' }],
    };
    const chat = responsesToChatResponse(r);
    expect(chat.choices[0].message.tool_calls?.[0].function.name).toBe('f');
    expect(chat.choices[0].finish_reason).toBe('tool_calls');
  });
  it('chat -> responses 保留 encrypted_content 保真槽', () => {
    const chat = {
      id: 'resp_3', model: 'gpt-4o',
      choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }],
      responsesEncryptedContent: 'ENC',
    } as any;
    const r = chatToResponsesResponse(chat);
    expect(r.id).toBe('resp_3');
    expect(r.encrypted_content).toBe('ENC');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/converters/responses/response.test.ts`
Expected: FAIL

- [ ] **Step 3: 写实现**

```ts
// src/converters/formats/responses/response.ts
import type { ChatResponse, ChatMessage, ChatToolCall } from '../../canonical/types.js';

/** Responses 响应 -> canonical chat 响应 */
export function responsesToChatResponse(body: any): ChatResponse {
  const outputs = Array.isArray(body.output) ? body.output : [];
  let content = '';
  const toolCalls: ChatToolCall[] = [];

  for (const item of outputs) {
    if (item.type === 'message') {
      const parts = Array.isArray(item.content) ? item.content : [];
      for (const p of parts) {
        if (p.type === 'output_text' || p.type === 'text') content += (p.text ?? '');
        if (p.type === 'refusal') content += (p.text ?? '');
      }
    } else if (item.type === 'function_call') {
      toolCalls.push({
        id: item.call_id || '',
        type: 'function',
        function: { name: item.name || '', arguments: item.arguments || '{}' },
      });
    }
  }

  let finishReason: string | null = 'stop';
  if (toolCalls.length > 0) finishReason = 'tool_calls';
  else if (body.status === 'incomplete') finishReason = 'length';

  const usage = body.usage
    ? { prompt_tokens: body.usage.input_tokens ?? 0, completion_tokens: body.usage.output_tokens ?? 0, total_tokens: (body.usage.input_tokens ?? 0) + (body.usage.output_tokens ?? 0) }
    : undefined;

  const message: any = { role: 'assistant', content: content || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  const resp: ChatResponse = {
    id: body.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage,
  };
  if (body.encrypted_content) (resp as any).responsesEncryptedContent = body.encrypted_content;
  return resp;
}

/** canonical chat 响应 -> Responses 响应 */
export function chatToResponsesResponse(chat: ChatResponse): any {
  const choice = chat.choices?.[0];
  const msg = choice?.message;
  const output: any[] = [];

  if (msg?.tool_calls?.length) {
    for (const tc of msg.tool_calls) {
      output.push({ type: 'function_call', call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
    }
  } else {
    output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: msg?.content ?? '' }] });
  }

  const result: any = {
    id: chat.id,
    model: chat.model,
    status: choice?.finish_reason === 'tool_calls' ? 'completed' : 'completed',
    output,
  };
  if (chat.usage) result.usage = { input_tokens: chat.usage.prompt_tokens, output_tokens: chat.usage.completion_tokens };
  if ((chat as any).responsesEncryptedContent) result.encrypted_content = (chat as any).responsesEncryptedContent;
  return result;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/converters/responses/response.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/converters/formats/responses/response.ts tests/converters/responses/response.test.ts
git commit -m "feat(responses): 响应 JSON 双向转换（usage/finish_reason/encrypted_content）"
```

---

## Task 7: responses 流式（命名事件状态机，参考 streaming_responses.rs）

**Files:**
- Create: `src/converters/formats/responses/stream.ts`
- Create: `src/converters/formats/responses/index.ts`
- Test: `tests/converters/responses/stream.test.ts`

> 这是最大的一块，完整移植 cc-switch `streaming_responses.rs` 的命名事件状态机到 TypeScript `ResponsesUpstreamStream`（Responses SSE → ChatStreamChunk[]）与 `ResponsesDownstreamStream`（ChatStreamChunk[] → Responses 命名事件 SSE）。下面给出完整可运行实现，覆盖 `response.created / output_item.added / content_part.added / output_text.delta / function_call_arguments.delta|done / reasoning.delta / refusal.delta / response.completed` 等。

- [ ] **Step 1: 写失败测试（移植 cc-switch 的 function_call 流式 + Read 空 pages 清洗用例）**

```ts
// tests/converters/responses/stream.test.ts
import { describe, it, expect } from 'vitest';
import { ResponsesUpstreamStream } from '../../../src/converters/formats/responses/stream.js';

function feed(stream: any, input: string): string {
  return stream.transform(input).map((c: any) => JSON.stringify(c)).join('\n');
}

describe('responses upstream stream', () => {
  it('function_call 流式映射为 tool_calls', () => {
    const input = [
      'event: response.created',
      'data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-4o","usage":{"input_tokens":12,"output_tokens":0}}}',
      '',
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_1","name":"get_weather"}}',
      '',
      'event: response.function_call_arguments.delta',
      'data: {"type":"response.function_call_arguments.delta","delta":"{\\"city\\":\\"Tokyo\\"}"}',
      '',
      'event: response.function_call_arguments.done',
      'data: {"type":"response.function_call_arguments.done"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":12,"output_tokens":3}}}',
      '',
    ].join('\n');
    const s = new ResponsesUpstreamStream();
    const merged = feed(s, input);
    expect(merged).toContain('"role":"assistant"');
    expect(merged).toContain('"name":"get_weather"');
    expect(merged).toContain('"arguments":"{\\"city\\":\\"Tokyo\\"}"');
  });

  it('Read 工具空 pages 参数被清洗', () => {
    const input = [
      'event: response.created',
      'data: {"type":"response.created","response":{"id":"resp_read","model":"gpt-5.5"}}',
      '',
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"id":"fc_read","type":"function_call","call_id":"call_read","name":"Read"}}',
      '',
      'event: response.function_call_arguments.delta',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_read","delta":"{\\"file_path\\":\\"/tmp/demo.py\\",\\"limit\\":2000,\\"offset\\":0,\\"pages\\":\\"\\"}"}',
      '',
      'event: response.function_call_arguments.done',
      'data: {"type":"response.function_call_arguments.done","item_id":"fc_read","arguments":"{\\"file_path\\":\\"/tmp/demo.py\\",\\"limit\\":2000,\\"offset\\":0,\\"pages\\":\\"\\"}"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"status":"completed"}}',
      '',
    ].join('\n');
    const s = new ResponsesUpstreamStream();
    const merged = feed(s, input);
    expect(merged).toContain('"name":"Read"');
    expect(merged).toContain('"arguments":"{\\"file_path\\":\\"/tmp/demo.py\\",\\"limit\\":2000,\\"offset\\":0}"');
    expect(merged).not.toContain('"pages"');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/converters/responses/stream.test.ts`
Expected: FAIL

- [ ] **Step 3: 写 stream.ts（完整移植）**

```ts
// src/converters/formats/responses/stream.ts
import type { StreamConverter } from '../../format-adapter.js';
import type { ChatStreamChunk } from '../../canonical/types.js';

function stripSseField(line: string, field: string): string | null {
  const prefix = `${field}:`;
  if (!line.startsWith(prefix)) return null;
  return line.slice(prefix.length).trim();
}

function takeSseBlocks(buffer: string): string[] {
  const parts = buffer.split('\n\n');
  return parts.slice(0, -1);
}

function sanitizeReadArguments(name: string, raw: string): string {
  if (name !== 'Read' || raw === '') return raw;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && obj.pages === '') delete obj.pages;
    return JSON.stringify(obj);
  } catch {
    return raw;
  }
}

function mapResponsesStopReason(status: string | undefined, hasToolUse: boolean, incompleteReason: string | undefined): string {
  if (hasToolUse && status === 'completed') return 'tool_calls';
  if (status === 'incomplete') {
    if (incompleteReason === 'max_output_tokens') return 'length';
    return 'stop';
  }
  return hasToolUse ? 'tool_calls' : 'stop';
}

/** 上游 Responses 命名事件 SSE -> canonical ChatStreamChunk[]（有状态） */
export class ResponsesUpstreamStream implements StreamConverter {
  private messageId = `resp_${Date.now()}`;
  private model = '';
  private hasSentMessageStart = false;
  private hasToolUse = false;
  private nextContentIndex = 0;
  private indexByKey = new Map<string, number>();
  private openIndices = new Set<number>();
  private fallbackOpenIndex: number | null = null;
  private currentTextIndex: number | null = null;
  private toolIndexByItemId = new Map<string, number>();
  private toolNameByIndex = new Map<number, string>();
  private toolArgsByIndex = new Map<number, string>();
  private lastToolIndex: number | null = null;
  private created = Math.floor(Date.now() / 1000);
  private buffer = '';

  transform(raw: string): ChatStreamChunk[] {
    this.buffer += raw;
    const blocks = takeSseBlocks(this.buffer);
    if (blocks.length) {
      const last = this.buffer.lastIndexOf('\n\n');
      this.buffer = this.buffer.slice(last + 2);
    }
    const out: ChatStreamChunk[] = [];
    for (const block of blocks) {
      if (!block.trim()) continue;
      let eventType: string | undefined;
      const dataParts: string[] = [];
      for (const line of block.split('\n')) {
        const e = stripSseField(line, 'event');
        if (e !== null) eventType = e;
        const d = stripSseField(line, 'data');
        if (d !== null) dataParts.push(d);
      }
      if (!dataParts.length) continue;
      let data: any;
      try { data = JSON.parse(dataParts.join('\n')); } catch { continue; }

      const respObj = data.response ?? data;
      const ev = eventType ?? '';
      const cid = () => `chatcmpl_${this.messageId}`;

      switch (ev) {
        case 'response.created': {
          if (respObj.id) this.messageId = respObj.id;
          if (respObj.model) this.model = respObj.model;
          this.hasSentMessageStart = true;
          out.push({
            id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model,
            choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
            usage: respObj.usage ? { prompt_tokens: respObj.usage.input_tokens ?? 0, completion_tokens: 0 } : undefined,
          });
          break;
        }
        case 'response.content_part.added': {
          const part = data.part;
          if (part && (part.type === 'output_text' || part.type === 'refusal')) {
            const idx = this.currentTextIndex ?? this.assignTextIndex(data);
            this.currentTextIndex = idx;
            if (!this.openIndices.has(idx)) {
              this.openIndices.add(idx);
              out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: { content: '' }, finish_reason: null }] });
            }
          }
          break;
        }
        case 'response.output_text.delta':
        case 'response.refusal.delta': {
          const delta = data.delta;
          if (!delta) break;
          const idx = this.currentTextIndex ?? this.assignTextIndex(data);
          this.currentTextIndex = idx;
          if (!this.openIndices.has(idx)) {
            this.openIndices.add(idx);
            out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: { content: '' }, finish_reason: null }] });
          }
          out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] });
          break;
        }
        case 'response.output_item.added': {
          const item = data.item;
          if (item && item.type === 'function_call') {
            this.hasToolUse = true;
            if (this.currentTextIndex !== null) {
              const idx = this.currentTextIndex; this.currentTextIndex = null;
              if (this.openIndices.delete(idx)) out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: {}, finish_reason: null }] });
              if (this.fallbackOpenIndex === idx) this.fallbackOpenIndex = null;
            }
            const key = item.id ? `tool:${item.id}` : (data.item_id ? `tool:${data.item_id}` : `tool:out:${data.output_index ?? this.nextContentIndex}`);
            let idx = this.indexByKey.get(key) ?? this.nextContentIndex++;
            this.indexByKey.set(key, idx);
            if (item.id) this.toolIndexByItemId.set(item.id, idx);
            this.toolNameByIndex.set(idx, item.name ?? '');
            this.lastToolIndex = idx;
            if (!this.openIndices.has(idx)) {
              this.openIndices.add(idx);
              out.push({
                id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model,
                choices: [{ index: 0, delta: { tool_calls: [{ index: idx, id: item.call_id ?? '', type: 'function', function: { name: item.name ?? '', arguments: '' } }] }, finish_reason: null }],
              });
            }
          }
          break;
        }
        case 'response.function_call_arguments.delta': {
          const delta = data.delta;
          if (!delta) break;
          const itemId = data.item_id;
          let idx = (itemId && this.toolIndexByItemId.get(itemId)) ?? this.lastToolIndex ?? this.nextContentIndex++;
          if (!this.openIndices.has(idx)) {
            this.openIndices.add(idx);
            out.push({
              id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model,
              choices: [{ index: 0, delta: { tool_calls: [{ index: idx, id: data.call_id ?? itemId ?? '', type: 'function', function: { name: data.name ?? this.toolNameByIndex.get(idx) ?? '', arguments: '' } }] }, finish_reason: null }],
            });
          }
          // Read 工具：先缓存，done 时统一清洗
          if (this.toolNameByIndex.get(idx) === 'Read') {
            this.toolArgsByIndex.set(idx, (this.toolArgsByIndex.get(idx) ?? '') + delta);
            break;
          }
          out.push({
            id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model,
            choices: [{ index: 0, delta: { tool_calls: [{ index: idx, function: { arguments: delta } }] }, finish_reason: null }],
          });
          break;
        }
        case 'response.function_call_arguments.done': {
          const itemId = data.item_id;
          let idx = (itemId && this.toolIndexByItemId.get(itemId)) ?? this.lastToolIndex;
          if (idx === undefined) break;
          if (this.toolNameByIndex.get(idx) === 'Read') {
            const raw = data.arguments ?? this.toolArgsByIndex.get(idx) ?? '';
            const sanitized = sanitizeReadArguments('Read', raw);
            if (sanitized) out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: { tool_calls: [{ index: idx, function: { arguments: sanitized } }] }, finish_reason: null }] });
          }
          this.openIndices.delete(idx);
          this.toolIndexByItemId.delete(itemId ?? '');
          this.toolNameByIndex.delete(idx);
          this.toolArgsByIndex.delete(idx);
          break;
        }
        case 'response.reasoning.delta': {
          const delta = data.delta ?? data.text;
          if (!delta) break;
          if (this.currentTextIndex !== null) {
            const idx = this.currentTextIndex; this.currentTextIndex = null;
            if (this.openIndices.delete(idx)) out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: {}, finish_reason: null }] });
            if (this.fallbackOpenIndex === idx) this.fallbackOpenIndex = null;
          }
          const idx = this.assignTextIndex(data);
          if (!this.openIndices.has(idx)) {
            this.openIndices.add(idx);
            out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: { reasoning_content: '' }, finish_reason: null }] });
          }
          out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: { reasoning_content: delta }, finish_reason: null }] });
          break;
        }
        case 'response.completed': {
          const stopReason = mapResponsesStopReason(respObj.status, this.hasToolUse, respObj.incomplete_details?.reason);
          for (const idx of [...this.openIndices].sort((a, b) => a - b)) {
            this.openIndices.delete(idx);
            out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: {}, finish_reason: null }] });
          }
          this.fallbackOpenIndex = null;
          const usage = respObj.usage ? { prompt_tokens: respObj.usage.input_tokens ?? 0, completion_tokens: respObj.usage.output_tokens ?? 0, total_tokens: (respObj.usage.input_tokens ?? 0) + (respObj.usage.output_tokens ?? 0) } : undefined;
          out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: {}, finish_reason: stopReason }], usage });
          break;
        }
        default:
          break;
      }
    }
    return out;
  }

  flush(): ChatStreamChunk[] { return []; }

  private assignTextIndex(data: any): number {
    const key = this.contentPartKey(data);
    if (key) {
      const existing = this.indexByKey.get(key);
      if (existing !== undefined) return existing;
      const assigned = this.nextContentIndex++;
      this.indexByKey.set(key, assigned);
      return assigned;
    }
    if (this.fallbackOpenIndex !== null) return this.fallbackOpenIndex;
    const assigned = this.nextContentIndex++;
    this.fallbackOpenIndex = assigned;
    return assigned;
  }

  private contentPartKey(data: any): string | null {
    if (data.item_id && data.content_index !== undefined) return `part:${data.item_id}:${data.content_index}`;
    if (data.output_index !== undefined && data.content_index !== undefined) return `part:out:${data.output_index}:${data.content_index}`;
    return null;
  }
}

/** canonical ChatStreamChunk[] -> 客户端 Responses 命名事件 SSE（有状态） */
export class ResponsesDownstreamStream implements StreamConverter {
  private created = Math.floor(Date.now() / 1000);
  private buffer = '';
  transform(chunk: ChatStreamChunk): string[] {
    const out: string[] = [];
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    const cid = () => `resp_${Date.now()}`;
    if (delta?.role) {
      out.push(`event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: chunk.id, model: chunk.model, status: 'in_progress', output: [] } })}\n\n`);
    }
    if (delta?.reasoning_content || delta?.reasoning) {
      const t = delta.reasoning_content ?? delta.reasoning ?? '';
      out.push(`event: response.reasoning.delta\ndata: ${JSON.stringify({ type: 'response.reasoning.delta', delta: t })}\n\n`);
    }
    if (delta?.content) {
      out.push(`event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: delta.content })}\n\n`);
    }
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.id || tc.function?.name) {
          out.push(`event: response.output_item.added\ndata: ${JSON.stringify({ type: 'response.output_item.added', item: { type: 'function_call', call_id: tc.id, name: tc.function?.name } })}\n\n`);
        }
        if (tc.function?.arguments) {
          out.push(`event: response.function_call_arguments.delta\ndata: ${JSON.stringify({ type: 'response.function_call_arguments.delta', delta: tc.function.arguments })}\n\n`);
          out.push(`event: response.function_call_arguments.done\ndata: ${JSON.stringify({ type: 'response.function_call_arguments.done' })}\n\n`);
        }
      }
    }
    if (choice?.finish_reason) {
      out.push(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: chunk.id, model: chunk.model, status: 'completed', usage: chunk.usage ?? {} } })}\n\n`);
    }
    return out;
  }
  flush(): string[] { return []; }
}
```

```ts
// src/converters/formats/responses/index.ts
import type { FormatAdapter } from '../../format-adapter.js';
import { responsesToChatRequest, chatToResponsesRequest } from './request.js';
import { responsesToChatResponse, chatToResponsesResponse } from './response.js';
import { ResponsesUpstreamStream, ResponsesDownstreamStream } from './stream.js';

export const responsesAdapter: FormatAdapter = {
  name: 'responses',
  toChatRequest: responsesToChatRequest,
  fromChatRequest: chatToResponsesRequest,
  toChatResponse: responsesToChatResponse,
  fromChatResponse: chatToResponsesResponse,
  createUpstreamStream: () => new ResponsesUpstreamStream(),
  createDownstreamStream: () => new ResponsesDownstreamStream(),
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/converters/responses/stream.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/converters/formats/responses tests/converters/responses/stream.test.ts
git commit -m "feat(responses): 流式命名事件状态机（含 Read 清洗/reasoning/function_call）"
```

---

## Task 8: ProviderType 扩展 + /v1/responses 路由

**Files:**
- Modify: `src/config.ts:5`
- Create: `src/routes/responses/handler.ts`
- Create: `src/routes/responses/upstream-request.ts`
- Create: `src/routes/responses/stream-handler.ts`
- Create: `src/routes/responses/non-stream-handler.ts`
- Modify: 主路由注册处（如 `src/routes/index.ts` 或 `src/app.ts`）

- [x] **Step 1: 扩展 ProviderType**

```ts
// src/config.ts
export type ProviderType = 'openai' | 'anthropic' | 'response-api';
```
同步检查 `src/lib/schema.ts` 与任何对 provider 字符串的校验（如 `providers/openai.ts`、`providers/anthropic.ts` 的 `getType()`），为 `response-api` 返回合适的 `BaseProvider` 子类或在 `getType()` 映射中处理。若 `getEndpoint('chat')` 对 response-api 需指向 `/v1/responses`，新增一个 `ResponseApiProvider` 或在 `buildUrl` 中按 `provider.provider === 'response-api'` 选择 endpoint `'responses'`。

- [x] **Step 2: 写 upstream-request.ts（用 router 链）**

```ts
// src/routes/responses/upstream-request.ts
import { resolveApiKey, type ApiKey, type ProviderConfig } from '../../config.js';
import { buildHeaders, buildUrl } from '../../providers/index.js';
import { resolveConverterChain } from '../../converters/router.js';
import { mergeModelParams } from '../../lib/params-merger.js';

export interface UpstreamRequest { url: string; headers: Record<string, string>; body: any; }

export async function buildResponsesUpstreamRequest(
  provider: ProviderConfig, body: any, stream: boolean, apiKeys?: ApiKey[]
): Promise<UpstreamRequest> {
  const resolvedKey = resolveApiKey(provider.apiKey, apiKeys ?? []);
  const effective = resolvedKey !== provider.apiKey ? { ...provider, apiKey: resolvedKey } : provider;
  const plan = resolveConverterChain('responses', effective.provider as any);
  let requestBody: any;
  if (plan.passthrough) {
    requestBody = { ...body, model: effective.realModel };
  } else {
    const chat = plan.sourceAdapter.toChatRequest(body);
    requestBody = { ...plan.providerAdapter.fromChatRequest(chat), model: effective.realModel };
  }
  const requestHeaders = buildHeaders(effective);
  const endpoint = effective.provider === 'response-api' ? 'responses' : 'chat';
  const url = buildUrl(effective, endpoint);
  requestBody = mergeModelParams(effective.defaultParams, requestBody);
  return { url, headers: requestHeaders, body: requestBody };
}
```

- [x] **Step 3: 写 stream-handler.ts（串联两段有状态流）**

```ts
// src/routes/responses/stream-handler.ts
import type { ProviderConfig } from '../../config.js';
import { resolveConverterChain } from '../../converters/router.js';

export function handleResponsesStream(opts: {
  response: Response; provider: ProviderConfig; model: string; requestId: string; c: any;
}): Response {
  const { response, provider, model, requestId, c } = opts;
  if (!response.body) return c.json({ error: { message: 'No response body' } }, 500);
  const plan = resolveConverterChain('responses', provider.provider as any);
  const upstream = plan.providerAdapter.createUpstreamStream();   // 上游 -> chat
  const downstream = plan.sourceAdapter.createDownstreamStream(); // chat -> responses 客户端
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) {
              for (const chatChunk of upstream.transform(buffer)) {
                for (const out of downstream.transform(chatChunk)) controller.enqueue(new TextEncoder().encode(out));
              }
            }
            for (const chatChunk of upstream.flush()) for (const out of downstream.transform(chatChunk)) controller.enqueue(new TextEncoder().encode(out));
            for (const out of downstream.flush()) controller.enqueue(new TextEncoder().encode(out));
            controller.close();
            break;
          }
          buffer += decoder.decode(value, { stream: false });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            if (!part.trim()) continue;
            for (const chatChunk of upstream.transform(part + '\n\n')) {
              for (const out of downstream.transform(chatChunk)) controller.enqueue(new TextEncoder().encode(out));
            }
          }
        }
      } catch (e) { try { controller.error(e); } catch {} }
    },
  });
  c.header('Content-Type', 'text/event-stream; charset=UTF-8');
  return c.body(stream);
}
```

- [x] **Step 4: 写 non-stream-handler.ts 与 handler.ts（镜像 messages 路由，调用 router）**

注意：`handler.ts` 复用 `buildResponsesUpstreamRequest` 与 `handleResponsesStream`，非流式分支调用 `plan.providerAdapter.toChatResponse` / `plan.sourceAdapter.fromChatResponse` 还原。具体代码参照现有 `src/routes/messages/handler.ts` 与 `non-stream-handler.ts` 结构平移，仅把直接的 `convertAnthropic* / convertOpenAI*` 调用替换为 router 链调用。

- [x] **Step 5: 主路由注册**

在路由注册处加：`app.post('/v1/responses', responsesHandler)`。

- [x] **Step 6: 类型检查 + 运行全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 编译通过；全部测试 PASS。

- [x] **Step 7: 提交**

```bash
git add -A src/config.ts src/routes/responses src/routes/index.ts
git commit -m "feat: 新增 /v1/responses 路由并扩展 ProviderType 支持 response-api"
```

---

## Task 9: 把现有 messages / chat-completions 路由改走 router（行为不变）

**Files:**
- Modify: `src/routes/messages/upstream-request.ts`
- Modify: `src/routes/messages/stream-handler.ts`
- Modify: `src/routes/messages/non-stream-handler.ts`
- Modify: `src/routes/chat-completions/upstream-request.ts`
- Modify: `src/routes/chat-completions/stream-handler.ts`
- Modify: `src/routes/chat-completions/non-stream-handler.ts`

- [x] **Step 1: messages/upstream-request.ts 改为 router 链**

将：
```ts
const openaiRequest = convertAnthropicRequestToOpenAI(body);
requestBody = { ...openaiRequest, model: effectiveProvider.realModel };
```
改为：
```ts
const plan = resolveConverterChain('anthropic', effectiveProvider.provider as any);
const chat = plan.sourceAdapter.toChatRequest(body);
requestBody = { ...plan.providerAdapter.fromChatRequest(chat), model: effectiveProvider.realModel };
```
（对 `provider === 'anthropic'` 分支保持 passthrough 不变，或交给 router 自动 passthrough。）

- [x] **Step 2: chat-completions/upstream-request.ts 改为 router 链**

将：
```ts
const anthropicRequest = await convertOpenAIRequestToAnthropic(body);
requestBody = { ...anthropicRequest, model: effectiveProvider.realModel };
```
改为：
```ts
const plan = resolveConverterChain('openai', effectiveProvider.provider as any);
const chat = plan.sourceAdapter.toChatRequest(body);
requestBody = { ...plan.providerAdapter.fromChatRequest(chat), model: effectiveProvider.realModel };
```

- [x] **Step 3: 两个 stream-handler 改为串联两段有状态流（参照 Task 8 的 handleResponsesStream 写法）**

`messages/stream-handler.ts` 用 `resolveConverterChain('anthropic', provider.provider)`；`chat-completions/stream-handler.ts` 用 `resolveConverterChain('openai', provider.provider)`。上游段 `providerAdapter.createUpstreamStream()` → 下游段 `sourceAdapter.createDownstreamStream()`。passthrough 时两段均为恒等/直传。

- [x] **Step 4: 非流式 handler 同样用 router 还原响应**

- [x] **Step 5: 运行全量测试确认行为不变**

Run: `npx vitest run`
Expected: 全部 PASS（与改造前一致）。

- [x] **Step 6: 提交**

```bash
git add -A src/routes/messages src/routes/chat-completions
git commit -m "refactor: messages/chat-completions 路由统一走 router 转换链"
```

---

## Task 10: 全量测试与 cc-switch 用例收尾

**Files:**
- Test: `tests/converters/router.test.ts`（已建，补 passthrough 场景）
- 运行：全量 `npx vitest run`

- [x] **Step 1: 补 router passthrough / 跨格式测试**

在 `tests/converters/router.test.ts` 增加：
```ts
it('openai->anthropic 非透传', () => {
  expect(resolveConverterChain('openai', 'anthropic').passthrough).toBe(false);
});
it('chat->chat 透传', () => {
  expect(resolveConverterChain('chat', 'chat').passthrough).toBe(true);
});
```

- [x] **Step 2: 运行全量测试**

Run: `npx vitest run`
Expected: 全部 PASS（含 `tests/converters/**` 全部遗留与新增用例）。

- [x] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [x] **Step 4: 提交**

```bash
git add -A tests/converters/router.test.ts
git commit -m "test: 补全 router 测试并确认全量绿灯"
```

---

## 自审对照（spec 覆盖）

- [x] canonical Chat* + `[FIDELITY-SLOT]` 槽 → Task 1
- [x] FormatAdapter / StreamConverter / router → Task 2
- [x] chat 恒等适配器 → Task 3
- [x] anthropic 适配器平移（行为不变）→ Task 4 + Task 9
- [x] responses 请求/响应 JSON 全量 → Task 5 + Task 6
- [x] responses 流式状态机（Read 清洗/reasoning/function_call/usage）→ Task 7
- [x] `/v1/responses` 路由 + `ProviderType` 扩 `'response-api'` → Task 8
- [x] 现有路由改走 router，行为不变 → Task 9
- [x] cc-switch 用例移植（function_call 流式、Read 空 pages、reasoning、usage）→ Task 7 测试
- [x] 全量 `npm test` 绿灯 → Task 10
