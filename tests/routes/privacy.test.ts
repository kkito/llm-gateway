import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPrivacyRoute } from '../../src/admin/routes/privacy.js';
import { loadFullConfig } from '../../src/config.js';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const testConfigPath = join(tmpdir(), 'llm-gateway-privacy-test.json');

const minimalConfig = {
  models: [],
  adminPassword: '',
  apiKeys: [],
  userApiKeys: []
};

describe('createPrivacyRoute', () => {
  let mockOnConfigChange: ReturnType<typeof import('vitest').vi.fn>;

  beforeEach(() => {
    mockOnConfigChange = vi.fn();
    // 写入初始配置
    writeFileSync(testConfigPath, JSON.stringify(minimalConfig));
  });

  afterEach(() => {
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
    vi.clearAllMocks();
  });

  it('GET /admin/privacy returns form with default settings when no privacySettings', async () => {
    const route = createPrivacyRoute({
      configPath: testConfigPath,
      onConfigChange: mockOnConfigChange,
    });

    const res = await route.request('/admin/privacy');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('隐私保护');
    expect(html).toContain('<form');
  });

  it('POST /admin/privacy saves settings and calls onConfigChange', async () => {
    const route = createPrivacyRoute({
      configPath: testConfigPath,
      onConfigChange: mockOnConfigChange,
    });

    const formData = new FormData();
    formData.set('enabled', 'on');
    formData.set('stripUserField', 'on');
    formData.set('sanitizeFilePaths', 'on');
    formData.set('pathPlaceholder', '__ANON__');
    formData.set('whitelistFilter', 'on');

    const res = await route.request('/admin/privacy', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('设置已保存');
    expect(mockOnConfigChange).toHaveBeenCalledTimes(1);

    // 验证配置已保存到文件
    const savedConfig = loadFullConfig(testConfigPath);
    expect(savedConfig.privacySettings).toEqual({
      enabled: true,
      stripUserField: true,
      sanitizeFilePaths: true,
      pathPlaceholder: '__ANON__',
      whitelistFilter: true,
    });
  });

  it('POST /admin/privacy handles unchecked checkboxes correctly', async () => {
    const route = createPrivacyRoute({
      configPath: testConfigPath,
      onConfigChange: mockOnConfigChange,
    });

    const formData = new FormData();
    // 所有复选框都未选中（值为 off）
    formData.set('enabled', 'off');
    formData.set('stripUserField', 'off');
    formData.set('sanitizeFilePaths', 'off');
    formData.set('whitelistFilter', 'off');

    const res = await route.request('/admin/privacy', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('设置已保存');

    const savedConfig = loadFullConfig(testConfigPath);
    expect(savedConfig.privacySettings).toEqual({
      enabled: false,
      stripUserField: false,
      sanitizeFilePaths: false,
      pathPlaceholder: '__USER__',
      whitelistFilter: false,
    });
  });

  it('POST /admin/privacy with empty pathPlaceholder uses default', async () => {
    const route = createPrivacyRoute({
      configPath: testConfigPath,
      onConfigChange: mockOnConfigChange,
    });

    const formData = new FormData();
    formData.set('enabled', 'on');
    formData.set('pathPlaceholder', ''); // 空值

    const res = await route.request('/admin/privacy', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(200);

    const savedConfig = loadFullConfig(testConfigPath);
    expect(savedConfig.privacySettings.pathPlaceholder).toBe('__USER__');
  });
});
