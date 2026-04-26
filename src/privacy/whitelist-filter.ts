const SAFE_FIELDS = [
  'messages', 'stream', 'temperature', 'max_tokens', 'top_p',
  'presence_penalty', 'frequency_penalty', 'stop', 'response_format',
  'tools', 'tool_choice', 'seed', 'stream_options'
];

/**
 * Filter request body to only include whitelisted fields.
 * Logs removed fields for audit visibility.
 */
export function filterWhitelistedFields(
  body: Record<string, unknown>,
  requestId: string
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  const removed: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (SAFE_FIELDS.includes(key)) {
      filtered[key] = value;
    } else {
      removed[key] = value;
    }
  }

  if (Object.keys(removed).length > 0) {
    const fields = Object.keys(removed).join(', ');
    const values = JSON.stringify(removed, null, 2).slice(0, 500);
    console.log(`🔒 [Privacy] requestId=${requestId} filtered: ${fields} → ${values}`);
  }

  return filtered;
}
