import { describe, it, expect } from 'vitest';
import { loadFullConfig, saveConfig } from '../src/config.js';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';

const TEST_CONFIG_PATH = '/tmp/test-uiSettings-config.json';

describe('UiSettings config', () => {
  afterEach(() => {
    if (existsSync(TEST_CONFIG_PATH)) {
      unlinkSync(TEST_CONFIG_PATH);
    }
  });

  it('should load config with uiSettings', () => {
    const config = {
      models: [],
      uiSettings: {
        enabled: true,
        announcementMarkdown: '# Hello'
      }
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));
    const loaded = loadFullConfig(TEST_CONFIG_PATH);
    expect(loaded.uiSettings?.enabled).toBe(true);
    expect(loaded.uiSettings?.announcementMarkdown).toBe('# Hello');
  });

  it('should save config with uiSettings', () => {
    const config = {
      models: [],
      uiSettings: {
        enabled: false,
        announcementMarkdown: ''
      }
    };
    saveConfig(config, TEST_CONFIG_PATH);
    const saved = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf-8'));
    expect(saved.uiSettings?.enabled).toBe(false);
    expect(saved.uiSettings?.announcementMarkdown).toBe('');
  });

  it('should handle missing uiSettings gracefully', () => {
    const config = { models: [] };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));
    const loaded = loadFullConfig(TEST_CONFIG_PATH);
    expect(loaded.uiSettings).toBeUndefined();
  });
});
