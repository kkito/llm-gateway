import { describe, it, expect } from 'vitest';
import { JsonEditor } from '../../src/admin/components/JsonEditor.js';

describe('JsonEditor component', () => {
  it('should render with textarea and preview pre', () => {
    const html = String(<JsonEditor name="defaultParams" value="" />);
    expect(html).toContain('<textarea');
    expect(html).toContain('<pre');
  });

  it('should render format and clear buttons', () => {
    const html = String(<JsonEditor name="defaultParams" value="" />);
    expect(html).toContain('格式化');
    expect(html).toContain('清空');
  });

  it('should have valid inline JavaScript', () => {
    const html = String(<JsonEditor name="defaultParams" value="" />);
    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    expect(scriptMatch).not.toBeNull();
    expect(() => {
      new Function(scriptMatch![1]);
    }).not.toThrow();
  });

  it('should render initial value if provided', () => {
    const initialValue = JSON.stringify({ temperature: 0.7 }, null, 2);
    const html = String(<JsonEditor name="testParams" value={initialValue} />);
    expect(html).toContain('temperature');
    expect(html).toContain('0.7');
  });

  it('should include hidden input with correct name', () => {
    const html = String(<JsonEditor name="defaultParams" value="" />);
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="defaultParams"');
  });
});
