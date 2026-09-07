/**
 * 智能识别（model 字段传组名）路径的失败透传测试
 *
 * 复现 bug：当 model="组名" 被识别为模型组、但组内某个模型名在 provider configs
 * 中找不到（模型被删/改名）时，resolveModelGroup 会抛出带原因的精确错误；
 * 而 handler 的智能识别分支 catch 后直接 fall through 到 "Model not found" 404，
 * 把真实错误原因吞掉了。期望：透传 resolver 抛出的真实错误信息。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { ProxyConfig } from '../../src/config.js';
import type { Logger } from '../../src/logger.js';
import type { DetailLogger } from '../../src/detail-logger.js';
import { createChatCompletionsRoute } from '../../src/routes/chat-completions/index.js';
import { createMessagesRoute } from '../../src/routes/messages/index.js';
import { createResponsesRoute } from '../../src/routes/responses/index.js';

global.fetch = vi.fn();

class MockLogger {
  log(_entry: any) {}
}
class MockDetailLogger {
  logRequest(_id: string, _body: any) {}
  logUpstreamRequest(_id: string, _body: any) {}
  logStreamResponse(_id: string, _chunks: string[]) {}
  logConvertedResponse(_id: string, _response: any) {}
}

// 配置：models 里有 test-a，但组 broken-pool 引用了已被删除/改名的 missing-model
const proxyConfig: ProxyConfig = {
  models: [
    {
      customModel: 'test-a',
      realModel: 'gpt-3.5-turbo',
      provider: 'openai',
      apiKey: 'sk-test-a',
      baseUrl: 'https://api.openai.com/v1'
    }
  ],
  modelGroups: [
    { name: 'broken-pool', models: ['missing-model'], desc: 'references a removed model' }
  ]
} as any;

function buildApp(factory: (...args: any[]) => Hono) {
  const app = new Hono();
  const logger = new MockLogger() as unknown as Logger;
  const detailLogger = new MockDetailLogger() as unknown as DetailLogger;
  app.route('', factory(proxyConfig, logger, detailLogger, 30000, '/tmp'));
  return app;
}

describe('智能识别：model 传组名但组内模型缺失 → 透传真实错误而非 404', () => {
  beforeEach(() => {
    vi.mocked(global.fetch).mockReset();
  });

  it('chat/completions 不应返回笼统 Model not found 404', async () => {
    const app = buildApp(createChatCompletionsRoute);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'broken-pool',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false
      })
    });
    const json: any = await res.json();
    // 期望：带上 resolver 抛出的真实原因（指明是组内哪个模型找不到），而不是吞成通用 404
    expect(res.status).not.toBe(404);
    expect(json.error.message).toContain('missing-model');
    expect(json.error.message).toContain('broken-pool');
  });

  it('messages 不应返回笼统 Model not found 404', async () => {
    const app = buildApp(createMessagesRoute);
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'broken-pool',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1024,
        stream: false
      })
    });
    const json: any = await res.json();
    expect(res.status).not.toBe(404);
    expect(json.error.message).toContain('missing-model');
    expect(json.error.message).toContain('broken-pool');
  });

  it('responses 不应返回笼统 Model not found 404', async () => {
    const app = buildApp(createResponsesRoute);
    const res = await app.request('/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'broken-pool',
        input: 'hi',
        stream: false
      })
    });
    const json: any = await res.json();
    expect(res.status).not.toBe(404);
    expect(json.error.message).toContain('missing-model');
    expect(json.error.message).toContain('broken-pool');
  });
});
