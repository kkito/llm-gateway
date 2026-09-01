import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { VERSION } from '../../src/lib/version.js';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf-8'));

describe('VERSION (runtime)', () => {
  it('should equal package.json version', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('should be non-empty string matching semver', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION.length).toBeGreaterThan(0);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should require no build-time injection file', () => {
    // src/lib/version.ts must not be a hard-coded literal dump
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/lib/version.ts'), 'utf-8');
    expect(src).toContain("package.json");
    expect(src).not.toMatch(/export const VERSION = '1\./);
    expect(src).not.toContain('inject-version');
  });
});

describe('VERSION display in pages', () => {
  function makeConfig() {
    return {
      models: [
        { customModel: 'm-a', realModel: 'm-a', apiKey: 'sk-x', baseUrl: 'https://api.openai.com/v1', provider: 'openai' as const },
      ],
    };
  }

  it('HomePage (/user/main) contains v{VERSION}', async () => {
    const dir = join(tmpdir(), 'test-version-home-' + Date.now());
    mkdirSync(dir, { recursive: true });
    // 写一份测试 config.json 到临时目录，并作为 configDir 传入 createServer。
    // 不能依赖 isTestEnv（不传 configDir）：那会回退到真实的 ~/.llm-gateway，
    // 若该目录不存在（如 CI），loadFullConfig 会抛 "Config file not found" 导致 500。
    writeFileSync(join(dir, 'config.json'), JSON.stringify(makeConfig()));
    const logger = new Logger(dir);
    const detailLogger = new DetailLogger(dir);
    const app = createServer(makeConfig() as any, logger, detailLogger, 30000, dir);
    try {
      const res = await app.request('/user/main');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(`v${VERSION}`);
      expect(html).toContain(`v${pkg.version}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ModelsPage (/admin/models) contains v{VERSION}', async () => {
    const dir = join(tmpdir(), 'test-version-models-' + Date.now());
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify(makeConfig()));
    const logger = new Logger(dir);
    const detailLogger = new DetailLogger(dir);
    const app = createServer(makeConfig() as any, logger, detailLogger, 30000, dir);
    try {
      const res = await app.request('/admin/models');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(`v${VERSION}`);
      expect(html).toContain(`v${pkg.version}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
