import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyPrivacyProtection } from '../../src/privacy/apply.js';
import type { PrivacySettings } from '../../src/privacy/types.js';

describe('applyPrivacyProtection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should do nothing when master switch is off', () => {
    const body = { messages: [], user: 'user-123', metadata: { x: 1 } };
    const settings: PrivacySettings = {
      enabled: false,
      stripUserField: true,
      sanitizeFilePaths: true,
      pathPlaceholder: '__USER__',
      whitelistFilter: true
    };
    const result = applyPrivacyProtection(body, settings, 'req-001');
    expect(result).toBe(body); // same reference
    expect(result).toHaveProperty('user');
    expect(result).toHaveProperty('metadata');
  });

  it('should apply whitelist filter when enabled', () => {
    const body = { messages: [], user: 'user-123', temperature: 0.7, metadata: { x: 1 } };
    const settings: PrivacySettings = {
      enabled: true,
      stripUserField: false,
      sanitizeFilePaths: false,
      pathPlaceholder: '__USER__',
      whitelistFilter: true
    };
    const result = applyPrivacyProtection(body, settings, 'req-001');
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('temperature');
    expect(result).not.toHaveProperty('user');
    expect(result).not.toHaveProperty('metadata');
  });

  it('should strip user field when enabled', () => {
    const body = { messages: [], user: 'user-123', temperature: 0.7 };
    const settings: PrivacySettings = {
      enabled: true,
      stripUserField: true,
      sanitizeFilePaths: false,
      pathPlaceholder: '__USER__',
      whitelistFilter: false
    };
    const result = applyPrivacyProtection(body, settings, 'req-001');
    expect(result).not.toHaveProperty('user');
    expect(result).toHaveProperty('messages');
  });

  it('should sanitize file paths when enabled', () => {
    const body = { messages: [{ role: 'user', content: 'Fix /home/zhangsan/app/main.py' }] };
    const settings: PrivacySettings = {
      enabled: true,
      stripUserField: false,
      sanitizeFilePaths: true,
      pathPlaceholder: '__USER__',
      whitelistFilter: false
    };
    const result = applyPrivacyProtection(body, settings, 'req-001');
    expect(result.messages[0].content).toBe('Fix /home/__USER__/app/main.py');
  });

  it('should apply all protections when all enabled', () => {
    const body = {
      messages: [{ role: 'user', content: 'Fix /home/zhangsan/app/main.py' }],
      user: 'user-123',
      temperature: 0.7,
      metadata: { x: 1 }
    };
    const settings: PrivacySettings = {
      enabled: true,
      stripUserField: true,
      sanitizeFilePaths: true,
      pathPlaceholder: '__USER__',
      whitelistFilter: true
    };
    const result = applyPrivacyProtection(body, settings, 'req-001');
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('temperature');
    expect(result).not.toHaveProperty('user');
    expect(result).not.toHaveProperty('metadata');
    expect(result.messages[0].content).toBe('Fix /home/__USER__/app/main.py');
  });
});
