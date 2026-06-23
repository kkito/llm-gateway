import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, readFileSync } from 'fs';
import { SystemLogger } from '../../src/lib/system-logger.js';

const testDir = '/tmp/llm-gateway-test-system-logger';

describe('SystemLogger', () => {
  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });
    SystemLogger.resetInstance();
  });

  afterEach(() => {
    SystemLogger.resetInstance();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  it('init creates a singleton instance', () => {
    const logger = SystemLogger.init(testDir);
    expect(logger).toBe(SystemLogger.getInstance());
    expect(logger.isInitialized()).toBe(true);
  });

  it('getInstance returns null before init', () => {
    expect(SystemLogger.getInstance()).toBeNull();
  });

  it('resetInstance clears the singleton', () => {
    SystemLogger.init(testDir);
    expect(SystemLogger.getInstance()).not.toBeNull();
    SystemLogger.resetInstance();
    expect(SystemLogger.getInstance()).toBeNull();
  });

  it('logError writes JSON Lines entry to system log file', () => {
    const logger = SystemLogger.init(testDir);
    logger.logError('sse_parse_error', 'Unexpected token :', ': ping', {
      requestId: 'req-123',
      provider: 'openai',
    });

    const filePath = logger.getFilePath();
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8').trim();
    const entry = JSON.parse(content);

    expect(entry.level).toBe('error');
    expect(entry.category).toBe('sse_parse_error');
    expect(entry.message).toBe('Unexpected token :');
    expect(entry.rawData).toBe(': ping');
    expect(entry.requestId).toBe('req-123');
    expect(entry.provider).toBe('openai');
    expect(entry.timestamp).toBeTruthy();
  });

  it('logError works without context and rawData', () => {
    const logger = SystemLogger.init(testDir);
    logger.logError('response_parse_error', 'Failed to parse response body');

    const filePath = logger.getFilePath();
    const content = readFileSync(filePath, 'utf-8').trim();
    const entry = JSON.parse(content);

    expect(entry.category).toBe('response_parse_error');
    expect(entry.message).toBe('Failed to parse response body');
    expect(entry.rawData).toBeUndefined();
    expect(entry.requestId).toBeUndefined();
    expect(entry.provider).toBeUndefined();
  });

  it('truncates rawData to 500 characters', () => {
    const logger = SystemLogger.init(testDir);
    const longData = 'x'.repeat(1000);
    logger.logError('sse_parse_error', 'parse failed', longData);

    const content = readFileSync(logger.getFilePath(), 'utf-8').trim();
    const entry = JSON.parse(content);

    expect(entry.rawData.length).toBeLessThan(600);
    expect(entry.rawData).toContain('...(truncated)');
  });

  it('appends multiple entries to the same file', () => {
    const logger = SystemLogger.init(testDir);
    logger.logError('error1', 'first error');
    logger.logError('error2', 'second error');

    const lines = readFileSync(logger.getFilePath(), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);

    const entry1 = JSON.parse(lines[0]);
    const entry2 = JSON.parse(lines[1]);
    expect(entry1.message).toBe('first error');
    expect(entry2.message).toBe('second error');
  });

  it('does not throw when not initialized', () => {
    expect(() => {
      SystemLogger.getInstance()?.logError('test', 'should not throw');
    }).not.toThrow();
  });

  it('creates log directory if it does not exist', () => {
    const nestedDir = `${testDir}/nested/deep`;
    const logger = SystemLogger.init(nestedDir);
    logger.logError('test', 'dir creation');

    expect(existsSync(nestedDir)).toBe(true);
    expect(existsSync(logger.getFilePath())).toBe(true);
  });
});
