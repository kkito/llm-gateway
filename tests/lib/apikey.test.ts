import { describe, it, expect } from 'vitest';
import { generateUserApiKey, validateApiKeyFormat } from '../../src/lib/apikey';

describe('generateUserApiKey', () => {
  it('should generate API key with correct format', () => {
    const apiKey = generateUserApiKey();
    expect(apiKey).toMatch(/^sk-lg-[a-zA-Z0-9]{20}$/);
  });

  it('should generate unique keys', () => {
    const key1 = generateUserApiKey();
    const key2 = generateUserApiKey();
    expect(key1).not.toBe(key2);
  });

  it('should generate keys with correct length', () => {
    const apiKey = generateUserApiKey();
    expect(apiKey.length).toBe(26); // 'sk-lg-' (6) + 20 random chars
  });
});

describe('validateApiKeyFormat', () => {
  it('should validate correct format', () => {
    expect(validateApiKeyFormat('sk-lg-abcdefghij1234567890')).toBe(true);
  });

  it('should reject invalid prefix', () => {
    expect(validateApiKeyFormat('sk-abcdefghij1234567890')).toBe(false);
  });

  it('should reject incorrect length', () => {
    expect(validateApiKeyFormat('sk-lg-short')).toBe(false);
  });
});
