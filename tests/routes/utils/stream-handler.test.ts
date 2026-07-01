import { describe, it, expect } from 'vitest';

describe('unified stream handler', () => {
  it('should export handleUnifiedStream function', async () => {
    const mod = await import('@/routes/utils/stream-handler');
    expect(typeof mod.handleUnifiedStream).toBe('function');
  });
});
