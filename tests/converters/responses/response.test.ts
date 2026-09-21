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
  it('chat usage 无 details 时补 reasoning_tokens/cached_tokens 默认 0', () => {
    const chat = {
      id: 'resp_4', model: 'm',
      choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
    } as any;
    const r = chatToResponsesResponse(chat);
    expect(r.usage).toMatchObject({
      input_tokens: 4, output_tokens: 6, total_tokens: 10,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    });
  });
  it('chat usage 有 details 时透传并补齐 reasoning_tokens', () => {
    const chat = {
      id: 'resp_5', model: 'm',
      choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 4, completion_tokens: 6, total_tokens: 10,
        prompt_tokens_details: { cached_tokens: 2 },
        completion_tokens_details: { accepted_prediction_tokens: 5 },
      },
    } as any;
    const r = chatToResponsesResponse(chat);
    expect(r.usage.output_tokens_details).toMatchObject({ accepted_prediction_tokens: 5, reasoning_tokens: 0 });
    expect(r.usage.input_tokens_details).toMatchObject({ cached_tokens: 2 });
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
