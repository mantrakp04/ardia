const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i;

export function loginOrigin(address: string | undefined): string | null {
  const trimmed = address?.trim();
  if (!trimmed) return null;
  return ORIGIN.exec(SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`)?.[0] ?? null;
}
