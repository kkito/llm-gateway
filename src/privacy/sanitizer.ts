/**
 * File path username sanitizer.
 *
 * Replaces usernames in file paths with a placeholder before forwarding upstream,
 * stores the mapping, and can reverse-replace in responses.
 *
 * Supported patterns:
 * - /home/<username>/...  (Linux)
 * - /Users/<username>/... (macOS)
 * - C:\Users\<username>\... (Windows)
 */

// Global mapping storage: requestId → Map<placeholder_path, real_path>
const pathMappings = new Map<string, Map<string, string>>();

// Buffer state for streaming: tracks partial placeholder content across chunks
interface SSEBufferState {
  buffer: string;
}
const streamBufferStates = new Map<string, SSEBufferState>();

/**
 * Clear all path mappings (for testing).
 */
export function clearPathMappings(): void {
  pathMappings.clear();
}

/**
 * Clear all streaming buffer states (for testing).
 */
export function clearAllStreamBufferStates(): void {
  streamBufferStates.clear();
}

/**
 * Replace usernames in file paths with placeholder.
 * Works on any JSON-serializable body. Mutates the body in place.
 */
export function sanitizePaths(
  body: unknown,
  placeholder: string,
  requestId: string
): void {
  const mapping = new Map<string, string>();

  const jsonStr = JSON.stringify(body);
  const replaced = replaceUsernames(jsonStr, mapping, placeholder);

  if (mapping.size === 0) return;

  pathMappings.set(requestId, mapping);

  const parsed = JSON.parse(replaced);
  mutateInPlace(body, parsed);
}

function replaceUsernames(
  jsonStr: string,
  mapping: Map<string, string>,
  placeholder: string
): string {
  let result = jsonStr;

  result = result.replace(
    /(\/home\/)([^/"]+)(\/)/g,
    replacerFn(mapping, placeholder)
  );

  result = result.replace(
    /(\/Users\/)([^/"]+)(\/)/g,
    replacerFn(mapping, placeholder)
  );

  // In JSON strings, backslashes are escaped as \\, so we match double backslashes
  result = result.replace(
    /([A-Za-z]:\\\\Users\\\\)([^\\\\"]+)(\\\\)/g,
    replacerFn(mapping, placeholder)
  );

  return result;
}

function replacerFn(
  mapping: Map<string, string>,
  placeholder: string
): (match: string, prefix: string, username: string, suffix: string) => string {
  return (_match: string, prefix: string, username: string, suffix: string) => {
    const placeholderPath = prefix + placeholder + suffix;
    const realPath = prefix + username + suffix;
    mapping.set(placeholderPath, realPath);
    return placeholderPath;
  };
}

function mutateInPlace(original: unknown, replacement: unknown): void {
  if (Array.isArray(original) && Array.isArray(replacement)) {
    original.length = 0;
    original.push(...replacement);
  } else if (
    original &&
    typeof original === 'object' &&
    replacement &&
    typeof replacement === 'object' &&
    !Array.isArray(original) &&
    !Array.isArray(replacement)
  ) {
    const origObj = original as Record<string, unknown>;
    for (const key of Object.keys(origObj)) {
      delete origObj[key];
    }
    for (const [key, value] of Object.entries(replacement)) {
      origObj[key] = value;
    }
  }
}

/**
 * Reverse-replace placeholders with real usernames in response body.
 * Clears the mapping after use. Mutates body in place.
 */
export function restorePaths(
  body: unknown,
  requestId: string
): void {
  const mapping = pathMappings.get(requestId);
  if (!mapping) return;

  const jsonStr = JSON.stringify(body);
  let result = jsonStr;
  for (const [placeholderPath, realPath] of mapping) {
    result = result.split(placeholderPath).join(realPath);
  }

  pathMappings.delete(requestId);

  const parsed = JSON.parse(result);
  mutateInPlace(body, parsed);
}

/**
 * Sanitize a single SSE chunk string by reverse-replacing placeholders.
 * Used in streaming responses. Does NOT clear the mapping (stream has multiple chunks).
 *
 * Handles cross-chunk truncation: if a placeholder is split across two chunks,
 * buffers the partial content and completes the replacement when the next chunk arrives.
 */
export function sanitizeSSEChunk(
  sseLine: string,
  requestId: string
): { output: string; buffered: boolean } {
  const mapping = pathMappings.get(requestId);
  if (!mapping) return { output: sseLine, buffered: false };

  // Get or create buffer state for this request
  let state = streamBufferStates.get(requestId);
  if (!state) {
    state = { buffer: '' };
    streamBufferStates.set(requestId, state);
  }

  const combined = state.buffer + sseLine;

  // Step 1: Try complete replacement
  const { result: replaced, anyReplaced } = tryReplaceAll(combined, mapping);
  if (anyReplaced) {
    state.buffer = '';
    return { output: replaced, buffered: false };
  }

  // Step 2: Prefix compatibility check
  const maxLen = getMaxPlaceholderLength(mapping);
  if (combined.length >= maxLen) {
    const tail = combined.slice(-maxLen);
    if (isPrefixOfAnyPlaceholder(tail, mapping)) {
      // Save combined content to buffer, wait for next chunk
      state.buffer = combined;
      return { output: '', buffered: true };
    }
  }

  // Not compatible, flush buffer (send as-is), clear state
  const flushResult = state.buffer + sseLine;
  state.buffer = '';
  return { output: flushResult, buffered: false };
}

/**
 * Try to replace all placeholders in the text.
 * Returns the replaced text and whether any replacement occurred.
 */
function tryReplaceAll(
  text: string,
  mapping: Map<string, string>
): { result: string; anyReplaced: boolean } {
  let result = text;
  let anyReplaced = false;
  for (const [placeholderPath, realPath] of mapping) {
    if (result.includes(placeholderPath)) {
      result = result.split(placeholderPath).join(realPath);
      anyReplaced = true;
    }
  }
  return { result, anyReplaced };
}

/**
 * Get the maximum placeholder length from the mapping.
 */
function getMaxPlaceholderLength(mapping: Map<string, string>): number {
  let max = 0;
  for (const p of mapping.keys()) {
    if (p.length > max) max = p.length;
  }
  return max;
}

/**
 * Check if any suffix of the text is a prefix of any placeholder in the mapping.
 * This detects when a placeholder might be truncated across chunk boundaries.
 * Only checks suffixes up to the maximum placeholder length.
 */
function isPrefixOfAnyPlaceholder(
  text: string,
  mapping: Map<string, string>
): boolean {
  const maxLen = getMaxPlaceholderLength(mapping);
  // Check all suffixes from length 1 to maxLen
  for (let len = 1; len <= Math.min(text.length, maxLen); len++) {
    const suffix = text.slice(-len);
    for (const placeholder of mapping.keys()) {
      if (placeholder.startsWith(suffix)) return true;
    }
  }
  return false;
}

/**
 * Clear the streaming buffer state for a request.
 * Should be called when the stream ends to clean up.
 */
export function clearStreamBufferState(requestId: string): void {
  streamBufferStates.delete(requestId);
}
