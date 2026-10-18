import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { watchConfigFile, markSelfWrite, clearSelfWrite } from '../../src/lib/config-watcher.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('config-watcher', () => {
  const dir = join(tmpdir(), 'lgw-watcher-test-' + Date.now());
  const configPath = join(dir, 'config.json');

  const writeConfig = (name: string) => {
    writeFileSync(configPath, JSON.stringify({ models: [], apiKeys: [{ id: 'k1', name, key: 'sk-' + name, createdAt: 1, updatedAt: 1 }] }), 'utf-8');
  };

  beforeEach(() => {
    clearSelfWrite();
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeConfig('initial');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('外部改文件后触发 onConfigChange 并带上新配置', async () => {
    const seen: string[] = [];
    const stop = watchConfigFile(configPath, cfg => {
      seen.push(cfg.apiKeys?.[0]?.name ?? '');
    }, () => {});

    writeConfig('external');
    await wait(700);
    stop();

    expect(seen).toContain('external');
  });

  it('markSelfWrite 后短时间内的事件被忽略（saveConfig 自我触发）', async () => {
    const seen: string[] = [];
    const stop = watchConfigFile(configPath, () => seen.push('fired'), () => {});

    markSelfWrite();
    writeConfig('self-write');
    await wait(700);
    stop();

    expect(seen).toEqual([]);
  });

  it('无效 JSON 时保留旧配置、不抛异常，并打出警告', async () => {
    const warnings: string[] = [];
    let calls = 0;
    const stop = watchConfigFile(configPath, () => { calls++; }, msg => warnings.push(msg));

    writeFileSync(configPath, '{ not valid json', 'utf-8');
    await wait(700);
    stop();

    expect(calls).toBe(0);
    expect(warnings.some(w => w.includes('忽略'))).toBe(true);
  });

  it('stop() 后不再触发回调（watcher 已关闭）', async () => {
    let calls = 0;
    const stop = watchConfigFile(configPath, () => { calls++; }, () => {});
    stop();

    writeConfig('after-stop');
    await wait(700);

    expect(calls).toBe(0);
  });
});
