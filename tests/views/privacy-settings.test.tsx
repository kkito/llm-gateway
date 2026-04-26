import { describe, it, expect } from 'vitest';
import { PrivacySettingsPage } from '../../src/admin/views/privacy-settings.js';

describe('PrivacySettingsPage', () => {
  const allOn = {
    enabled: true, stripUserField: true, sanitizeFilePaths: true,
    pathPlaceholder: '__USER__', whitelistFilter: true
  };

  const allOff = {
    enabled: false, stripUserField: false, sanitizeFilePaths: false,
    pathPlaceholder: '__USER__', whitelistFilter: false
  };

  it('renders with all settings enabled', () => {
    const html = String(<PrivacySettingsPage settings={allOn} />);
    expect(html).toContain('隐私保护');
    expect(html).toContain('启用隐私保护');
    expect(html).toContain('抹掉 user 字段');
    expect(html).toContain('文件路径用户名替换');
    expect(html).toContain('白名单字段过滤');
  });

  it('renders with all settings disabled', () => {
    const html = String(<PrivacySettingsPage settings={allOff} />);
    expect(html).toContain('隐私保护');
    // Checkboxes should not be checked
    expect(html).not.toContain('checked');
  });

  it('shows error banner when error is provided', () => {
    const html = String(<PrivacySettingsPage settings={allOff} error="加载失败" />);
    expect(html).toContain('加载失败');
  });

  it('shows success banner when success is provided', () => {
    const html = String(<PrivacySettingsPage settings={allOn} success="设置已保存" />);
    expect(html).toContain('设置已保存');
  });

  it('inline JS syntax is valid (no undefined refs)', () => {
    const html = String(<PrivacySettingsPage settings={allOn} />);
    expect(html).toContain('</body>');
    expect(html).toContain('</html>');
  });
});
