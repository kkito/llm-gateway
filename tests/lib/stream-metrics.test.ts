import { describe, it, expect } from 'vitest';
import { calcTps } from '../../src/lib/stream-metrics.js';

describe('calcTps', () => {
  it('calculates tok/s from completionTokens and window', () => {
    expect(calcTps(100, 5000, 1000)).toBe(25.0);
  });
  it('rounds to 1 decimal', () => {
    expect(calcTps(10, 3333, 1000)).toBe(4.3);
  });
  it('returns null when missing or invalid', () => {
    expect(calcTps(null as any, 5000, 1000)).toBeNull();
    expect(calcTps(10, 1000, 1000)).toBeNull();
    expect(calcTps(10, 800, 1000)).toBeNull();
    expect(calcTps(0 as any, 5000, 1000)).toBeNull();
  });
  it('returns null when any arg is null/undefined', () => {
    expect(calcTps(undefined as any, 5000, 1000)).toBeNull();
    expect(calcTps(10, null as any, 1000)).toBeNull();
    expect(calcTps(10, 5000, undefined as any)).toBeNull();
  });
  it('handles large values correctly', () => {
    // 1000 tokens in 10s after 1s ttft => 1000/9 ≈111.1
    expect(calcTps(1000, 10000, 1000)).toBe(111.1);
  });
});
