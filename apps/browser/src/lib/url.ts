import { appUrlOrigin, breadcrumb, displayHost, hostOf, urlForDisplay } from "@ardia/core";

export const withoutFragment = (url: string) => url.replace(/#.*$/, "");

export const samePage = (a: string, b: string) => withoutFragment(a).replace(/\/$/, "") === withoutFragment(b).replace(/\/$/, "");

export const isWebPageUrl = (url: string) => /^(https?|file):/i.test(url);

export const displayHostOf = (url: string) => displayHost(hostOf(url));

export const pageHostLabel = (url: string) => (url.startsWith("file:") ? "File" : breadcrumb(url).host);

export function urlTrail(url: string, title: string, { hovered, showFullUrl }: { hovered: boolean; showFullUrl: boolean }): string {
  const isFile = url.startsWith("file:");
  const host = pageHostLabel(url);
  const full = isFile ? ` ${decodedOr(url.slice("file://".length))}` : urlForDisplay(url);
  const path = !isFile && full.startsWith(host) ? full.slice(host.length) : full;
  if (hovered) return path;
  if (showFullUrl) return path.replace(/\/$/, "");
  return !/^https?:/i.test(url) && appUrlOrigin(url) && title ? ` / ${title}` : "";
}

function decodedOr(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export const hostOrOrigin = (origin: string) => hostOf(origin) || origin;

export function originForSecurityDisplay(origin: string): string {
  try {
    const url = new URL(origin);
    if (!url.host) return origin;
    return url.protocol === "https:" ? url.host : `${url.protocol}//${url.host}`;
  } catch {
    return origin;
  }
}
