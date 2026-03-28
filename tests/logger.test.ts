import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Logger, LogEntry } from '../src/logger.js';
import { readFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('logger', () => {
  const testLogDir = join(tmpdir(), 'test-logs-' + Date.now());
  const testLogFile = join(testLogDir, 'test.log');

  beforeEach(() => {
    if (!existsSync(testLogDir)) {
      mkdirSync(testLogDir, { recursive: true });
    }
  });

  afterEach(() => {
    try {
      if (existsSync(testLogFile)) {
        unlinkSync(testLogFile);
      }
    } catch {}
  });

  it('should create logger instance', () => {
    const logger = new Logger(testLogDir, 'test.log');
    expect(logger).toBeDefined();
  });

  it('should log entry in JSON Lines format', () => {
    const logger = new Logger(testLogDir, 'test.log');
    
    const entry: LogEntry = {
      timestamp: '2026-03-21T10:00:00.000Z',
      requestId: 'uuid-123',
      customModel: 'my-gpt4',
      endpoint: '/v1/chat/completions',
      method: 'POST',
      statusCode: 200,
      durationMs: 1234,
      isStreaming: false
    };

    logger.log(entry);

    const content = readFileSync(testLogFile, 'utf-8');
    const logged = JSON.parse(content.trim());
    expect(logged.requestId).toBe('uuid-123');
    expect(logged.customModel).toBe('my-gpt4');
  });

  it('should append multiple entries', () => {
    const logger = new Logger(testLogDir, 'test.log');
    
    logger.log({
      timestamp: '2026-03-21T10:00:00.000Z',
      requestId: 'uuid-1',
      customModel: 'my-gpt4',
      endpoint: '/v1/chat/completions',
      method: 'POST',
      statusCode: 200,
      durationMs: 100,
      isStreaming: false
    });

    logger.log({
      timestamp: '2026-03-21T10:00:01.000Z',
      requestId: 'uuid-2',
      customModel: 'my-claude',
      endpoint: '/v1/messages',
      method: 'POST',
      statusCode: 200,
      durationMs: 200,
      isStreaming: true
    });

    const lines = readFileSync(testLogFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).requestId).toBe('uuid-1');
    expect(JSON.parse(lines[1]).requestId).toBe('uuid-2');
  });

  it('should create log directory if not exists', () => {
    const newDir = join(tmpdir(), 'new-test-logs-' + Date.now());
    try {
      const logger = new Logger(newDir, 'test.log');
      logger.log({
        timestamp: '2026-03-21T10:00:00.000Z',
        requestId: 'uuid-3',
        customModel: 'test',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        statusCode: 200,
        durationMs: 100,
        isStreaming: false
      });
      expect(existsSync(newDir)).toBe(true);
    } finally {
      try {
        unlinkSync(join(newDir, 'test.log'));
      } catch {}
    }
  });
});
