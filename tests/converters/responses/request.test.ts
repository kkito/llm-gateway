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
    expect(chat.messages[0].role).toBe('system');
    expect(chat.messages[0].content).toBe('sys');
    expect(chat.messages[1].role).toBe('user');
    expect(chat.messages[1].content).toBe('hi');
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
    expect(r.input[0].content).toBe('hi');
  });
});
