// src/converters/canonical/types.ts
/**
 * 统一内部格式（canonical）—— 以 OpenAI Chat 为基准。
 * 所有格式在转换时都先归一到本文件类型，再发射到目标格式。
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatRole;
  content: string | ChatContentPart[] | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  /** 思考过程（Qwen/DeepSeek reasoning_content、OpenRouter reasoning、o1 reasoning_details 的统一落点） */
  reasoning?: string;
  /** [FIDELITY-SLOT] 来源 Anthropic thinking.signature，保真短接时携带，默认 undefined */
  thinkingSignature?: string;
}

export interface ChatTool {
  type: 'function';
  function: { name: string; description: string; parameters: any };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  tool_choice?: any;
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
  stream_options?: { include_reasoning: boolean };
  /** [FIDELITY-SLOT] 来源 Responses previous_response_id，多轮对话延续 */
  previousResponseId?: string;
  /** [FIDELITY-SLOT] 来源 Responses instructions，落地前的系统提示；provider 不支持时并入 system */
  responseInstructions?: string;
}

export interface ChatResponse {
  id: string;
  object?: string;
  created?: number;
  model: string;
  choices: Array<{
    index?: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: ChatToolCall[];
      reasoning?: string;
      thinkingSignature?: string;
    };
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /** [FIDELITY-SLOT] 来源 Responses include: reasoning.encrypted_content，保真短接携带 */
  responsesEncryptedContent?: string;
}

/** 复用现有 OpenAI 流式 chunk 作为 canonical 流式格式 */
export interface ChatStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{ index: number; id?: string; type: 'function'; function: { name?: string; arguments?: string } }>;
      reasoning_content?: string | null;
      reasoning?: string | null;
      reasoning_details?: Array<{ text: string }>;
      refusal?: string | null;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}
