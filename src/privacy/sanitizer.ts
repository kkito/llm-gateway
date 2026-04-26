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

/**
 * Clear all path mappings (for testing).
 */
export function clearPathMappings(): void {
  pathMappings.clear();
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

  // Match /home/<username>/ or /home/<username> at end of string/value
  result = result.replace(
    /(\/home\/)([^/"]+)(\/|(?=["\\]}]|$))/g,
    replacerFn(mapping, placeholder)
  );

  // Match /Users/<username>/ or /Users/<username> at end of string/value
  result = result.replace(
    /(\/Users\/)([^/"]+)(\/|(?=["\\]}]|$))/g,
    replacerFn(mapping, placeholder)
  );

  // In JSON strings, backslashes are escaped as \\, so we match double backslashes
  result = result.replace(
    /([A-Za-z]:\\\\Users\\\\)([^\\\\"]+)(\\\\|(?=["\\]}]|$))/g,
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
    // Also add no-trailing-slash variant so LLM reasoning responses
    // like "通常是 /Users/kktestuser。" (no slash) are also restored.
    const placeholderNoSlash = prefix + placeholder;
    const realNoSlash = prefix + username;
    mapping.set(placeholderNoSlash, realNoSlash);
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
 */
export function sanitizeSSEChunk(
  sseLine: string,
  requestId: string
): string {
  const mapping = pathMappings.get(requestId);
  if (!mapping) return sseLine;

  let result = sseLine;
  for (const [placeholderPath, realPath] of mapping) {
    result = result.split(placeholderPath).join(realPath);
  }
  return result;
}

/**
 * Apply path mappings to a plain text string.
 * Does NOT clear the mapping (unlike restorePaths).
 * Used for SSE chunk concatenation in sliding window.
 */
export function applyPathMappings(
  text: string,
  requestId: string
): string {
  const mapping = pathMappings.get(requestId);
  if (!mapping) return text;

  let result = text;
  for (const [placeholderPath, realPath] of mapping) {
    result = result.split(placeholderPath).join(realPath);
  }
  return result;
}

/**
 * Get the path mappings for a request (placeholder -> original).
 * Useful for restoring paths in SSE chunks after stream ends.
 */
export function getPathMappings(requestId: string): Map<string, string> | undefined {
  return pathMappings.get(requestId);
}
