import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { ProxyConfig } from '../../src/config.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import { createChatCompletionsRoute } from '../../src/routes/chat-completions/index.js';
import { clearPathMappings } from '../../src/privacy/sanitizer.js';

global.fetch = vi.fn();

class MockLogger { log(_e: any) {} getFilePath() { return '/tmp/test.log'; } }
class MockDetailLogger {
  logRequest(_i: string, _b: any) {}
  logUpstreamRequest(_i: string, _b: any) {}
  logStreamResponse(_i: string, _c: string[]) {}
  logResponse(_i: string, _r: any) {}
  logConvertedResponse(_i: string, _r: any) {}
}

describe('privacy protection — chat-completions route', () => {
  let app: Hono;

  function setup(config: ProxyConfig) {
    app = new Hono();
    const logger = new MockLogger() as unknown as Logger;
    const detailLogger = new MockDetailLogger() as unknown as DetailLogger;
    app.route('', createChatCompletionsRoute(config, logger, detailLogger, 30000, '/tmp'));
  }

  beforeEach(() => { vi.clearAllMocks(); clearPathMappings(); });

  it('should send body with user field when privacy is disabled', async () => {
    const config: ProxyConfig = {
      models: [{ customModel: 'gpt-4', realModel: 'gpt-4o', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' }],
      privacySettings: { enabled: false, stripUserField: false, sanitizeFilePaths: false, pathPlaceholder: '__USER__', whitelistFilter: false }
    };
    setup(config);

    (global.fetch as any).mockResolvedValue({
      ok: true, status: 200, body: null,
      json: async () => ({ id: 'resp-1', choices: [{ message: { content: 'hi', role: 'assistant' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
    });

    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }], user: 'user-123' })
    });

    const callArgs = (global.fetch as any).mock.calls[0];
    const sentBody = JSON.parse(callArgs[1].body);
    expect(sentBody).toHaveProperty('user', 'user-123');
  });

  it('should remove user field when privacy is enabled with stripUserField=true', async () => {
    const config: ProxyConfig = {
      models: [{ customModel: 'gpt-4', realModel: 'gpt-4o', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' }],
      privacySettings: { enabled: true, stripUserField: true, sanitizeFilePaths: false, pathPlaceholder: '__USER__', whitelistFilter: false }
    };
    setup(config);

    (global.fetch as any).mockResolvedValue({
      ok: true, status: 200, body: null,
      json: async () => ({ id: 'resp-1', choices: [{ message: { content: 'hi', role: 'assistant' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
    });

    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }], user: 'user-123' })
    });

    const callArgs = (global.fetch as any).mock.calls[0];
    const sentBody = JSON.parse(callArgs[1].body);
    expect(sentBody).not.toHaveProperty('user');
  });

  it('should sanitize file paths when enabled', async () => {
    const config: ProxyConfig = {
      models: [{ customModel: 'gpt-4', realModel: 'gpt-4o', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' }],
      privacySettings: { enabled: true, stripUserField: false, sanitizeFilePaths: true, pathPlaceholder: '__USER__', whitelistFilter: false }
    };
    setup(config);

    (global.fetch as any).mockResolvedValue({
      ok: true, status: 200, body: null,
      json: async () => ({ id: 'resp-1', choices: [{ message: { content: 'Fixed /home/__USER__/app/main.py', role: 'assistant' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
    });

    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: 'Fix /home/zhangsan/app/main.py' }] })
    });

    const callArgs = (global.fetch as any).mock.calls[0];
    const sentBody = JSON.parse(callArgs[1].body);
    expect(sentBody.messages[0].content).toContain('/home/__USER__/');
  });

  it('should restore usernames in response when paths were sanitized', async () => {
    const config: ProxyConfig = {
      models: [{ customModel: 'gpt-4', realModel: 'gpt-4o', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' }],
      privacySettings: { enabled: true, stripUserField: false, sanitizeFilePaths: true, pathPlaceholder: '__USER__', whitelistFilter: false }
    };
    setup(config);

    const mockResponse = {
      id: 'resp-1',
      choices: [{ message: { content: 'Fixed /home/__USER__/app/main.py', role: 'assistant' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    };

    (global.fetch as any).mockResolvedValue({
      ok: true, status: 200,
      body: new ReadableStream({ start(controller) { controller.close(); } }),
      json: async () => mockResponse,
      clone: function() { return this; }
    });

    const resp = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: 'Fix /home/zhangsan/app/main.py' }] })
    });

    expect(resp.status).toBe(200);
    const json = await (resp as any).json();
    expect(json.choices[0].message.content).toContain('/home/zhangsan/');
  });

  it('should log request body AFTER privacy protection (sanitized paths)', async () => {
    const logger = new MockLogger() as unknown as Logger;
    const detailLogger = new MockDetailLogger() as unknown as DetailLogger;
    const logRequestSpy = vi.spyOn(detailLogger, 'logRequest');
    const logUpstreamSpy = vi.spyOn(detailLogger, 'logUpstreamRequest');

    const app = new Hono();
    const config: ProxyConfig = {
      models: [{ customModel: 'gpt-4', realModel: 'gpt-4o', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' }],
      privacySettings: { enabled: true, stripUserField: false, sanitizeFilePaths: true, pathPlaceholder: '__USER__', whitelistFilter: false }
    };
    app.route('', createChatCompletionsRoute(config, logger, detailLogger, 30000, '/tmp'));

    (global.fetch as any).mockResolvedValue({
      ok: true, status: 200, body: null,
      json: async () => ({ id: 'resp-1', choices: [{ message: { content: 'ok', role: 'assistant' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
    });

    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: 'Fix /home/zhangsan/app/main.py' }] })
    });

    // logRequest should have RAW content (before privacy protection, for audit)
    expect(logRequestSpy).toHaveBeenCalledTimes(1);
    const loggedBody = logRequestSpy.mock.calls[0][1];
    expect(loggedBody.messages[0].content).toContain('/home/zhangsan/');

    // logUpstreamRequest should have sanitized paths (what LLM receives)
    expect(logUpstreamSpy).toHaveBeenCalledTimes(1);
    const upstreamBody = logUpstreamSpy.mock.calls[0][1];
    expect(upstreamBody.messages[0].content).toContain('/home/__USER__/');
    expect(upstreamBody.messages[0].content).not.toContain('/home/zhangsan/');
  });
});
