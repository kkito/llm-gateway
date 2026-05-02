import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sanitizePaths, restorePaths, sanitizeSSEChunk, clearPathMappings, clearStreamBufferState, clearAllStreamBufferStates } from '../../src/privacy/sanitizer.js';

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
    clearAllStreamBufferStates();
  });

  afterEach(() => {
    clearStreamBufferState('req-001');
  });

  it('should replace placeholders in SSE data lines', () => {
    const reqBody = { messages: [{ role: 'user', content: '/home/zhangsan/x' }] };
    sanitizePaths(reqBody, '__USER__', 'req-001');

    const sseLine = 'data: {"choices":[{"delta":{"content":"/home/__USER__/app/main.py"}}]}\n\n';
    const result = sanitizeSSEChunk(sseLine, 'req-001');
    expect(result.output).toContain('/home/zhangsan/app/main.py');
    expect(result.buffered).toBe(false);
  });

  it('should be no-op when no mapping exists', () => {
    const sseLine = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n';
    const result = sanitizeSSEChunk(sseLine, 'req-001');
    expect(result.output).toBe(sseLine);
    expect(result.buffered).toBe(false);
  });

  it('should be no-op when no placeholder in chunk', () => {
    const reqBody = { messages: [{ role: 'user', content: '/home/zhangsan/x' }] };
    sanitizePaths(reqBody, '__USER__', 'req-001');

    const sseLine = 'data: {"choices":[{"delta":{"content":"hello world"}}]}\n\n';
    const result = sanitizeSSEChunk(sseLine, 'req-001');
    expect(result.output).toBe(sseLine);
    expect(result.buffered).toBe(false);
  });
});

describe('sanitizeSSEChunk cross-chunk truncation', () => {
  beforeEach(() => {
    clearPathMappings();
    clearAllStreamBufferStates();
  });

  afterEach(() => {
    clearStreamBufferState('req-001');
  });

  function setupMapping() {
    const reqBody = { messages: [{ role: 'user', content: '/home/zhangsan/app/main.py' }] };
    sanitizePaths(reqBody, '__USER__', 'req-001');
  }

  it('should buffer when placeholder is truncated at start', () => {
    setupMapping();

    // Chunk 1: truncated at beginning of placeholder
    const chunk1 = 'data: {"choices":[{"delta":{"content":"The file /home/__';
    const result1 = sanitizeSSEChunk(chunk1, 'req-001');
    expect(result1.buffered).toBe(true);
    expect(result1.output).toBe('');

    // Chunk 2: rest of placeholder
    const chunk2 = 'USER__/app/main.py"}}]}\n\n';
    const result2 = sanitizeSSEChunk(chunk2, 'req-001');
    expect(result2.buffered).toBe(false);
    expect(result2.output).toContain('/home/zhangsan/app/main.py');
  });

  it('should buffer when placeholder is truncated in middle', () => {
    setupMapping();

    const chunk1 = 'data: {"choices":[{"delta":{"content":"/home/__';
    const result1 = sanitizeSSEChunk(chunk1, 'req-001');
    expect(result1.buffered).toBe(true);

    const chunk2 = 'USER__';
    const result2 = sanitizeSSEChunk(chunk2, 'req-001');
    expect(result2.buffered).toBe(true);

    const chunk3 = '/app/main.py"}}]}\n\n';
    const result3 = sanitizeSSEChunk(chunk3, 'req-001');
    expect(result3.buffered).toBe(false);
    expect(result3.output).toContain('/home/zhangsan/app/main.py');
  });

  it('should buffer when placeholder is truncated at end', () => {
    setupMapping();

    // The full placeholder is `/home/__USER__/` (16 chars)
    // `/home/__USER__` is a prefix of the placeholder, so it will buffer
    const chunk1 = 'data: {"choices":[{"delta":{"content":"/home/__USER__';
    const result1 = sanitizeSSEChunk(chunk1, 'req-001');
    expect(result1.buffered).toBe(true);
    expect(result1.output).toBe('');

    // Next chunk completes it
    const chunk2 = '/app/main.py"}}]}\n\n';
    const result2 = sanitizeSSEChunk(chunk2, 'req-001');
    expect(result2.buffered).toBe(false);
    expect(result2.output).toContain('/home/zhangsan/app/main.py');
  });

  it('should flush buffer when prefix is no longer compatible', () => {
    setupMapping();

    // Truncated placeholder prefix
    const chunk1 = 'data: {"choices":[{"delta":{"content":"/home/__';
    const result1 = sanitizeSSEChunk(chunk1, 'req-001');
    expect(result1.buffered).toBe(true);

    // Next chunk breaks the placeholder pattern
    const chunk2 = 'something_else"}}]}\n\n';
    const result2 = sanitizeSSEChunk(chunk2, 'req-001');
    expect(result2.buffered).toBe(false);
    // Should flush the combined content without replacement
    expect(result2.output).toBe('data: {"choices":[{"delta":{"content":"/home/__something_else"}}]}\n\n');
  });

  it('should handle false positive — partial match but not placeholder prefix', () => {
    setupMapping();

    // '/home' appears in the placeholder but this is not a truncation
    const chunk1 = 'data: {"choices":[{"delta":{"content":"/home is nice"}}]}\n\n';
    const result1 = sanitizeSSEChunk(chunk1, 'req-001');
    expect(result1.buffered).toBe(false);
    expect(result1.output).toBe(chunk1);
  });

  it('should handle empty chunk', () => {
    setupMapping();

    const result = sanitizeSSEChunk('', 'req-001');
    expect(result.output).toBe('');
    expect(result.buffered).toBe(false);
  });

  it('should handle stream end with buffered content', () => {
    setupMapping();

    const chunk1 = 'data: {"choices":[{"delta":{"content":"/home/__';
    const result1 = sanitizeSSEChunk(chunk1, 'req-001');
    expect(result1.buffered).toBe(true);

    // Stream ends without completing the placeholder
    // The buffered content should be returned on next call with incompatible content
    const chunk2 = 'end_of_stream';
    const result2 = sanitizeSSEChunk(chunk2, 'req-001');
    expect(result2.buffered).toBe(false);
    // Should flush without replacement (no valid placeholder)
    expect(result2.output).toBe('data: {"choices":[{"delta":{"content":"/home/__end_of_stream');
  });
});
