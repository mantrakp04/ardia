import { appUrlOrigin, toAppUrl } from "./appUrls.ts";
import { cleanUrl } from "./cleanUrl.ts";
import { displayHost } from "./idn.ts";
import { PSL_TLDS } from "./tlds.ts";

export type ParsedUrl = { scheme: string; host: string; port: string; path: string; query: string; hash: string };

const URL_PARTS = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)(?::(\d+))?([^?#]*)(\?[^#]*)?(#.*)?$/i;

function parseUrl(url: string): ParsedUrl | null {
  const m = URL_PARTS.exec(url.trim());
  if (!m) return null;
  return { scheme: m[1]!.toLowerCase(), host: m[2]!.toLowerCase(), port: m[3] ?? "", path: m[4] ?? "", query: m[5] ?? "", hash: m[6] ?? "" };
}

export function hostOf(url: string): string {
  return (parseUrl(url)?.host ?? "").replace(/^www\./, "");
}

const KNOWN_SCHEMES = new Set([
  "http", "https", "file", "about", "data", "blob", "mailto", "tel", "sms", "facetime", "ftp", "view-source",
  "ardia", "chrome", "chrome-extension", "devtools", "x-apple.systempreferences", "itms-apps", "slack", "zoommtg", "vscode",
  "cursor", "notion", "figma", "spotify", "linear", "obsidian", "raycast",
]);

const LOCAL_TLDS = new Set(["meta", "local", "localhost", "test", "internal", "lan"]);
let registries: Set<string> | undefined;
const knownTld = (tld: string) => LOCAL_TLDS.has(tld) || (registries ??= new Set(PSL_TLDS.split(/\s+/))).has(tld);

function isLocalHost(host: string): boolean {
  return (
    host === "localhost" ||
    !host.includes(".") ||
    host.startsWith("[") ||
    /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ||
    /\.(local|localhost|test|internal|lan|home\.arpa)$/.test(host)
  );
}

const L = "a-z0-9\\u00a1-\\uffff";
const LABEL = `[${L}](?:[${L}-]*[${L}])?`;
const HOST = new RegExp(
  `^(localhost|\\[[0-9a-f:.]+\\]|(\\d{1,3}\\.){3}\\d{1,3}|(${LABEL}\\.)+([a-z\\u00a1-\\uffff](?:[${L}-]*[${L}])?|xn--[a-z0-9-]+)|${LABEL})\\.?(:\\d{1,5})?(?=[/?#]|$)`,
  "i",
);

const JAVASCRIPT_URL = /^(?:view-source:)?javascript:/i;
const JAVASCRIPT_PREFIX = /^[\u0000-\u0020\u007f]*javascript:/i;

export const isJavaScriptUrl = (url: string) => JAVASCRIPT_URL.test(url.replace(/^[\u0000-\u0020]+/, "").replace(/[\t\n\r]/g, ""));

export function withoutJavaScriptScheme(text: string): string {
  let out = text;
  while (JAVASCRIPT_PREFIX.test(out)) out = out.replace(JAVASCRIPT_PREFIX, "");
  return out;
}

export function fixupUrl(raw: string): string | null {
  const url = fixup(raw);
  return url && !isJavaScriptUrl(url) ? toAppUrl(url) : null;
}

function fixup(raw: string): string | null {
  const input = raw.trim();
  if (!input || (/\s/.test(input) && !/^([a-z][a-z0-9+.-]*:\/\/|\/[^\s/])/i.test(input))) return null;
  if (/^(about|data|mailto|tel|sms|facetime|view-source):/i.test(input)) return input;

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(input)?.[1]?.toLowerCase();
  if (scheme && KNOWN_SCHEMES.has(scheme) && (input.slice(scheme.length + 1).startsWith("//") || !/^\d/.test(input.slice(scheme.length + 1)))) {
    return scheme + input.slice(scheme.length).replace(/\s/g, "%20");
  }
  if (scheme && !KNOWN_SCHEMES.has(scheme) && input.slice(scheme.length + 1).startsWith("//")) return input;
  if (input.startsWith("/") && !input.startsWith("//")) return `file://${input.replace(/\s/g, "%20")}`;

  if (!/[.:/?#[]/.test(input)) return input.toLowerCase() === "localhost" ? `http://${input}` : null;
  const host = HOST.exec(input);
  if (!host) return null;
  const name = host[1]!.toLowerCase().replace(/\.$/, "");
  const numeric = /^[\d.]+$/.test(name);
  if (numeric && !name.includes(".")) return null;
  const dotted = name.includes(".") && !numeric && name.charCodeAt(0) !== 91;
  const tld = dotted ? name.slice(name.lastIndexOf(".") + 1) : "";
  const rest = input.slice(host[0].length);
  const special = name === "localhost" || name.charCodeAt(0) === 91 || numeric;
  const proto = isLocalHost(name) ? "http" : "https";
  if (special || (dotted && (knownTld(tld) || tld.startsWith("xn--")))) return `${proto}://${input}`;
  if (!host[5] && !rest.includes("/") && !rest.includes("?") && !rest.includes("#")) return null;
  const path = /^[^?#]*/.exec(rest)![0];
  const query = /\?[^#]*/.exec(rest)?.[0] ?? "";
  const fragment = /#.*/.exec(rest)?.[0] ?? "";
  const parts = (host[5] ? 1 : 0) + (path ? 1 : 0) + (query.length > 1 ? 1 : 0) + (fragment.length > 1 ? 1 : 0);
  return host[5] || path.endsWith("/") || parts > 1 ? `${proto}://${input}` : null;
}

export function searchUrlFor(template: string, query: string): string {
  const q = encodeURIComponent(query.trim());
  return template.includes("%s") ? template.replace(/%s/g, q) : template + q;
}

export function resolveInput(raw: string, search: string): string {
  const input = raw.trim();
  if (!input) return "";
  if (input.startsWith("?")) return input.length > 1 ? searchUrlFor(search, input.slice(1)) : "";
  return fixupUrl(input) ?? searchUrlFor(search, input);
}

export type PasteAction = { kind: "go"; url: string } | { kind: "search"; query: string };

export function classifyPaste(text: string): PasteAction | null {
  const trimmed = withoutJavaScriptScheme(text.trim()).trim();
  if (!trimmed) return null;
  const url = /\s/.test(trimmed) ? null : fixupUrl(trimmed);
  if (url && !/^(about|data):/i.test(url)) return { kind: "go", url: cleanUrl(url) };
  return { kind: "search", query: trimmed.replace(/\s+/g, " ").slice(0, 2000) };
}

export function sanitizePaste(text: string): string {
  if (!text) return "";
  const parts = text.trim().split(/(\s+)/);
  if (parts.length === 1 && !parts[0]) return " ";
  const spaced = parts.some((part, i) => i % 2 === 1 && !/[\r\n]/.test(part));
  return withoutJavaScriptScheme(parts.map((part, i) => (i % 2 === 0 || !/[\r\n]/.test(part) ? part : spaced ? " " : "")).join("")).trimStart();
}

const DEFAULT_PORTS: Record<string, string> = { http: "80", https: "443", ws: "80", wss: "443", ftp: "21" };

export function breadcrumb(url: string, title?: string): { host: string; trail: string[] } {
  const parsed = parseUrl(url);
  const app = appUrlOrigin(url);
  const port = parsed?.port && parsed.port !== DEFAULT_PORTS[parsed.scheme] ? `:${parsed.port}` : "";
  const host = app ?? (parsed ? displayHost(parsed.host).replace(/^www\./, "") + port : url);
  const seen = new Set([host.toLowerCase(), ...(app && parsed ? [parsed.host] : [])]);
  const trail = (title ?? "")
    .split(/\s[|/·–—-]\s/)
    .map((s) => s.trim())
    .filter((s) => {
      const key = s.toLowerCase();
      if (!s || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { host, trail };
}

export function urlForDisplay(url: string): string {
  if (appUrlOrigin(url)) return toAppUrl(url).replace(/^([^/]*\/\/[^/?#]*)\/(?=[?#]|$)/, "$1");
  const authority = /^[a-z][a-z0-9+.-]*:\/\//i.exec(url);
  const rest = authority ? url.slice(authority[0].length).replace(/^[^/?#]*@/, "") : url;
  const host = /^[^/?#:]*/.exec(rest)![0];
  return (displayHost(host) + rest.slice(host.length)).replace(/^www\./i, "");
}
