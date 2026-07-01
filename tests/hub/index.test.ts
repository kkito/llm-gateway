import { getAdapter, registerAdapter } from '@/hub/index';

describe('hub adapter registry', () => {
  it('should return openai-chat adapter for "openai-chat"', () => {
    const adapter = getAdapter('openai-chat');
    expect(adapter.formatName).toBe('openai-chat');
  });

  it('should return anthropic-messages adapter for "anthropic-messages"', () => {
    const adapter = getAdapter('anthropic-messages');
    expect(adapter.formatName).toBe('anthropic-messages');
  });

  it('should throw for unknown format', () => {
    expect(() => getAdapter('unknown')).toThrow('Unknown format: unknown');
  });

  it('should allow registering custom adapters', () => {
    const custom = { formatName: 'custom-test', isNativeProvider: () => false } as any;
    registerAdapter('custom-test', custom);
    expect(getAdapter('custom-test')).toBe(custom);
  });
});
