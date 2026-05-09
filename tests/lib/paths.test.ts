import { describe, it, expect } from 'vitest';
import {
  getConfigPathFromDir,
  getLogDirFromDir,
  getDetailLogDirFromDir,
  getPidFileFromDir,
} from '../../src/lib/paths.js';
import { join } from 'path';

describe('paths - *FromDir functions', () => {
  const testDir = '/my/work';

  it('getConfigPathFromDir returns config.json in dir', () => {
    expect(getConfigPathFromDir(testDir)).toBe(join(testDir, 'config.json'));
  });

  it('getLogDirFromDir returns logs/proxy in dir', () => {
    expect(getLogDirFromDir(testDir)).toBe(join(testDir, 'logs', 'proxy'));
  });

  it('getDetailLogDirFromDir returns logs in dir', () => {
    expect(getDetailLogDirFromDir(testDir)).toBe(join(testDir, 'logs'));
  });

  it('getPidFileFromDir returns llm-gateway.pid in dir', () => {
    expect(getPidFileFromDir(testDir)).toBe(join(testDir, 'llm-gateway.pid'));
  });
});
