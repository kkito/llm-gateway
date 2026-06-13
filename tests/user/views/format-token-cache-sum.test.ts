import { describe, it, expect } from 'vitest';
import { formatTokenCacheSum } from '@/user/views/stats.js';

describe('formatTokenCacheSum', () => {
  it('prompt=null, cache=null → "—"', () => {
    expect(formatTokenCacheSum(null, null)).toBe('—');
  });

  it('prompt=null, cache=500 → "—"', () => {
    expect(formatTokenCacheSum(null, 500)).toBe('—');
  });

  it('prompt=100, cache=0 → 只显示总输入', () => {
    expect(formatTokenCacheSum(100, 0)).toBe('100');
  });

  it('prompt=100, cache=null → 只显示总输入', () => {
    expect(formatTokenCacheSum(100, null)).toBe('100');
  });

  it('prompt=69100, cache=2100 → "2.1K/69.1K"', () => {
    expect(formatTokenCacheSum(69100, 2100)).toBe('2.1K/69.1K');
  });

  it('prompt=1500, cache=0 → "1.5K"', () => {
    expect(formatTokenCacheSum(1500, 0)).toBe('1.5K');
  });
});
