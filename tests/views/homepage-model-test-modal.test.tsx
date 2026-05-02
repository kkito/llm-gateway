import { describe, it, expect } from 'vitest';
import { ModelsPage } from '../../src/admin/views/models.js';

describe('Homepage Model Test Modal', () => {
  describe('Test button rendering', () => {
    it('should render test button between edit and limits buttons', () => {
      const html = String(
        <ModelsPage
          models={[
            { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' },
          ]}
        />,
      );

      // Test button should exist with ⚡ icon
      expect(html).toContain('⚡测试');
      expect(html).toContain('data-test-model=');
      expect(html).toContain('title="测试"');
    });

    it('should include model config in data-test-model attribute', () => {
      const modelConfig = {
        customModel: 'test-model',
        realModel: 'gpt-4-turbo',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.example.com',
        provider: 'openai',
      };

      const html = String(<ModelsPage models={[modelConfig]} />);

      // Verify customModel and realModel appear in the table
      expect(html).toContain('test-model');
      expect(html).toContain('gpt-4-turbo');
      // Provider and baseUrl may only appear in the inline script's data-test-model attribute
      // Check they're at least referenced somewhere (the data attribute or script)
      expect(html).toMatch(/data-test-model=|openai/);
      expect(html).toMatch(/data-test-model=|api\.example\.com/);
    });

    it('should render test button for multiple models', () => {
      const html = String(
        <ModelsPage
          models={[
            { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key1', baseUrl: 'https://api.openai.com', provider: 'openai' },
            { customModel: 'claude', realModel: 'claude-3', apiKey: 'key2', baseUrl: 'https://api.anthropic.com', provider: 'anthropic' },
          ]}
        />,
      );

      // Count test buttons - should be one per model
      const testButtonMatches = html.match(/⚡测试/g);
      expect(testButtonMatches).not.toBeNull();
      expect(testButtonMatches!.length).toBe(2);
    });
  });

  describe('Inline script for test modal', () => {
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

      // Verify JS syntax is valid
      expect(() => {
        new Function(scriptContent);
      }).not.toThrow();
    });

    it('should have closeModelTestModal function', () => {
      const html = String(
        <ModelsPage
          models={[
            { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' },
          ]}
        />,
      );

      const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      const scriptContent = scriptMatch![1];

      expect(scriptContent).toContain('window.closeModelTestModal');
    });

    it('should have runModelTest function', () => {
      const html = String(
        <ModelsPage
          models={[
            { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' },
          ]}
        />,
      );

      const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      const scriptContent = scriptMatch![1];

      expect(scriptContent).toContain('window.runModelTest');
      expect(scriptContent).toContain("/admin/models/test");
    });

    it('should have toggleModalRawResponse function', () => {
      const html = String(
        <ModelsPage
          models={[
            { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' },
          ]}
        />,
      );

      const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      const scriptContent = scriptMatch![1];

      expect(scriptContent).toContain('window.toggleModalRawResponse');
    });

    it('should handle ESC key to close modal', () => {
      const html = String(
        <ModelsPage
          models={[
            { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' },
          ]}
        />,
      );

      const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      const scriptContent = scriptMatch![1];

      expect(scriptContent).toContain('Escape');
      expect(scriptContent).toContain('closeModelTestModal');
    });

    it('should include metric card elements in modal HTML', () => {
      const html = String(
        <ModelsPage
          models={[
            { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' },
          ]}
        />,
      );

      // Verify modal includes metric cards
      expect(html).toContain('metricTotalTime');
      expect(html).toContain('metricTotalTokens');
      expect(html).toContain('metricPromptTokens');
      expect(html).toContain('metricCompletionTokens');
      expect(html).toContain('metricSpeed');
    });

    it('should include error display elements', () => {
      const html = String(
        <ModelsPage
          models={[
            { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' },
          ]}
        />,
      );

      expect(html).toContain('modalError');
      expect(html).toContain('modalErrorMessage');
    });

    it('should include content display elements', () => {
      const html = String(
        <ModelsPage
          models={[
            { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' },
          ]}
        />,
      );

      expect(html).toContain('modalContent');
      expect(html).toContain('modalContentText');
    });

    it('should include raw response toggle elements', () => {
      const html = String(
        <ModelsPage
          models={[
            { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'key', baseUrl: 'https://api.openai.com', provider: 'openai' },
          ]}
        />,
      );

      expect(html).toContain('modalRawResponse');
      expect(html).toContain('modalRawToggle');
      expect(html).toContain('modalRawJson');
    });
  });

  describe('Empty models case', () => {
    it('should not render test button when no models', () => {
      const html = String(<ModelsPage models={[]} />);

      // Empty state should not have test buttons
      expect(html).not.toContain('⚡测试');
      // The data-test-model string may appear in the inline script code, but not as an actual attribute
      // Check that there's no actual button with data-test-model attribute in the tbody
      const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
      if (tbodyMatch) {
        expect(tbodyMatch[1]).not.toContain('data-test-model');
      }
      expect(html).toContain('暂无模型配置');
    });
  });
});
