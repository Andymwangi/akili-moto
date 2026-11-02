export function createRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return value.match(/.{1,5}/g)?.join('-') ?? value;
}

export async function hashRecoveryCode(value: string): Promise<string> {
  const normalized = value.replaceAll('-', '').toUpperCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
