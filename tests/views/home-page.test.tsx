import { describe, it, expect } from 'vitest';
import { HomePage } from '../../src/user/views/home.js';

describe('HomePage inline script', () => {
  it('should have valid JavaScript in the inline script', () => {
    const html = String(
      <HomePage
        models={[]}
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
