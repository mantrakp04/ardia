import type { PageCookie } from "../../platform/webkit";

export function cookieAddresses(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return [];
  parsed.hash = "";
  const root = `${parsed.origin}/`;
  return parsed.href === root ? [root] : [parsed.href, root];
}

export const carriableCookies = (cookies: readonly PageCookie[], nowSeconds: number): PageCookie[] =>
  cookies.filter(
    (c) =>
      !!c.name &&
      !!c.domain &&
      c.partitionKey == null &&
      c.partitionKeyOpaque !== true &&
      (c.session || !(c.expires > 0) || c.expires > nowSeconds),
  );
