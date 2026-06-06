import { describe, it, expect } from 'vitest';
import { isApiKeyRef, getApiKeyRefName, resolveApiKey } from '../config.js';
import type { ApiKey } from '../config.js';

describe('isApiKeyRef', () => {
  it('returns true for $$name$$ format', () => {
    expect(isApiKeyRef('$$my-key$$')).toBe(true);
  });

  it('returns false for literal key', () => {
    expect(isApiKeyRef('sk-abc123')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isApiKeyRef('')).toBe(false);
  });
});

describe('getApiKeyRefName', () => {
  it('extracts name from $$name$$', () => {
    expect(getApiKeyRefName('$$my-key$$')).toBe('my-key');
  });

  it('returns null for literal key', () => {
    expect(getApiKeyRefName('sk-abc123')).toBeNull();
  });
});

describe('resolveApiKey', () => {
  const apiKeys: ApiKey[] = [
    { id: '1', name: 'openai-main', key: 'sk-real-1', createdAt: 0, updatedAt: 0 },
    { id: '2', name: 'anthropic-main', key: 'sk-ant-real-2', createdAt: 0, updatedAt: 0 },
  ];

  it('resolves $$name$$ to actual key', () => {
    expect(resolveApiKey('$$openai-main$$', apiKeys)).toBe('sk-real-1');
  });

  it('returns literal key unchanged', () => {
    expect(resolveApiKey('sk-abc123', apiKeys)).toBe('sk-abc123');
  });

  it('returns empty string unchanged', () => {
    expect(resolveApiKey('', apiKeys)).toBe('');
  });

  it('throws when reference name not found', () => {
    expect(() => resolveApiKey('$$nonexistent$$', apiKeys))
      .toThrow('API Key reference $$nonexistent$$ not found in saved API keys');
  });
});
