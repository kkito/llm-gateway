/**
 * 流式转换共享类型定义
 * 从两个转换器中提取，避免重复定义
 */

/**
 * Anthropic 流式事件类型
 */
export interface AnthropicStreamEvent {
  type: 'message_start' | 'message_stop' | 'content_block_start' | 'content_block_stop' | 'content_block_delta' | 'message_delta' | 'ping' | 'error';
  message?: {
    id: string;
    type: string;
    role: string;
    model: string;
    content: any[];
    stop_reason: string | null;
    stop_sequence: string | null;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  index?: number;
  content_block?: {
    type: 'text' | 'tool_use' | 'thinking';
    text?: string;
    id?: string;
    name?: string;
    input?: any;
  };
  delta?: {
    type?: 'text_delta' | 'input_json_delta' | 'thinking_delta' | 'signature_delta';
    text?: string;
    partial_json?: string;
    thinking?: string;
    signature?: string;
    stop_reason?: string | null;
    stop_sequence?: string | null;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  error?: {
    type: string;
    message: string;
  };
}

/**
 * OpenAI 流式 chunk 类型
 */
export interface OpenAIStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type: 'function';
        function: {
          name?: string;
          arguments?: string;
        };
      }>;
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
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
}

/**
 * Anthropic → OpenAI 流式转换器状态
 */
export interface StreamConverterState {
  currentToolIndex: number;
  toolInputBuffers: Map<number, string>;
  toolIdMap: Map<number, string>;
  toolNameMap: Map<number, string>;
  hasSentToolCallStart: Map<number, boolean>;
}

/**
 * OpenAI → Anthropic 流式转换器状态
 */
export interface OpenAIToAnthropicStreamState {
  sentMessageStart: boolean;
  sentContentBlockStart: boolean;
  sentContentBlockFinish: boolean;
  currentContentBlockType: 'text' | 'tool_use' | 'thinking';
  currentContentBlockIndex: number;
  currentToolId: string | null;
  currentToolName: string | null;
  messageId: string;
}

/**
 * SSE 解析结果
 */
export interface SSEParseResult {
  event?: string;
  data: any;
}
