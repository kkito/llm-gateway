/**
 * Format adapter for a specific external API format.
 *
 * Each adapter knows how to convert between its format and the
 * internal hub format (OpenAI Chat Completions).
 */
export interface FormatAdapter {
  /** Human-readable format name for logging (e.g., 'openai-chat', 'anthropic-messages') */
  readonly formatName: string;

  /**
   * Whether this format's natural upstream provider type matches
   * without conversion. When true, upstream request passes through
   * without format conversion.
   */
  isNativeProvider(providerType: string): boolean;

  // ── Non-streaming ──────────────────────────────────────────

  /**
   * Convert an incoming request body from this format into
   * the hub (Chat Completions) format.
   */
  toHubRequest(body: any): Promise<any>;

  /**
   * Convert a hub (Chat Completions) response body into
   * this format's response body.
   */
  fromHubResponse(body: any, model: string): any;

  // ── Streaming ──────────────────────────────────────────────

  /**
   * Convert an incoming streaming request body into the hub format.
   */
  toStreamHubRequest(body: any): any;

  /**
   * Convert a single hub SSE chunk string (e.g., `data: {...}\n\n`)
   * into an array of SSE chunk strings in this format's streaming event format.
   *
   * When the adapter is native (isNativeProvider=true), returns the
   * input unchanged (identity transform).
   */
  fromStreamHubResponse(
    sseChunk: string,
    state?: any
  ): string[];

  /**
   * Extract final usage from an array of SSE chunk strings.
   * Called at stream end for logging and rate limiting.
   */
  extractStreamUsage(chunks: string[]): {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
  } | null;

  /**
   * Create fresh streaming state object.
   * Called once per stream to track content blocks, tool calls, etc.
   */
  createStreamState?(): any;
}
