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

describe('sanitizePaths and restorePaths — no trailing slash', () => {
  beforeEach(() => {
    clearPathMappings();
  });

  it('should sanitize paths without trailing slash (e.g. in system prompts)', () => {
    const body = { messages: [{ role: 'system', content: 'User home is /Users/alice' }] };
    sanitizePaths(body, '__USER__', 'req-ns');
    expect(body.messages[0].content).toBe('User home is /Users/__USER__');
  });

  it('should restore paths without trailing slash in reasoning_content', () => {
    const reqBody = { messages: [{ role: 'system', content: 'User home is /Users/zhangsan' }] };
    sanitizePaths(reqBody, '__USER__', 'req-ns');

    const resBody = { choices: [{ message: { reasoning_content: '用户目录是 /Users/__USER__。' } }] };
    restorePaths(resBody, 'req-ns');
    expect(resBody.choices[0].message.reasoning_content).toBe('用户目录是 /Users/zhangsan。');
  });

  it('should handle both trailing and non-trailing slash in same response', () => {
    const reqBody = { messages: [{ role: 'user', content: 'Fix /Users/lisi/app/main.py' }] };
    sanitizePaths(reqBody, '__USER__', 'req-mix');

    const resBody = { choices: [{ message: {
      reasoning_content: 'User home is /Users/__USER__',
      content: 'Fixed /Users/__USER__/app/main.py'
    }}]};
    restorePaths(resBody, 'req-mix');
    expect(resBody.choices[0].message.reasoning_content).toBe('User home is /Users/lisi');
    expect(resBody.choices[0].message.content).toBe('Fixed /Users/lisi/app/main.py');
  });

  it('should restore path placeholder that LLM generates from context', () => {
    // Simulates: request has /Users/kkito (no slash), LLM infers /Users/kktestuser,
    // and returns it in reasoning_content
    const reqBody = { messages: [{ role: 'system', content: 'Base dir: /Users/kkito' }] };
    sanitizePaths(reqBody, 'kktestuser', 'req-llm');

    const resBody = {
      choices: [{ message: {
        reasoning_content: '用户主目录在 macOS 上通常是 /Users/kktestuser。',
        tool_calls: [{ id: 'call_1', type: 'function', function: {
          name: 'write_file',
          arguments: '{"file_path": "/Users/kktestuser/hello2.txt", "content": "world"}'
        }}]
      }}]
    };
    restorePaths(resBody, 'req-llm');
    expect(resBody.choices[0].message.reasoning_content).toBe('用户主目录在 macOS 上通常是 /Users/kkito。');
    expect(resBody.choices[0].message.tool_calls[0].function.arguments).toBe('{"file_path": "/Users/kkito/hello2.txt", "content": "world"}');
  });

  it('should handle Linux home directory without trailing slash', () => {
    const reqBody = { messages: [{ role: 'system', content: 'Home: /home/zhangsan' }] };
    sanitizePaths(reqBody, '__USER__', 'req-linux');

    const resBody = { choices: [{ message: { reasoning_content: '目录是 /home/__USER__' } }] };
    restorePaths(resBody, 'req-linux');
    expect(resBody.choices[0].message.reasoning_content).toBe('目录是 /home/zhangsan');
  });
});
