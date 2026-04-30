import { describe, it, expect } from 'vitest';
import { AnnouncementPage } from '../../../src/admin/views/announcement.js';
import type { UiSettings } from '../../../src/config.js';

describe('AnnouncementPage', () => {
  it('should render with empty settings', () => {
    const html = String(<AnnouncementPage />);
    expect(html).toContain('公告管理');
    expect(html).toContain('编辑将在前台首页顶部显示的公告内容');
    expect(html).toContain('name="enabled"');
    expect(html).toContain('name="announcementMarkdown"');
    // 空设置时不显示预览区域
    expect(html).not.toContain('id="preview-content"');
  });

  it('should render with existing settings (enabled, announcementMarkdown)', () => {
    const settings: UiSettings = {
      enabled: true,
      announcementMarkdown: '# 测试公告',
    };
    const html = String(<AnnouncementPage settings={settings} />);
    // 复选框已选中
    expect(html).toContain('name="enabled" checked');
    // 包含公告内容
    expect(html).toContain('# 测试公告');
    // 显示预览区域
    expect(html).toContain('预览');
    expect(html).toContain('id="preview-content"');
    // 包含 marked CDN 脚本
    expect(html).toContain('cdn.jsdelivr.net/npm/marked/marked.min.js');
  });

  it('should render success message', () => {
    const html = String(<AnnouncementPage success="保存成功" />);
    expect(html).toContain('保存成功');
    expect(html).toContain('alert success');
  });

  it('should render error message', () => {
    const html = String(<AnnouncementPage error="保存失败" />);
    expect(html).toContain('保存失败');
    expect(html).toContain('alert error');
  });

  it('should have valid JavaScript in the preview inline script', () => {
    const settings: UiSettings = {
      enabled: true,
      announcementMarkdown: '# 测试',
    };
    const html = String(<AnnouncementPage settings={settings} />);
    const scriptMatches = html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g);
    const scripts = Array.from(scriptMatches).map(m => m[1]);
    // 找到预览用的内联脚本（包含 marked.parse 调用）
    const previewScript = scripts.find(s => s.includes('marked.parse'));
    expect(previewScript).toBeDefined();
    // 验证脚本语法合法
    expect(() => new Function(previewScript!)).not.toThrow();
  });
});
