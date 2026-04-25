import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import type { ProxyConfig } from '../../src/config.js';

describe('Admin Model Management E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let originalFetch: typeof globalThis.fetch;

  const testConfig: ProxyConfig = {
    models: [
      { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key1', baseUrl: 'https://api.openai.com', provider: 'openai' },
      { customModel: 'claude', realModel: 'claude-3', apiKey: 'key2', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
    ],
    adminPassword: undefined,
    apiKeys: [],
  };

  beforeAll(() => {
    originalFetch = globalThis.fetch;
    testLogDir = join(tmpdir(), 'test-model-mgmt-' + Date.now());
    testConfigPath = join(testLogDir, 'config.json');
    mkdirSync(testLogDir, { recursive: true });
    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);
    app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    rmSync(testLogDir, { recursive: true, force: true });
  });

  describe('Model Copy', () => {
    it('should copy a model and redirect to edit page', async () => {
      const response = await app.request('/admin/models/copy/gpt-4', { method: 'POST' });
      expect(response.status).toBe(302);

      const location = response.headers.get('Location');
      expect(location).toContain('/admin/models/edit/gpt-4-');

      // 验证配置文件中模型数量变为 3
      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      expect(config.models.length).toBe(3);
      expect(config.models[0].customModel).toMatch(/^gpt-4-\d{13}$/);
      expect(config.models[0].hidden).toBe(false);
    });
  });

  describe('Model Hidden/Toggle', () => {
    it('should hide a model and move it to the end', async () => {
      const response = await app.request('/admin/models/toggle-hidden/gpt-4', { method: 'POST' });
      expect(response.status).toBe(302);

      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      const lastModel = config.models[config.models.length - 1];
      expect(lastModel.customModel).toBe('gpt-4');
      expect(lastModel.hidden).toBe(true);
    });

    it('should unhide a model and move it to first', async () => {
      const response = await app.request('/admin/models/toggle-hidden/gpt-4', { method: 'POST' });
      expect(response.status).toBe(302);

      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      const firstModel = config.models[0];
      expect(firstModel.customModel).toBe('gpt-4');
      expect(firstModel.hidden).toBe(false);
    });
  });
});
