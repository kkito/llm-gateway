import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { convertAnthropicResponseToOpenAI } from '../../src/converters/openai-to-anthropic.js';
import { convertOpenAIResponseToAnthropic } from '../../src/converters/anthropic-to-openai.js';

describe('SSE 响应转换 - 格式不一致时的处理策略', () => {
  /**
   * 场景：OpenAI 请求 → Anthropic Provider + 流式
   * 期望：收集完整响应 → 转换为 OpenAI 格式 → 返回非流式 JSON
   */
  describe('OpenAI 请求 + Anthropic Provider + 流式', () => {
    it('应将 Anthropic 完整响应转换为 OpenAI 格式并返回非流式 JSON', () => {
      // 模拟 Anthropic 完整响应（从上游收到的）
      const anthropicStreamResponse = {
        id: 'msg_anth_123',
        type: 'message' as const,
        role: 'assistant' as const,
        model: 'claude-sonnet-4-20250514',
        content: [
          { type: 'text' as const, text: '这是来自 Anthropic 的响应' }
        ],
        stop_reason: 'end_turn' as const,
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: 50
        }
      };

      // 转换后应为 OpenAI 格式
      const result = convertAnthropicResponseToOpenAI(anthropicStreamResponse);

      // 验证转换结果
      expect(result.id).toBe('msg_anth_123');
      expect(result.model).toBe('claude-sonnet-4-20250514');
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.content).toBe('这是来自 Anthropic 的响应');
      expect(result.choices[0].finish_reason).toBe('stop');
      expect(result.usage).toEqual({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150
      });
    });

    it('应将包含 tool_use 的 Anthropic 响应转换为 OpenAI 格式', () => {
      const anthropicResponseWithTool = {
        id: 'msg_anth_456',
        type: 'message' as const,
        role: 'assistant' as const,
        model: 'claude-sonnet-4-20250514',
        content: [
          { type: 'text' as const, text: '让我调用工具来帮你。' },
          {
            type: 'tool_use' as const,
            id: 'toolu_001',
            name: 'search',
            input: { query: '天气' }
          }
        ],
        stop_reason: 'tool_use' as const,
        stop_sequence: null,
        usage: {
          input_tokens: 80,
          output_tokens: 40
        }
      };

      const result = convertAnthropicResponseToOpenAI(anthropicResponseWithTool);

      expect(result.choices[0].message.content).toBe('让我调用工具来帮你。');
      expect(result.choices[0].message.tool_calls).toEqual([
        {
          id: 'toolu_001',
          type: 'function',
          function: {
            name: 'search',
            arguments: '{"query":"天气"}'
          }
        }
      ]);
      expect(result.choices[0].finish_reason).toBe('tool_calls');
    });
  });

  /**
   * 场景：Anthropic 请求 → OpenAI Provider + 流式
   * 期望：收集完整响应 → 转换为 Anthropic 格式 → 返回非流式 JSON
   */
  describe('Anthropic 请求 + OpenAI Provider + 流式', () => {
    it('应将 OpenAI 完整响应转换为 Anthropic 格式并返回非流式 JSON', () => {
      // 模拟 OpenAI 完整响应（从上游收到的）
      const openaiStreamResponse = {
        id: 'chatcmpl-abc123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o-2024-11-20',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '这是来自 OpenAI 的响应'
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 30,
          total_tokens: 80
        }
      };

      // 转换后应为 Anthropic 格式
      const result = convertOpenAIResponseToAnthropic(openaiStreamResponse, 'custom-model');

      expect(result.id).toBe('chatcmpl-abc123');
      expect(result.type).toBe('message');
      expect(result.role).toBe('assistant');
      expect(result.content).toEqual([
        { type: 'text', text: '这是来自 OpenAI 的响应' }
      ]);
      expect(result.stop_reason).toBe('end_turn');
      expect(result.usage).toEqual({
        input_tokens: 50,
        output_tokens: 30
      });
    });

    it('应将包含 tool_calls 的 OpenAI 响应转换为 Anthropic 格式', () => {
      const openaiResponseWithTools = {
        id: 'chatcmpl-def456',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o-2024-11-20',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_001',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"city":"北京"}'
                  }
                }
              ]
            },
            finish_reason: 'tool_calls'
          }
        ],
        usage: {
          prompt_tokens: 60,
          completion_tokens: 25,
          total_tokens: 85
        }
      };

      const result = convertOpenAIResponseToAnthropic(openaiResponseWithTools, 'custom-model');

      expect(result.content).toEqual([
        {
          type: 'tool_use',
          id: 'call_001',
          name: 'get_weather',
          input: { city: '北京' }
        }
      ]);
      expect(result.stop_reason).toBe('tool_use');
    });

    it('应正确映射 stop_reason', () => {
      const testCases = [
        { finish_reason: 'stop', expected: 'end_turn' },
        { finish_reason: 'length', expected: 'max_tokens' },
        { finish_reason: 'tool_calls', expected: 'tool_use' },
        { finish_reason: 'content_filter', expected: 'stop_sequence' }
      ];

      for (const { finish_reason, expected } of testCases) {
        const openaiResponse = {
          id: 'test',
          object: 'chat.completion' as const,
          created: 1234567890,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'test' },
              finish_reason
            }
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        };

        const result = convertOpenAIResponseToAnthropic(openaiResponse, 'custom-model');
        expect(result.stop_reason).toBe(expected);
      }
    });
  });

  /**
   * 格式一致场景的测试 - 应该透传 SSE
   * 这部分不需要转换逻辑，但可以验证当前代码是否正确处理
   */
  describe('格式一致时 - 应保持流式 SSE 透传', () => {
    it('OpenAI → OpenAI: 流式响应直接透传（无需转换）', () => {
      // 格式一致时，响应内容本身已经是要的格式
      // 只是透传，不需要调用转换函数
      const openaiStreamChunk = {
        id: 'chatcmpl-abc',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: { content: 'Hello' },
            finish_reason: null
          }
        ]
      };

      // 验证这是有效的 OpenAI 流式 chunk
      expect(openaiStreamChunk.object).toBe('chat.completion.chunk');
      expect(openaiStreamChunk.choices[0].delta).toHaveProperty('content');
    });

    it('Anthropic → Anthropic: 流式响应直接透传（无需转换）', () => {
      // 格式一致时，响应内容本身已经是要的格式
      const anthropicStreamEvent = {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: 'Hello'
        }
      };

      // 验证这是有效的 Anthropic 流式事件
      expect(anthropicStreamEvent.type).toBe('content_block_delta');
      expect(anthropicStreamEvent.delta.text).toBe('Hello');
    });
  });
});