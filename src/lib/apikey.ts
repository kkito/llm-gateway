export function generateUserApiKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomPart = '';
  const randomBytes = new Uint8Array(20);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < 20; i++) {
    randomPart += chars[randomBytes[i] % chars.length];
  }
  return `sk-lg-${randomPart}`;
}

export function validateApiKeyFormat(apiKey: string): boolean {
  return /^sk-lg-[a-zA-Z0-9]{20}$/.test(apiKey);
}
