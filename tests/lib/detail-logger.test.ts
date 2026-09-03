import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DetailLogger } from '../../src/detail-logger.js';
import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('DetailLogger — 动态开关', () => {
  let dir: string;
  let logger: DetailLogger;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'detail-logger-test-'));
    logger = new DetailLogger(dir, false);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function fileCount(): number {
    return readdirSync(dir).length;
  }

  it('默认关闭时不写文件', () => {
    logger.logRequest('r1', { a: 1 });
    expect(fileCount()).toBe(0);
  });

  it('setEnabled(true) 后开始记录', () => {
    logger.setEnabled(true);
    logger.logRequest('r1', { a: 1 });
    expect(fileCount()).toBe(1);
  });

  it('setEnabled(false) 后停止记录', () => {
    logger.setEnabled(true);
    logger.logRequest('r1', { a: 1 });
    expect(fileCount()).toBe(1);
    logger.setEnabled(false);
    logger.logRequest('r2', { a: 2 });
    expect(fileCount()).toBe(1);
  });

  it('isEnabled 反映当前状态', () => {
    expect(logger.isEnabled()).toBe(false);
    logger.setEnabled(true);
    expect(logger.isEnabled()).toBe(true);
  });
});
