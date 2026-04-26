import { describe, it, expect } from 'vitest';
import { ModelLimitsPage } from '../../src/admin/views/model-limits.js';

describe('ModelLimitsPage inline script', () => {
  it('should have valid JavaScript in the inline script', () => {
    const html = String(
      <ModelLimitsPage
        model={{ customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' }}
        limits={[]}
      />,
    );

    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (scriptMatch && scriptMatch[1].trim()) {
      expect(() => {
        new Function(scriptMatch[1]);
      }).not.toThrow();
    }
  });
});
