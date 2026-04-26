/**
 * Remove the OpenAI `user` field from request body.
 * Logs the removed value for audit visibility.
 */
export function stripUserField(
  body: Record<string, unknown>,
  requestId: string
): void {
  if ('user' in body) {
    console.log(`[Privacy] requestId=${requestId} stripped: user="${body.user}"`);
    delete body.user;
  }
}
