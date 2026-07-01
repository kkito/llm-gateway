import { describe, it, expect, vi } from 'vitest';

// Minimal test: verify the module exports the expected function
describe('unified non-stream handler', () => {
  it('should export handleNonStream function', async () => {
    const mod = await import('@/routes/utils/non-stream-handler');
    expect(typeof mod.handleNonStream).toBe('function');
  });
});
