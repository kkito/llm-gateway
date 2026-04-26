import { describe, it, expect } from 'vitest';
import { ModelsPage } from '../../src/admin/views/models.js';

describe('ModelsPage script tag', () => {
  it('should have valid JavaScript in the inline script', () => {
    const html = String(
      <ModelsPage
        models={[
          { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' },
        ]}
      />,
    );

    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    expect(scriptMatch).not.toBeNull();

    const scriptContent = scriptMatch![1];

    // 直接验证 JS 语法是否合法
    // 如果 TSX 中 \n 被错误写成实际换行，这里会立刻报错
    expect(() => {
      new Function(scriptContent);
    }).not.toThrow();
  });
});
