import { describe, it, expect } from 'vitest';
import { HomePage } from '../../../src/user/views/home.js';
import type { UiSettings } from '../../../src/config.js';

describe('HomePage Announcement', () => {
  const mockModels: any[] = [];
  const mockModelGroups: any[] = [];

  it('should not render announcement when disabled', () => {
    const uiSettings: UiSettings = { enabled: false, announcementMarkdown: '# Hello' };
    const html = String(<HomePage models={mockModels} modelGroups={mockModelGroups} uiSettings={uiSettings} />);
    expect(html).not.toContain('<div class="announcement-banner"');
  });

  it('should not render announcement when markdown is empty', () => {
    const uiSettings: UiSettings = { enabled: true, announcementMarkdown: '' };
    const html = String(<HomePage models={mockModels} modelGroups={mockModelGroups} uiSettings={uiSettings} />);
    // Even if enabled, empty content means no banner
    expect(html).not.toContain('<div class="announcement-banner"');
  });

  it('should render announcement when enabled and has content', () => {
    const uiSettings: UiSettings = { enabled: true, announcementMarkdown: '# Hello World' };
    const html = String(<HomePage models={mockModels} modelGroups={mockModelGroups} uiSettings={uiSettings} />);
    expect(html).toContain('<div class="announcement-banner"');
  });

  it('should render markdown content as HTML', () => {
    const uiSettings: UiSettings = { enabled: true, announcementMarkdown: '## Important Notice\n\nThis is a **test**.' };
    const html = String(<HomePage models={mockModels} modelGroups={mockModelGroups} uiSettings={uiSettings} />);
    expect(html).toContain('<h2');
    expect(html).toContain('Important Notice');
    expect(html).toContain('<strong>test</strong>');
  });

  it('should not render announcement when uiSettings is undefined', () => {
    const html = String(<HomePage models={mockModels} modelGroups={mockModelGroups} />);
    expect(html).not.toContain('<div class="announcement-banner"');
  });

  it('should not render announcement when enabled is undefined', () => {
    const uiSettings: UiSettings = { announcementMarkdown: '# Hello' };
    const html = String(<HomePage models={mockModels} modelGroups={mockModelGroups} uiSettings={uiSettings} />);
    expect(html).not.toContain('<div class="announcement-banner"');
  });
});
