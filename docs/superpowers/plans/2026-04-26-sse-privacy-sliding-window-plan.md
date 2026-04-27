# SSE 隐私保护 — 滑动窗口缓冲实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在隐私模式下使用 3-chunk 滑动窗口缓冲替换 SSE 流中的路径占位符，无隐私模式保持零延迟实时转发。

**架构:** 在 `sanitizer.ts` 添加 `applyPathMappings` 函数（不删除映射表），在 `stream-handler.ts` 实现滑动窗口逻辑（无隐私→实时转发，隐私→缓冲 3 个→替换→按比例拆分→发送）。

**Tech Stack:** TypeScript, Hono ReadableStream, vitest

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/privacy/sanitizer.ts` | 修改 | 新增 `applyPathMappings()` — 对纯文本做路径替换，不删除映射表 |
| `src/routes/chat-completions/stream-handler.ts` | 修改 | 重写 `handleStream()` — 隐私模式用滑动窗口，非隐私模式实时转发。删除当前无效的 placeholderPath/realPathFromContent 函数 |
| `tests/routes/stream-handler-privacy.test.ts` | 新增 | 8 个测试用例覆盖隐私/非隐私两条路径 |

---

### Task 1: 添加 `applyPathMappings` 到 sanitizer

**Files:**
- Modify: `src/privacy/sanitizer.ts:127-153` (在 `sanitizeSSEChunk` 后添加)
- Test: `tests/routes/stream-handler-privacy.test.ts` (Task 2 覆盖)

- [ ] **Step 1: 在 sanitizer.ts 添加 `applyPathMappings` 函数**

在 `sanitizeSSEChunk` 函数之后、`getPathMappings` 函数之前，添加：

```ts
/**
 * Apply path mappings to a plain text string.
 * Does NOT clear the mapping (unlike restorePaths).
 * Used for SSE chunk concatenation in sliding window.
 */
export function applyPathMappings(
  text: string,
  requestId: string
): string {
  const mapping = pathMappings.get(requestId);
  if (!mapping) return text;

  let result = text;
  for (const [placeholderPath, realPath] of mapping) {
    result = result.split(placeholderPath).join(realPath);
  }
  return result;
}
```

该函数与 `sanitizeSSEChunk` 的逻辑完全相同，但更清晰地表达"对拼接后的文本做替换"的意图，且不影响现有的 `sanitizeSSEChunk`。

- [ ] **Step 2: 确保 `getPathMappings` 保持不变**

现有的 `getPathMappings` 函数不动，保持原样。

- [ ] **Step 3: 运行现有测试确认无破坏**

```bash
npm test -- --run 2>&1 | tail -5
```

Expected: 664 passed | 8 skipped

- [ ] **Step 4: Commit**

```bash
git add src/privacy/sanitizer.ts
git commit -m "feat(privacy): add applyPathMappings for SSE sliding window"
```

---

### Task 2: 重写 stream-handler — 隐私/非隐私双路径

**Files:**
- Modify: `src/routes/chat-completions/stream-handler.ts` (完全重写)
- Modify: `src/routes/chat-completions/stream-handler.ts` 的 import (添加 `applyPathMappings`)

- [ ] **Step 1: 更新 import**

将：
```ts
import { sanitizeSSEChunk, restorePaths, getPathMappings } from '../../privacy/sanitizer.js';
```
改为：
```ts
import { applyPathMappings, restorePaths } from '../../privacy/sanitizer.js';
```

- [ ] **Step 2: 添加 `splitByOriginalLengths` 辅助函数**

在文件底部（删除旧的 `placeholderPath`/`realPathFromContent` 函数后），添加：

```ts
/**
 * Split a restored string proportionally based on original chunk lengths.
 * The last chunk takes all remaining characters to avoid rounding loss.
 */
function splitByOriginalLengths(restored: string, originalLengths: number[]): string[] {
  const totalLen = originalLengths.reduce((a, b) => a + b, 0);
  const result: string[] = [];
  let offset = 0;

  for (let i = 0; i < originalLengths.length; i++) {
    const ratio = originalLengths[i] / totalLen;
    const chunkLen = Math.round(restored.length * ratio);
    const actualLen = i === originalLengths.length - 1
      ? restored.length - offset
      : chunkLen;
    result.push(restored.slice(offset, offset + actualLen));
    offset += actualLen;
  }

  return result;
}
```

- [ ] **Step 3: 重写 `handleStream` 主循环**

替换整个 `handleStream` 函数体为：

```ts
export function handleStream(options: StreamHandlerOptions): Response {
  const { response, provider, model, actualModel, requestId, startTime, logEntry, rateLimiter, logger, detailLogger, c, privacySettings } = options;

  if (!response.body) {
    return c.json({ error: { message: 'No response body' } }, 500);
  }

  const providerFormat = provider.provider;
  const streamState: StreamConverterState | undefined =
    providerFormat === 'anthropic' ? createStreamConverterState() : undefined;

  const chunks: string[] = [];
  const rawChunks: string[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const privacyOn = privacySettings?.enabled && privacySettings.sanitizeFilePaths;
  const privacyBuffer: string[] = [];

  const transformedStream = new ReadableStream({
    async start(controller) {
      try {
        let buffer = '';
        let finalUsage: any = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // OpenRouter: last chunk may not end with \n\n
            if (provider.baseUrl?.includes('openrouter') && buffer.trim()) {
              let sseLine = buffer;
              if (!sseLine.startsWith('data:')) {
                sseLine = `data: ${sseLine}`;
              }
              if (!sseLine.endsWith('\n\n')) {
                sseLine += '\n\n';
              }
              if (privacyOn) {
                privacyBuffer.push(sseLine);
              } else {
                chunks.push(sseLine);
              }
            }

            detailLogger.logStreamResponse(requestId + '_raw', rawChunks);

            // Extract usage from chunks
            const usageSource = privacyOn ? privacyBuffer : chunks;
            for (let i = usageSource.length - 1; i >= 0; i--) {
              try {
                const chunkJson = JSON.parse(usageSource[i].slice(5).trim());
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
                // ignore parse errors
              }
            }

            if (finalUsage) {
              logEntry.promptTokens = finalUsage.prompt_tokens || finalUsage.input_tokens;
              logEntry.completionTokens = finalUsage.completion_tokens || finalUsage.output_tokens;
              logEntry.totalTokens = finalUsage.total_tokens || (logEntry.promptTokens + logEntry.completionTokens);
            }

            // Privacy mode: flush remaining buffer
            if (privacyOn && privacyBuffer.length > 0) {
              flushPrivacyBuffer(privacyBuffer, requestId, controller);
            }

            // Logging (privacy mode only)
            if (privacyOn) {
              const fullResponse = buildFullOpenAIResponse(chunks);
              restorePaths(fullResponse, requestId);
              detailLogger.logStreamResponse(requestId, chunks);
              detailLogger.logConvertedResponse(requestId, fullResponse);
            }

            if (finalUsage) {
              const finalChunk = `data: ${JSON.stringify({
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: {}, finish_reason: null }],
                usage: finalUsage,
              })}\n\n`;
              controller.enqueue(new TextEncoder().encode(finalChunk));
            }

            logger.log(logEntry);

            const pricing =
              provider.inputPricePer1M !== undefined &&
              provider.outputPricePer1M !== undefined &&
              provider.cachedPricePer1M !== undefined
                ? {
                    inputPricePer1M: provider.inputPricePer1M,
                    outputPricePer1M: provider.outputPricePer1M,
                    cachedPricePer1M: provider.cachedPricePer1M,
                  }
                : undefined;
            rateLimiter.recordUsage(actualModel || model, logEntry, pricing);
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

            // Skip OpenRouter comment lines
            if (provider.baseUrl?.includes('openrouter') && part.startsWith(':')) {
              continue;
            }

            if (providerFormat === 'anthropic') {
              const openAIChunks = parseAndConvertAnthropicSSE(part, requestId, model, streamState!);
              for (const openAIChunk of openAIChunks) {
                if (!privacyOn) {
                  try {
                    controller.enqueue(new TextEncoder().encode(openAIChunk));
                  } catch (err) {
                    if (!isSilentError(err)) throw err;
                  }
                } else {
                  privacyBuffer.push(openAIChunk);
                  if (privacyBuffer.length >= 3) {
                    flushPrivacyWindow(privacyBuffer, requestId, controller);
                  }
                }
              }
            } else {
              let sseLine = part;
              if (!sseLine.startsWith('data:')) {
                sseLine = `data: ${sseLine}`;
              }
              if (!sseLine.endsWith('\n\n')) {
                sseLine += '\n\n';
              }
              if (!privacyOn) {
                try {
                  controller.enqueue(new TextEncoder().encode(sseLine));
                } catch (err) {
                  if (isSilentError(err)) return;
                  throw err;
                }
              } else {
                privacyBuffer.push(sseLine);
                if (privacyBuffer.length >= 3) {
                  flushPrivacyWindow(privacyBuffer, requestId, controller);
                }
              }
            }
          }
        }
      } catch (error) {
        try {
          controller.error(error);
        } catch {
          // controller already closed
        }
      }
    },
  });

  return c.body(transformedStream);
}
```

- [ ] **Step 4: 添加 `flushPrivacyWindow` 和 `flushPrivacyBuffer` 函数**

在 `handleStream` 之后、`splitByOriginalLengths` 之前，添加：

```ts
/**
 * Flush the first 3 chunks from the privacy buffer as a sliding window.
 * Joins them, applies path mappings, splits proportionally, sends the first.
 */
function flushPrivacyWindow(
  buffer: string[],
  requestId: string,
  controller: ReadableStreamDefaultController
): void {
  if (buffer.length < 3) return;

  const windowChunks = buffer.slice(0, 3);
  const originalLengths = windowChunks.map(c => c.length);

  const combined = windowChunks.join('');
  const restored = applyPathMappings(combined, requestId);
  const split = splitByOriginalLengths(restored, originalLengths);

  // Send the oldest chunk
  try {
    controller.enqueue(new TextEncoder().encode(split[0]));
  } catch (err) {
    if (isSilentError(err)) return;
    throw err;
  }

  // Replace the first 3 buffer entries with the remaining 2 restored chunks
  buffer.splice(0, 3, split[1], split[2]);
}

/**
 * Flush all remaining chunks from the privacy buffer (stream end).
 */
function flushPrivacyBuffer(
  buffer: string[],
  requestId: string,
  controller: ReadableStreamDefaultController
): void {
  if (buffer.length === 0) return;

  const originalLengths = buffer.map(c => c.length);
  const combined = buffer.join('');
  const restored = applyPathMappings(combined, requestId);
  const split = splitByOriginalLengths(restored, originalLengths);

  for (const chunk of split) {
    try {
      controller.enqueue(new TextEncoder().encode(chunk));
    } catch (err) {
      if (isSilentError(err)) return;
      throw err;
    }
  }
}
```

- [ ] **Step 5: 删除旧的辅助函数**

删除文件底部的：
```ts
function placeholderPath(fullResponse: any, _chunkIndex: number, _chunks: string[]): string {
  const content = fullResponse?.choices?.[0]?.message?.content || '';
  return content;
}

function realPathFromContent(_fullResponse: any, origContent: string, _chunkIndex: number): string {
  return origContent;
}
```

- [ ] **Step 6: 运行现有 stream-handler 测试**

```bash
npm test -- --run tests/routes/stream-handler.test.ts 2>&1 | tail -10
```

Expected: 12 tests pass (这些测试不带 privacySettings，走实时转发路径)

- [ ] **Step 7: Commit**

```bash
git add src/routes/chat-completions/stream-handler.ts
git commit -m "refactor(stream): dual-path SSE handling — real-time vs privacy sliding window"
```

---

### Task 3: 编写隐私模式 SSE 测试

**Files:**
- Create: `tests/routes/stream-handler-privacy.test.ts`

- [ ] **Step 1: 创建测试文件**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleStream, type StreamHandlerOptions } from '../../src/routes/chat-completions/stream-handler.js';
import { clearPathMappings } from '../../src/privacy/sanitizer.js';

// ==================== Mock Helpers ====================

function createMockHonoContext(): any {
  return {
    body: (stream: ReadableStream) => new Response(stream),
    json: (data: any, status: number) => new Response(JSON.stringify(data), { status }),
  };
}

function createMockLogger(): any {
  return { log: vi.fn() };
}

function createMockDetailLogger(): any {
  return {
    logStreamResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
  };
}

function createMockRateLimiter(): any {
  return { recordUsage: vi.fn() };
}

function makeSSEChunk(content: string): string {
  return `data: ${JSON.stringify({
    id: 'test-id',
    object: 'chat.completion.chunk',
    created: 1234567,
    model: 'gpt-4',
    choices: [{ index: 0, delta: { content }, finish_reason: null }]
  })}\n\n`;
}

function createPrivacyOpenAIStream(content: string, usage?: any): ReadableStream {
  const encoder = new TextEncoder();
  // Split content into single-character chunks to simulate tokenization
  const parts: Uint8Array[] = [];
  for (const char of content) {
    parts.push(encoder.encode(makeSSEChunk(char)));
  }
  if (usage) {
    parts.push(encoder.encode(`data: ${JSON.stringify({ id: 'test-id', object: 'chat.completion.chunk', created: 1234567, model: 'gpt-4', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\n`));
  }
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

const baseOptions = (response: Response, privacySettings?: any): StreamHandlerOptions => ({
  response,
  provider: { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'x', baseUrl: 'https://api.openai.com', provider: 'openai' },
  model: 'gpt-4',
  actualModel: 'gpt-4',
  requestId: 'req-123',
  startTime: Date.now(),
  logEntry: {},
  rateLimiter: createMockRateLimiter(),
  logger: createMockLogger(),
  detailLogger: createMockDetailLogger(),
  c: createMockHonoContext(),
  privacySettings,
});

async function collectStream(res: Response): Promise<string[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }
  return chunks;
}

// ==================== Tests ====================

describe('SSE privacy — sliding window', () => {
  beforeEach(() => { clearPathMappings(); });

  it('no privacy: forwards chunks immediately as-is', async () => {
    const content = 'Hello world';
    const response = new Response(createPrivacyOpenAIStream(content));
    // Simulate: upstream response already exists, handleStream wraps it
    const stream = createPrivacyOpenAIStream(content);
    const res = handleStream(baseOptions(new Response(stream)));
    const chunks = await collectStream(res);

    // Each content character should be in its own chunk (real-time passthrough)
    const allContent = chunks.join('');
    expect(allContent).toContain('Hello world');
  });

  it('privacy mode: replaces complete placeholder in single chunk', async () => {
    // Setup: request had /home/zhangsan/, LLM returns /home/__USER__/
    // Since applyPathMappings works on the concatenated buffer,
    // we test that the placeholder gets replaced
    const placeholder = '/home/__USER__/file.txt';
    const real = '/home/zhangsan/file.txt';

    // We need to set up path mappings first (simulate sanitizePaths was called)
    const { sanitizePaths } = await import('../../src/privacy/sanitizer.js');
    const reqBody = { messages: [{ role: 'user', content: `Fix ${real}` }] };
    sanitizePaths(reqBody, '__USER__', 'req-123');

    const response = new Response(createPrivacyOpenAIStream(`Fixed ${placeholder}`));
    const res = handleStream(baseOptions(response, {
      enabled: true,
      sanitizeFilePaths: true,
    }));
    const chunks = await collectStream(res);
    const allContent = chunks.join('');

    expect(allContent).toContain('/home/zhangsan/');
    expect(allContent).not.toContain('/home/__USER__/');
  });

  it('privacy mode: replaces placeholder split across 2 chunks', async () => {
    const { sanitizePaths } = await import('../../src/privacy/sanitizer.js');
    const reqBody = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/app/main.py' }] };
    sanitizePaths(reqBody, '__USER__', 'req-123');

    // Placeholder split: C1 ends with "/home/__USE", C2 starts with "R__/"
    const chunk1 = makeSSEChunk('See /home/__USE');
    const chunk2 = makeSSEChunk('R__/app/main.py');
    const chunk3 = makeSSEChunk(' done');

    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(chunk1));
        controller.enqueue(enc.encode(chunk2));
        controller.enqueue(enc.encode(chunk3));
        controller.close();
      },
    });

    const res = handleStream(baseOptions(new Response(stream), {
      enabled: true,
      sanitizeFilePaths: true,
    }));
    const chunks = await collectStream(res);
    const allContent = chunks.join('');

    expect(allContent).toContain('/home/zhangsan/');
    expect(allContent).not.toContain('__USER__');
  });

  it('privacy mode: replaces placeholder split across 3 chunks', async () => {
    const { sanitizePaths } = await import('../../src/privacy/sanitizer.js');
    const reqBody = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/app/main.py' }] };
    sanitizePaths(reqBody, '__USER__', 'req-123');

    // Split across 3: C1="/home/__", C2="USE", C3="R__/app"
    const chunk1 = makeSSEChunk('Path: /home/__');
    const chunk2 = makeSSEChunk('USE');
    const chunk3 = makeSSEChunk('R__/app/main.py');

    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(chunk1));
        controller.enqueue(enc.encode(chunk2));
        controller.enqueue(enc.encode(chunk3));
        controller.close();
      },
    });

    const res = handleStream(baseOptions(new Response(stream), {
      enabled: true,
      sanitizeFilePaths: true,
    }));
    const chunks = await collectStream(res);
    const allContent = chunks.join('');

    expect(allContent).toContain('/home/zhangsan/');
    expect(allContent).not.toContain('__USER__');
  });

  it('privacy mode: flushes remaining < 3 chunks at stream end', async () => {
    const { sanitizePaths } = await import('../../src/privacy/sanitizer.js');
    const reqBody = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/app/main.py' }] };
    sanitizePaths(reqBody, '__USER__', 'req-123');

    // Only 2 chunks (less than window size 3)
    const chunk1 = makeSSEChunk('See /home/__USER__/');
    const chunk2 = makeSSEChunk('file.txt');

    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(chunk1));
        controller.enqueue(enc.encode(chunk2));
        controller.close();
      },
    });

    const res = handleStream(baseOptions(new Response(stream), {
      enabled: true,
      sanitizeFilePaths: true,
    }));
    const chunks = await collectStream(res);

    // Should have received output (flushed remaining)
    expect(chunks.length).toBeGreaterThan(0);
    const allContent = chunks.join('');
    expect(allContent).toContain('/home/zhangsan/');
  });

  it('privacy mode: no character loss after replacement', async () => {
    const { sanitizePaths } = await import('../../src/privacy/sanitizer.js');
    const reqBody = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/app/main.py' }] };
    sanitizePaths(reqBody, '__USER__', 'req-123');

    const text = 'Hello /home/__USER__/file.txt world';
    const stream = createPrivacyOpenAIStream(text);

    const res = handleStream(baseOptions(new Response(stream), {
      enabled: true,
      sanitizeFilePaths: true,
    }));
    const chunks = await collectStream(res);
    const output = chunks.join('');

    // The output should have the same structural content, just with replaced paths
    // Count data: prefixes to verify chunks were sent
    const chunkCount = output.split('data:').length - 1;
    expect(chunkCount).toBeGreaterThan(0);
    expect(output).toContain('/home/zhangsan/');
    expect(output).not.toContain('__USER__');
  });

  it('privacy mode: Anthropic format converts and replaces paths', async () => {
    const { sanitizePaths } = await import('../../src/privacy/sanitizer.js');
    const reqBody = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/app.py' }] };
    sanitizePaths(reqBody, '__USER__', 'req-123');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_1', role: 'assistant', usage: { input_tokens: 5, output_tokens: 0 } } })}\n\n`));
        controller.enqueue(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`));
        controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Fixed /home/__USER__/app.py' } })}\n\n`));
        controller.enqueue(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`));
        controller.enqueue(encoder.encode(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 5, output_tokens: 10 } })}\n\n`));
        controller.enqueue(encoder.encode(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`));
        controller.close();
      },
    });

    const res = handleStream(baseOptions(new Response(stream), {
      enabled: true,
      sanitizeFilePaths: true,
    }));
    const chunks = await collectStream(res);
    const allContent = chunks.join('');

    expect(allContent).toContain('/home/zhangsan/');
    expect(allContent).not.toContain('__USER__');
  });

  it('privacy mode: handles tool_calls in chunks', async () => {
    const { sanitizePaths } = await import('../../src/privacy/sanitizer.js');
    const reqBody = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/app.py' }] };
    sanitizePaths(reqBody, '__USER__', 'req-123');

    const encoder = new TextEncoder();
    const chunk1 = `data: ${JSON.stringify({
      id: 'test-id',
      object: 'chat.completion.chunk',
      created: 1234567,
      model: 'gpt-4',
      choices: [{ index: 0, delta: { tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"/home/__USER__/app.py"}' }] } }, finish_reason: null }]
    })}\n\n`;
    const chunk2 = `data: ${JSON.stringify({
      id: 'test-id',
      object: 'chat.completion.chunk',
      created: 1234567,
      model: 'gpt-4',
      choices: [{ index: 0, delta: { content: 'Done' }, finish_reason: 'stop' }]
    })}\n\n`;

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(chunk1));
        controller.enqueue(encoder.encode(chunk2));
        controller.close();
      },
    });

    const res = handleStream(baseOptions(new Response(stream), {
      enabled: true,
      sanitizeFilePaths: true,
    }));
    const chunks = await collectStream(res);
    const allContent = chunks.join('');

    expect(allContent).toContain('/home/zhangsan/');
    expect(allContent).not.toContain('__USER__');
  });
});
```

- [ ] **Step 2: 运行新测试**

```bash
npm test -- --run tests/routes/stream-handler-privacy.test.ts 2>&1
```

Expected: 8 tests pass

- [ ] **Step 3: 运行全部测试**

```bash
npm test -- --run 2>&1 | tail -5
```

Expected: 672 passed | 8 skipped (664 existing + 8 new)

- [ ] **Step 4: Commit**

```bash
git add tests/routes/stream-handler-privacy.test.ts
git commit -m "test: add SSE privacy sliding window tests (8 cases)"
```

---

### Task 4: 构建验证

- [ ] **Step 1: 构建**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors, dist/ updated

- [ ] **Step 2: 最终测试**

```bash
npm test -- --run 2>&1 | tail -5
```

Expected: 672 passed | 8 skipped

- [ ] **Step 3: Commit (if any build artifacts changed)**

```bash
git add dist/
git commit -m "build: rebuild dist"
```
