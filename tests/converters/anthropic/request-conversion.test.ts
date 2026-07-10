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
  it('chat tool_calls -> anthropic tool_use', async () => {
    const chat = {
      model: 'claude',
      messages: [{
        role: 'assistant', content: null,
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'f', arguments: '{}' } }],
      }],
    } as any;
    const a = await chatToAnthropicRequest(chat);
    expect(a.messages[0].content[0].type).toBe('tool_use');
    expect(a.messages[0].content[0].name).toBe('f');
  });
});
