import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { Logger } from '../../src/logger.js';

const dir = '/tmp/llm-gateway-logger-ip-test';

describe('Logger client IP field', () => {
  beforeEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true });
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true }));

  it('writes clientIp into the proxy log line', () => {
    const logger = new Logger(dir, 'proxy.log');
    logger.log({
      timestamp: '2026-01-01T00:00:00.000Z',
      requestId: 'req-ip-1',
      customModel: 'm',
      endpoint: '/v1/chat/completions',
      method: 'POST',
      statusCode: 200,
      durationMs: 1,
      isStreaming: false,
      clientIp: '203.0.113.5',
    } as any);

    const line = JSON.parse(readFileSync(`${dir}/proxy.log`, 'utf-8').trim());
    expect(line.clientIp).toBe('203.0.113.5');
  });
});
