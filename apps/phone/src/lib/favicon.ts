import { mixColors } from "./color.ts";

const MONOGRAM_PALETTE = ["#5E6AD2", "#2F9E8F", "#D9663F", "#8A5CC7", "#3A8DDE", "#C2477A", "#5F9E3A", "#B8862B"] as const;
const MONOGRAM_NEUTRAL = "#8E8E93";

const isWeb = (url: string) => /^https?:\/\//i.test(url.trim());

function origin(url: string): string | null {
  const match = /^(https?:\/\/[^/?#]+)/i.exec(url.trim());
  return match ? match[1]! : null;
}

export function faviconCandidates(iconUrl: string | null, pageUrl: string | null): string[] {
  const list: string[] = [];
  if (iconUrl && isWeb(iconUrl)) list.push(iconUrl);
  const site = pageUrl && isWeb(pageUrl) ? origin(pageUrl) : null;
  if (site) {
    const fallback = `${site}/favicon.ico`;
    if (!list.includes(fallback)) list.push(fallback);
  }
  return list;
}

export function monogramHost(url: string | null): string | null {
  if (!url?.trim()) return null;
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i.exec(url.trim());
  const host = match?.[1]?.toLowerCase() ?? "";
  if (!host) return null;
  return host.startsWith("www.") ? host.slice(4) : host;
}

export function monogramLetter(host: string | null): string | null {
  if (!host) return null;
  for (const character of host) if (/[\p{L}\p{Nd}]/u.test(character)) return character.toUpperCase();
  return null;
}

export function monogramHash(host: string): number {
  let hash = 5381;
  for (const character of host) hash = (Math.imul(hash, 33) + character.codePointAt(0)!) >>> 0;
  return hash;
}

export function monogramTint(host: string | null): string {
  return host ? MONOGRAM_PALETTE[monogramHash(host) % MONOGRAM_PALETTE.length]! : MONOGRAM_NEUTRAL;
}

export const tileGradient = (tint: string): [string, string] => [mixColors(tint, "#FFFFFF", 0.1), mixColors(tint, "#000000", 0.05)];

export type Monogram = { letter: string | null; colors: [string, string] };

export function monogram(pageUrl: string | null): Monogram {
  const host = monogramHost(pageUrl);
  return { letter: monogramLetter(host), colors: tileGradient(monogramTint(host)) };
}

export const FAVICON_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36";

export type FaviconBacking = "light" | "dark" | null;

export type FaviconLookResult = { tone: "opaque" | "darkOnClear" | "lightOnClear" | "mixed" | "blank"; backing: FaviconBacking } | null;

export const usableLook = (look: FaviconLookResult): boolean => look !== null && look.tone !== "blank";

export async function firstUsable(candidates: readonly string[], look: (url: string) => Promise<FaviconLookResult>): Promise<{ url: string; backing: FaviconBacking } | null> {
  for (const url of candidates) {
    const found = await look(url).catch(() => null);
    if (usableLook(found)) return { url, backing: found!.backing };
  }
  return null;
}
