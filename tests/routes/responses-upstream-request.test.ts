/**
 * Tests for buildResponsesUpstreamRequest —— 重点验证 OpenAI Chat 字段白名单防御。
 */

import { describe, it, expect, vi } from 'vitest';
import { buildResponsesUpstreamRequest } from '../../src/routes/responses/upstream-request.js';
import type { ProviderConfig } from '../../src/config.js';

vi.mock('../../src/providers/index.js', () => ({
  buildHeaders: vi.fn(() => ({ Authorization: 'Bearer test-api-key', 'Content-Type': 'application/json' })),
  buildUrl: vi.fn((_config: any, path: string) => `https://api.example.com/${path}`)
}));

// 用一个可控的 chat adapter 链，注入带保真字段的 canonical，验证出站收敛
vi.mock('../../src/converters/router.js', () => ({
  resolveConverterChain: vi.fn((_source: string, provider: string) => {
    if (provider === 'response-api') {
      return { passthrough: true, sourceAdapter: null, providerAdapter: null };
    }
    return {
      passthrough: false,
      sourceAdapter: {
        toChatRequest: (body: any) => ({
          model: body.model,
          messages: [{ role: 'user', content: 'hi' }],
          // 注入 canonical 保真字段 + 非白名单字段
          previousResponseId: 'resp_123',
          responseInstructions: 'be terse',
          temperature: 0.5,
          stream: true,
          thinking: { type: 'disabled' }
        })
      },
      providerAdapter: {
        fromChatRequest: (chat: any) => ({ ...chat })
      }
    };
  })
}));

const openaiProvider = {
  customModel: 'm',
  realModel: 'gpt-4o',
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com',
  provider: 'openai'
} as unknown as ProviderConfig;

const responseApiProvider = {
  customModel: 'm',
  realModel: 'gpt-4o',
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com',
  provider: 'response-api'
} as unknown as ProviderConfig;

describe('buildResponsesUpstreamRequest — OpenAI Chat 白名单防御', () => {
  it('应过滤掉 defaultParams 的非白名单字段（thinking/reasoning_effort）以及保真字段', async () => {
    const provider = {
      ...openaiProvider,
      defaultParams: { reasoning_effort: null, thinking: { type: 'disabled' } }
    } as unknown as ProviderConfig;

    const result = await buildResponsesUpstreamRequest(provider, { model: 'm', input: 'hi' }, true);

    expect(result.url).toBe('https://api.example.com/chat');
    const body = result.body;
    // 保留的白名单字段
    expect(body.model).toBe('gpt-4o');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.temperature).toBe(0.5);
    expect(body.stream).toBe(true);
    // 必须被过滤掉的字段
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.previousResponseId).toBeUndefined();
    expect(body.responseInstructions).toBeUndefined();
  });

  it('response-api passthrough 路径请求体逐字节透传（只换 model，不混 defaultParams）', async () => {
    const provider = {
      ...responseApiProvider,
      defaultParams: { reasoning_effort: null }
    } as unknown as ProviderConfig;

    const clientBody = {
      model: 'm',
      input: [{ type: 'message', id: 'msg_1', role: 'developer', content: [{ type: 'input_text', text: 'sys' }] }],
      instructions: 'be terse',
      tools: [],
      tool_choice: 'auto',
      parallel_tool_calls: true,
      reasoning: { effort: 'low', summary: 'auto' },
      store: false,
      include: ['reasoning.encrypted_content'],
      text: { verbosity: 'low' },
      stream: true,
      previous_response_id: 'resp_123',
    };
    const result = await buildResponsesUpstreamRequest(provider, clientBody, true);

    expect(result.url).toBe('https://api.example.com/responses');
    const body = result.body;
    expect(body.model).toBe('gpt-4o');
    // Responses 字段一个不动
    expect(body.tool_choice).toBe('auto');
    expect(body.parallel_tool_calls).toBe(true);
    expect(body.reasoning).toEqual({ effort: 'low', summary: 'auto' });
    expect(body.store).toBe(false);
    expect(body.include).toEqual(['reasoning.encrypted_content']);
    expect(body.text).toEqual({ verbosity: 'low' });
    expect(body.previous_response_id).toBe('resp_123');
    expect(body.instructions).toBe('be terse');
    expect(body.input).toEqual(clientBody.input);
    // defaultParams 不混入透传请求
    expect(body.reasoning_effort).toBeUndefined();
  });
});
