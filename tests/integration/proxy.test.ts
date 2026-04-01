import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import type { ProviderConfig, ProxyConfig } from '../../src/config.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import { createServer } from '../../src/server.js';
import { tmpdir } from 'os';
import { join } from 'path';

describe('proxy integration', () => {
  let app: Hono;
  let testLogDir: string;

  const testModels: ProviderConfig[] = [
    {
      customModel: 'test-gpt4',
      realModel: 'gpt-4',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com',
      provider: 'openai'
    }
  ];

  const testConfig: ProxyConfig = {
    models: testModels
  };

  beforeAll(() => {
    testLogDir = join(tmpdir(), 'test-integration-logs-' + Date.now());
    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);
    app = createServer(testConfig, logger, detailLogger, 30000);
  });

  it('should return 404 for unknown model', async () => {
    const response = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'unknown-model', messages: [] })
    });

    expect(response.status).toBe(404);
    const json = await response.json() as any;
    expect(json.error.message).toBe('Model not found');
  });

  it('should return health check', async () => {
    const response = await app.request('/health');
    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.status).toBe('ok');
  });

  it('should return CORS headers', async () => {
    const response = await app.request('/health', {
      headers: { 'Origin': 'http://localhost:3000' }
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});
