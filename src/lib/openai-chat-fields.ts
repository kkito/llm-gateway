/**
 * OpenAI Chat Completions 端点公认的请求字段白名单。
 *
 * 用于出站构建时收敛 canonical ChatRequest + provider defaultParams，
 * 避免把 Responses 保真字段（previous_response_id / instructions /
 * thinkingSignature 等）或 provider 自定义参数（thinking / reasoning_effort
 * 等）泄漏到 openai-compatible 端点导致 400。
 *
 * 不含 Responses 专属字段（previous_response_id / instructions / store /
 * include / prompt_cache_key 等），那些只在 response-api passthrough 路径合法。
 */
export const OPENAI_CHAT_FIELDS = new Set<string>([
  'model',
  'messages',
  'tools',
  'tool_choice',
  'max_tokens',
  'max_completion_tokens',
  'stream',
  'temperature',
  'top_p',
  'n',
  'stop',
  'presence_penalty',
  'frequency_penalty',
  'logit_bias',
  'user',
  'seed',
  'response_format',
  'stream_options',
  'logprobs',
  'top_logprobs',
  'parallel_tool_calls',
]);

/** 仅保留 OpenAI Chat Completions 端点识别的字段，其余丢弃。 */
export function filterOpenAIChatFields(body: any): any {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }
  const filtered: Record<string, any> = {};
  for (const key of Object.keys(body)) {
    if (OPENAI_CHAT_FIELDS.has(key)) {
      filtered[key] = body[key];
    }
  }
  return filtered;
}
