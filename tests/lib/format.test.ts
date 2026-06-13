import { describe, it, expect } from 'vitest';
import { formatNumber, formatDuration, formatPct } from '../../src/lib/format.js';

describe('formatNumber', () => {
  it('should return original value for numbers < 1000', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(500)).toBe('500');
    expect(formatNumber(999)).toBe('999');
  });

  it('should format thousands as K', () => {
    expect(formatNumber(1000)).toBe('1K');
    expect(formatNumber(1234)).toBe('1.2K');
    expect(formatNumber(10000)).toBe('10K');
    expect(formatNumber(234500)).toBe('234.5K');
  });

  it('should format millions as M', () => {
    expect(formatNumber(1_000_000)).toBe('1M');
    expect(formatNumber(1_500_000)).toBe('1.5M');
    expect(formatNumber(12_300_000)).toBe('12.3M');
  });

  it('should handle null and undefined', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('should format durations under 1000ms', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('should format durations over 1000ms as seconds', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(2300)).toBe('2.3s');
    expect(formatDuration(12100)).toBe('12.1s');
  });

  it('should handle null and undefined', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });
});

describe('formatPct', () => {
  it('should format percentages', () => {
    expect(formatPct(95, 100)).toBe('95.0%');
    expect(formatPct(1, 3)).toBe('33.3%');
    expect(formatPct(0, 100)).toBe('0.0%');
  });

  it('should handle zero total', () => {
    expect(formatPct(0, 0)).toBe('0%');
    expect(formatPct(100, 0)).toBe('0%');
  });
});
