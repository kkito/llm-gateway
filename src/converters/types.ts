/**
 * Anthropic 和 OpenAI 共享类型定义
 *
 * 用于协议转换器的共享类型
 */

// ==================== Anthropic 类型 ====================

export interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  source?: {
    type: 'base64' | 'url';
    media_type: string;
    data: string;
  };
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: any;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant' | 'system';
  content?: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: any;
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: 'text'; text: string }>;
  tools?: AnthropicTool[];
  max_tokens: number;
  stream?: boolean;
  temperature?: number;
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: any;
  }>;
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence';
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// 流式响应事件
export interface AnthropicStreamEvent {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop';
  message?: AnthropicResponse;
  index?: number;
  content_block?: {
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: any;
  };
  delta?: {
    text?: string;
    type?: string;
    stop_reason?: string;
    stop_sequence?: string;
  };
  usage?: {
    output_tokens: number;
  };
}

// ==================== OpenAI 类型 ====================

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string };
  }> | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
}

export interface OpenAIResponse {
  id: string;
  object?: string;
  created?: number;
  model: string;
  choices: Array<{
    index?: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// 流式响应 delta
export interface OpenAIDelta {
  role?: string;
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface OpenAIChoice {
  index: number;
  delta: OpenAIDelta;
  finish_reason: string | null;
}

export interface OpenAIStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}