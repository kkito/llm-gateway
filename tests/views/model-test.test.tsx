import { describe, it, expect } from 'vitest';
import { ModelTest } from '../../src/admin/views/model-test.js';

describe('ModelTest component', () => {
  it('should render a details section with test form elements', () => {
    const html = String(<ModelTest />);

    expect(html).toContain('<details');
    expect(html).toContain('测试模型配置');
    expect(html).toContain('id="testMessage"');
    expect(html).toContain('请介绍一下你自己');
    expect(html).toContain('id="testBtn"');
    expect(html).toContain('发送测试请求');
    expect(html).toContain('id="testLoading"');
    expect(html).toContain('id="testResult"');
    expect(html).toContain('id="testResultContent"');
    expect(html).toContain('id="testResultModel"');
    expect(html).toContain('id="testResultUsage"');
    expect(html).toContain('id="testError"');
    expect(html).toContain('id="testErrorMessage"');
    expect(html).toContain('id="testRawResponse"');
    expect(html).toContain('id="rawResponseSection"');
  });

  it('should have onclick="runTest()" on the test button', () => {
    const html = String(<ModelTest />);
    expect(html).toContain('onclick="runTest()"');
  });

  it('should have valid JavaScript in the inline script', () => {
    const html = String(<ModelTest />);
    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    expect(scriptMatch).not.toBeNull();

    const scriptContent = scriptMatch![1];
    expect(() => {
      new Function(scriptContent);
    }).not.toThrow();
  });

  it('should have runTest and toggleRawResponse functions in the script', () => {
    const html = String(<ModelTest />);
    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    const scriptContent = scriptMatch![1];

    expect(scriptContent).toContain('window.runTest =');
    expect(scriptContent).toContain('window.toggleRawResponse =');
  });

  it('should send apiKeyId when API key dropdown is selected', () => {
    const html = String(<ModelTest />);
    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    const scriptContent = scriptMatch![1];

    // Verify the script reads apiKeySource and handles both apiKey and apiKeyId
    expect(scriptContent).toContain('apiKeySource');
    expect(scriptContent).toContain('apiKeyId');
    expect(scriptContent).toContain("apiKeySource.value !== 'manual'");
  });

  it('should use a toggle link instead of nested details for raw response', () => {
    const html = String(<ModelTest />);

    // Should NOT have nested details inside error section
    expect(html).not.toMatch(/<div id="testError"[\s\S]*?<details[\s\S]*?id="testRawResponse"/);

    // Should have rawResponseSection div and toggle link
    expect(html).toContain('id="rawResponseSection"');
    expect(html).toContain('toggleRawResponse');
  });
});
