import { describe, it, expect } from 'vitest';
import { ModelGroupFormPage } from '../../src/admin/views/model-group-form.js';

describe('ModelGroupFormPage inline script', () => {
  it('should have valid JavaScript in the inline script', () => {
    const html = String(
      <ModelGroupFormPage
        models={[]}
        group={undefined}
        isEdit={false}
      />,
    );

    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (scriptMatch && scriptMatch[1].trim()) {
      expect(() => {
        new Function(scriptMatch[1]);
      }).not.toThrow();
    }
  });

  it('should have valid JavaScript in edit mode', () => {
    const html = String(
      <ModelGroupFormPage
        models={[]}
        group={{ name: 'test', models: [] }}
        isEdit={true}
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
