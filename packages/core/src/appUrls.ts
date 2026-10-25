export const UPSTREAM_APP_SCHEME = "ardia";

let APP_SCHEME = UPSTREAM_APP_SCHEME;
let APP_PREFIX = prefixFor(APP_SCHEME);
let APP_URL = urlPatternFor(APP_SCHEME);

const RESERVED_SCHEMES = new Set(["http", "https", "file", "about", "data", "blob", "javascript", "view-source", "chrome", "chrome-extension", "devtools"]);

function schemesFor(scheme: string): string {
  return scheme === UPSTREAM_APP_SCHEME ? UPSTREAM_APP_SCHEME : `${UPSTREAM_APP_SCHEME}|${scheme.replace(/[.+]/g, "\\$&")}`;
}

function prefixFor(scheme: string): RegExp {
  return new RegExp(`^(view-source:)?(?:${schemesFor(scheme)}):(?:\\/\\/)?`, "i");
}

function urlPatternFor(scheme: string): RegExp {
  return new RegExp(`^(?:${schemesFor(scheme)}):\\/\\/[^/?#]`, "i");
}

export function appSchemeFor(productName: string | null | undefined): string {
  const scheme = (productName ?? "").trim().toLowerCase().replace(/[^a-z0-9+.-]/g, "");
  return /^[a-z][a-z0-9+.-]*$/.test(scheme) && !RESERVED_SCHEMES.has(scheme) ? scheme : UPSTREAM_APP_SCHEME;
}

export function setAppScheme(productName: string | null | undefined): string {
  APP_SCHEME = appSchemeFor(productName);
  APP_PREFIX = prefixFor(APP_SCHEME);
  APP_URL = urlPatternFor(APP_SCHEME);
  return APP_SCHEME;
}

export const appScheme = () => APP_SCHEME;

export const isAppScheme = (scheme: string) => {
  const lower = scheme.toLowerCase();
  return lower === UPSTREAM_APP_SCHEME || lower === APP_SCHEME;
};

const ENGINE_PREFIX = /^(view-source:)?chrome:(?:\/\/)?/i;
const ABOUT_PAGE = /^about:(blank|srcdoc)([?#]|$)/i;
const ABOUT_ALIAS = /^about:([a-z][a-z0-9-]*)/i;

const APP_PAGE_HOSTS = ["history", "bookmarks", "downloads"] as const;
export type AppPageHost = (typeof APP_PAGE_HOSTS)[number];

function split(url: string, prefix: RegExp): { viewSource: string; host: string; rest: string } | null {
  const m = prefix.exec(url);
  if (!m) return null;
  const after = url.slice(m[0].length);
  const host = /^[^/?#]*/.exec(after)![0];
  return { viewSource: m[1] ? "view-source:" : "", host: host.toLowerCase(), rest: after.slice(host.length) };
}

export function toAppUrl(url: string): string {
  const parts = split(url, APP_PREFIX) ?? split(url, ENGINE_PREFIX);
  if (parts) return parts.host ? `${parts.viewSource}${APP_SCHEME}://${parts.host}${parts.rest}` : url;
  if (ABOUT_PAGE.test(url)) return url;
  const about = ABOUT_ALIAS.exec(url);
  return about ? `${APP_SCHEME}://${about[1]!.toLowerCase()}${url.slice(about[0].length)}` : url;
}

export function toEngineUrl(url: string): string {
  const parts = split(url, APP_PREFIX);
  return parts?.host ? `${parts.viewSource}chrome://${parts.host}${parts.rest}` : url;
}

const isAppUrl = (url: string | null | undefined) => !!url && APP_URL.test(url);

function appUrlParts(url: string): { host: string; path: string; query: string; hash: string } | null {
  if (!isAppUrl(url)) return null;
  const parts = split(url, APP_PREFIX)!;
  const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(parts.rest)!;
  return { host: parts.host, path: m[1] ?? "", query: m[2] ?? "", hash: m[3] ?? "" };
}

export function appUrlOrigin(url: string): string | null {
  const parts = appUrlParts(toAppUrl(url));
  return parts ? `${APP_SCHEME}://${parts.host}` : null;
}

export type AppUrlRoute =
  | { kind: "page"; page: AppPageHost }
  | { kind: "settings"; section: string | null }
  | { kind: "newTab" }
  | { kind: "engine"; url: string };

export function appUrlRoute(url: string): AppUrlRoute | null {
  const parts = appUrlParts(url);
  if (!parts) return null;
  if ((APP_PAGE_HOSTS as readonly string[]).includes(parts.host)) return { kind: "page", page: parts.host as AppPageHost };
  if (parts.host === "newtab") return { kind: "newTab" };
  if (parts.host === "settings") {
    const section = parts.path.split("/").filter(Boolean)[0];
    return { kind: "settings", section: section ?? null };
  }
  return { kind: "engine", url: toEngineUrl(url) };
}
