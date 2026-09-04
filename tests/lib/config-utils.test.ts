import { describe, it, expect } from 'vitest';
import { isApiKeyRef, getApiKeyRefName, resolveApiKey, addApiKey, updateApiKey } from '../../src/config.js';
import type { ApiKey } from '../../src/config.js';

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

describe('addApiKey name uniqueness', () => {
  it('throws when adding a key with a duplicate name', () => {
    const existing = [
      { id: '1', name: 'my-key', key: 'sk-old', createdAt: 0, updatedAt: 0 },
    ];
    expect(() => addApiKey(existing, 'my-key', 'sk-new'))
      .toThrow('API Key name "my-key" already exists');
  });

  it('allows adding a key with a unique name', () => {
    const existing = [
      { id: '1', name: 'existing', key: 'sk-old', createdAt: 0, updatedAt: 0 },
    ];
    const result = addApiKey(existing, 'new-key', 'sk-new');
    expect(result.name).toBe('new-key');
    expect(result.key).toBe('sk-new');
  });
});

describe('updateApiKey name uniqueness', () => {
  it('throws when renaming to a duplicate name', () => {
    const existing = [
      { id: '1', name: 'key-one', key: 'sk-1', createdAt: 0, updatedAt: 0 },
      { id: '2', name: 'key-two', key: 'sk-2', createdAt: 0, updatedAt: 0 },
    ];
    expect(() => updateApiKey(existing, '1', { name: 'key-two' }))
      .toThrow('API Key name "key-two" already exists');
  });

  it('allows keeping the same name', () => {
    const existing = [
      { id: '1', name: 'key-one', key: 'sk-1', createdAt: 0, updatedAt: 0 },
      { id: '2', name: 'key-two', key: 'sk-2', createdAt: 0, updatedAt: 0 },
    ];
    const result = updateApiKey(existing, '1', { name: 'key-one' });
    expect(result[0].name).toBe('key-one');
  });

  it('allows renaming to a unique name', () => {
    const existing = [
      { id: '1', name: 'key-one', key: 'sk-1', createdAt: 0, updatedAt: 0 },
      { id: '2', name: 'key-two', key: 'sk-2', createdAt: 0, updatedAt: 0 },
    ];
    const result = updateApiKey(existing, '1', { name: 'key-one-v2' });
    expect(result[0].name).toBe('key-one-v2');
  });
});
