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
