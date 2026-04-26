import type { PrivacySettings } from './types.js';
import { filterWhitelistedFields } from './whitelist-filter.js';
import { stripUserField } from './strip-user.js';
import { sanitizePaths } from './sanitizer.js';

/**
 * Apply all enabled privacy protections to the request body.
 * Returns the processed body. Order: whitelist filter -> strip user -> sanitize paths.
 */
export function applyPrivacyProtection(
  body: Record<string, unknown>,
  settings: PrivacySettings,
  requestId: string
): Record<string, unknown> {
  if (!settings.enabled) return body;

  let processed = body;

  if (settings.whitelistFilter) {
    processed = filterWhitelistedFields(processed, requestId);
  }

  if (settings.stripUserField) {
    stripUserField(processed, requestId);
  }

  if (settings.sanitizeFilePaths) {
    sanitizePaths(processed, settings.pathPlaceholder, requestId);
  }

  return processed;
}
