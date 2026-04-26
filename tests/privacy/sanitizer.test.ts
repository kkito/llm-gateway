import { describe, it, expect, beforeEach } from 'vitest';
import { sanitizePaths, restorePaths, sanitizeSSEChunk, clearPathMappings } from '../../src/privacy/sanitizer.js';

describe('sanitizePaths', () => {
  beforeEach(() => {
    clearPathMappings();
  });

  it('should replace Linux home directory usernames', () => {
    const body = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/app/src/main.py' }] };
    sanitizePaths(body, '__USER__', 'req-001');
    expect(body.messages[0].content).toBe('Fix /home/__USER__/app/src/main.py');
  });

  it('should replace macOS home directory usernames', () => {
    const body = { messages: [{ role: 'user', content: 'Check /Users/lisi/Documents/config.json' }] };
    sanitizePaths(body, '__USER__', 'req-001');
    expect(body.messages[0].content).toBe('Check /Users/__USER__/Documents/config.json');
  });

  it('should replace Windows home directory usernames', () => {
    const body = { messages: [{ role: 'user', content: 'Edit C:\\Users\\wang\\project\\main.ts' }] };
    sanitizePaths(body, '__USER__', 'req-001');
    expect(body.messages[0].content).toBe('Edit C:\\Users\\__USER__\\project\\main.ts');
  });

  it('should not modify body when no paths are present', () => {
    const body = { messages: [{ role: 'user', content: 'Hello world' }] };
    sanitizePaths(body, '__USER__', 'req-001');
    expect(body.messages[0].content).toBe('Hello world');
  });

  it('should handle nested objects in body', () => {
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Open /home/alice/file.txt' },
          { type: 'text', text: 'Also /home/bob/other.txt' }
        ]
      }]
    };
    sanitizePaths(body, '__USER__', 'req-001');
    expect(body.messages[0].content[0].text).toBe('Open /home/__USER__/file.txt');
    expect(body.messages[0].content[1].text).toBe('Also /home/__USER__/other.txt');
  });

  it('should handle empty body', () => {
    sanitizePaths({}, '__USER__', 'req-001');
    // Should not throw
  });
});

describe('restorePaths', () => {
  beforeEach(() => {
    clearPathMappings();
  });

  it('should reverse-replace placeholders in response body', () => {
    const reqBody = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/app/main.py' }] };
    sanitizePaths(reqBody, '__USER__', 'req-001');

    const resBody = { choices: [{ message: { content: 'The file /home/__USER__/app/main.py has been fixed.' } }] };
    restorePaths(resBody, 'req-001');
    expect(resBody.choices[0].message.content).toBe('The file /home/zhangsan/app/main.py has been fixed.');
  });

  it('should be no-op when no mapping exists for requestId', () => {
    const body = { choices: [{ message: { content: 'path /home/__USER__/x' } }] };
    restorePaths(body, 'nonexistent-req');
    expect(body.choices[0].message.content).toBe('path /home/__USER__/x');
  });

  it('should clear mapping after restore', () => {
    const reqBody = { messages: [{ role: 'user', content: '/home/zhangsan/x' }] };
    sanitizePaths(reqBody, '__USER__', 'req-001');
    restorePaths({}, 'req-001');

    const resBody = { choices: [{ message: { content: '/home/__USER__/y' } }] };
    restorePaths(resBody, 'req-001');
    // Second restore should be no-op (mapping cleared)
    expect(resBody.choices[0].message.content).toBe('/home/__USER__/y');
  });
});

describe('sanitizeSSEChunk', () => {
  beforeEach(() => {
    clearPathMappings();
  });

  it('should replace placeholders in SSE data lines', () => {
    const reqBody = { messages: [{ role: 'user', content: '/home/zhangsan/x' }] };
    sanitizePaths(reqBody, '__USER__', 'req-001');

    const sseLine = 'data: {"choices":[{"delta":{"content":"/home/__USER__/app/main.py"}}]}\n\n';
    const result = sanitizeSSEChunk(sseLine, 'req-001');
    expect(result).toContain('/home/zhangsan/app/main.py');
  });

  it('should be no-op when no mapping exists', () => {
    const sseLine = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n';
    const result = sanitizeSSEChunk(sseLine, 'req-001');
    expect(result).toBe(sseLine);
  });
});
