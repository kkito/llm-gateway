import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAnnouncementRoute } from '../../../src/admin/routes/announcement.js';
import { loadFullConfig } from '../../../src/config.js';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const testConfigPath = join(tmpdir(), 'llm-gateway-announcement-test.json');

const minimalConfig = {
  models: [],
  adminPassword: '',
  apiKeys: [],
  userApiKeys: []
};

describe('createAnnouncementRoute', () => {
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

  it('GET /admin/announcement returns page with default settings when no uiSettings', async () => {
    const route = createAnnouncementRoute({
      configPath: testConfigPath,
      onConfigChange: mockOnConfigChange,
    });

    const res = await route.request('/admin/announcement');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('公告管理');
    expect(html).toContain('编辑将在前台首页顶部显示的公告内容');
    expect(html).toContain('name="enabled"');
    expect(html).toContain('name="announcementMarkdown"');
  });

  it('GET /admin/announcement returns page with existing uiSettings', async () => {
    // 写入包含 uiSettings 的配置
    const configWithSettings = {
      ...minimalConfig,
      uiSettings: {
        enabled: true,
        announcementMarkdown: '# 现有公告'
      }
    };
    writeFileSync(testConfigPath, JSON.stringify(configWithSettings));

    const route = createAnnouncementRoute({
      configPath: testConfigPath,
      onConfigChange: mockOnConfigChange,
    });

    const res = await route.request('/admin/announcement');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('checked');
    expect(html).toContain('# 现有公告');
  });

  it('POST /admin/announcement saves settings and calls onConfigChange', async () => {
    const route = createAnnouncementRoute({
      configPath: testConfigPath,
      onConfigChange: mockOnConfigChange,
    });

    const formData = new FormData();
    formData.set('enabled', 'on');
    formData.set('announcementMarkdown', '# 新公告');

    const res = await route.request('/admin/announcement', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('设置已保存');
    expect(mockOnConfigChange).toHaveBeenCalledTimes(1);

    // 验证配置已保存到文件
    const savedConfig = loadFullConfig(testConfigPath);
    expect(savedConfig.uiSettings).toEqual({
      enabled: true,
      announcementMarkdown: '# 新公告'
    });
  });

  it('POST /admin/announcement handles unchecked enabled correctly', async () => {
    const route = createAnnouncementRoute({
      configPath: testConfigPath,
      onConfigChange: mockOnConfigChange,
    });

    const formData = new FormData();
    // enabled 未选中，所以不设置或设为 off
    formData.set('announcementMarkdown', '# 测试');

    const res = await route.request('/admin/announcement', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('设置已保存');

    const savedConfig = loadFullConfig(testConfigPath);
    expect(savedConfig.uiSettings.enabled).toBe(false);
  });

  it('POST /admin/announcement with empty announcementMarkdown uses default', async () => {
    const route = createAnnouncementRoute({
      configPath: testConfigPath,
      onConfigChange: mockOnConfigChange,
    });

    const formData = new FormData();
    formData.set('enabled', 'on');
    formData.set('announcementMarkdown', ''); // 空值

    const res = await route.request('/admin/announcement', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(200);

    const savedConfig = loadFullConfig(testConfigPath);
    expect(savedConfig.uiSettings.announcementMarkdown).toBe('');
  });

  it('GET /admin/announcement handles config load error', async () => {
    // 写入无效的 JSON 配置
    writeFileSync(testConfigPath, 'invalid json');

    const route = createAnnouncementRoute({
      configPath: testConfigPath,
      onConfigChange: mockOnConfigChange,
    });

    const res = await route.request('/admin/announcement');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('加载失败');
  });
});
