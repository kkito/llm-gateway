import { describe, it, expect } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai.js';
import { AnthropicProvider } from '../../src/providers/anthropic.js';
import type { ProviderConfig } from '../../src/config.js';

describe('buildUrl - 智能路径拼接', () => {
  describe('OpenAI Provider', () => {
    const provider = new OpenAIProvider();

    it('应该正确处理标准 baseUrl (无末尾斜杠，无版本路径)', () => {
      const config: ProviderConfig = {
        customModel: 'test',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        provider: 'openai'
      };
      const url = provider.buildUrl(config, 'chat');
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('应该正确处理带末尾斜杠的 baseUrl', () => {
      const config: ProviderConfig = {
        customModel: 'test',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/',
        provider: 'openai'
      };
      const url = provider.buildUrl(config, 'chat');
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('应该正确处理带版本路径的 baseUrl (无末尾斜杠)', () => {
      const config: ProviderConfig = {
        customModel: 'test',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai'
      };
      const url = provider.buildUrl(config, 'chat');
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('应该正确处理带版本路径的 baseUrl (有末尾斜杠)', () => {
      const config: ProviderConfig = {
        customModel: 'test',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1/',
        provider: 'openai'
      };
      const url = provider.buildUrl(config, 'chat');
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('应该正确处理多个末尾斜杠的 baseUrl', () => {
      const config: ProviderConfig = {
        customModel: 'test',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com///',
        provider: 'openai'
      };
      const url = provider.buildUrl(config, 'chat');
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('应该正确处理带自定义路径的 baseUrl', () => {
      const config: ProviderConfig = {
        customModel: 'test',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://custom.ai/api',
        provider: 'openai'
      };
      const url = provider.buildUrl(config, 'chat');
      expect(url).toBe('https://custom.ai/api/v1/chat/completions');
    });

    it('应该正确处理带自定义路径和末尾斜杠的 baseUrl', () => {
      const config: ProviderConfig = {
        customModel: 'test',
        realModel: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://custom.ai/api/',
        provider: 'openai'
      };
      const url = provider.buildUrl(config, 'chat');
      expect(url).toBe('https://custom.ai/api/v1/chat/completions');
    });

    it('应该正确处理 completions endpoint', () => {
      const config: ProviderConfig = {
        customModel: 'test',
        realModel: 'gpt-3.5',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1/',
        provider: 'openai'
      };
      const url = provider.buildUrl(config, 'complete');
      expect(url).toBe('https://api.openai.com/v1/completions');
    });

    it('应该正确处理 embeddings endpoint', () => {
      const config: ProviderConfig = {
        customModel: 'test',
        realModel: 'text-embedding',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1/',
        provider: 'openai'
      };
      const url = provider.buildUrl(config, 'embed');
      expect(url).toBe('https://api.openai.com/v1/embeddings');
    });
  });

  describe('Anthropic Provider', () => {
    const provider = new AnthropicProvider();

    it('应该正确处理标准 baseUrl', () => {
      const config: ProviderConfig = {
        customModel: 'test',
        realModel: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test',
        baseUrl: 'https://api.anthropic.com',
        provider: 'anthropic'
      };
      const url = provider.buildUrl(config, 'chat');
      expect(url).toBe('https://api.anthropic.com/v1/messages');
    });

    it('应该正确处理带末尾斜杠的 baseUrl', () => {
      const config: ProviderConfig = {
        customModel: 'test',
        realModel: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test',
        baseUrl: 'https://api.anthropic.com/',
        provider: 'anthropic'
      };
      const url = provider.buildUrl(config, 'chat');
      expect(url).toBe('https://api.anthropic.com/v1/messages');
    });

    it('应该正确处理带版本路径的 baseUrl (无末尾斜杠)', () => {
      const config: ProviderConfig = {
        customModel: 'test',
        realModel: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test',
        baseUrl: 'https://api.anthropic.com/v1',
        provider: 'anthropic'
      };
      const url = provider.buildUrl(config, 'chat');
      expect(url).toBe('https://api.anthropic.com/v1/messages');
    });

    it('应该正确处理带版本路径的 baseUrl (有末尾斜杠)', () => {
      const config: ProviderConfig = {
        customModel: 'test',
        realModel: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test',
        baseUrl: 'https://api.anthropic.com/v1/',
        provider: 'anthropic'
      };
      const url = provider.buildUrl(config, 'chat');
      expect(url).toBe('https://api.anthropic.com/v1/messages');
    });

    it('应该正确处理自定义路径的 baseUrl', () => {
      const config: ProviderConfig = {
        customModel: 'test',
        realModel: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test',
        baseUrl: 'https://proxy.example.com/anthropic',
        provider: 'anthropic'
      };
      const url = provider.buildUrl(config, 'chat');
      expect(url).toBe('https://proxy.example.com/anthropic/v1/messages');
    });
  });
});
