import { describe, it, expect } from 'vitest';
import { UserLayout } from '../../src/user/components/Layout.js';

describe('UserLayout inline script', () => {
  it('should have valid JavaScript in the inline script', () => {
    const html = String(
      <UserLayout title="Test">
        <div>test</div>
      </UserLayout>,
    );

    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (scriptMatch && scriptMatch[1].trim()) {
      expect(() => {
        new Function(scriptMatch[1]);
      }).not.toThrow();
    }
  });
});
