import type { FormatAdapter } from '@/hub/adapters/adapter.interface';

describe('FormatAdapter interface', () => {
  it('should be satisfiable as a type (compile-time check)', () => {
    const mockAdapter: FormatAdapter = {
      formatName: 'test',
      isNativeProvider: () => true,
      toHubRequest: async (body: any) => body,
      fromHubResponse: (body: any) => body,
      toStreamHubRequest: (body: any) => body,
      fromStreamHubResponse: (chunk: any) => [chunk],
      extractStreamUsage: () => null,
    };
    expect(mockAdapter.formatName).toBe('test');
  });
});
