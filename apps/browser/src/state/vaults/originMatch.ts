import { punycodeEncode } from "@ardia/core";
import type { VaultItem } from "../../platform/vaults";

export type MatchTier = 0 | 1 | 2 | 3;
export const TIER = { none: 0, sibling: 1, subdomain: 2, exact: 3 } as const;

type Site = { scheme: "http" | "https"; host: string; port: string; portGiven: boolean };

const URL_HEAD = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)(?::(\d*))?/i;
const DEFAULT_PORT = { http: "80", https: "443" } as const;
const NON_ASCII = /[^\x00-\x7f]/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

const TWO_LEVEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk", "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "org.nz", "co.jp", "ne.jp", "or.jp", "ac.jp", "co.kr", "or.kr", "com.br", "net.br", "org.br", "com.mx",
  "co.in", "net.in", "org.in", "com.cn", "net.cn", "org.cn", "com.tw", "com.hk", "com.sg", "com.my", "co.za", "com.tr",
  "com.ar", "com.co", "co.il", "co.id", "com.ph", "com.vn", "com.ua", "com.pl", "co.th", "com.eg", "com.sa", "com.pk",
  "github.io", "gitlab.io", "herokuapp.com", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "web.app",
  "firebaseapp.com", "azurewebsites.net", "cloudfront.net", "appspot.com", "blogspot.com", "fly.dev", "onrender.com",
  "glitch.me", "replit.app", "ngrok.io", "ngrok-free.app", "amazonaws.com", "myshopify.com", "wixsite.com",
]);

const asciiHost = (host: string) =>
  host
    .toLowerCase()
    .replace(/\.$/, "")
    .split(".")
    .map((label) => (NON_ASCII.test(label) ? `xn--${punycodeEncode(label)}` : label))
    .join(".");

export function parseSite(url: string): Site | null {
  const text = url.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  const m = URL_HEAD.exec(withScheme);
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  if (scheme !== "http" && scheme !== "https") return null;
  const host = asciiHost(m[2]!);
  if (!host) return null;
  const portGiven = !!m[3];
  return { scheme, host, port: portGiven ? String(Number(m[3])) : DEFAULT_PORT[scheme], portGiven };
}

const isIp = (host: string) => IPV4.test(host) || host.startsWith("[");
export const isLocalHost = (host: string) => host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]";
const bare = (host: string) => host.replace(/^www\./, "");

export function registrableDomain(host: string): string {
  const h = bare(asciiHost(host));
  if (isIp(h) || isLocalHost(h)) return h;
  const labels = h.split(".");
  if (labels.length < 2) return h;
  const take = TWO_LEVEL_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.length < take ? "" : labels.slice(-take).join(".");
}

export function isSecureOrigin(origin: string): boolean {
  const site = parseSite(origin);
  return !!site && (site.scheme === "https" || isLocalHost(site.host));
}

function portsMatch(page: Site, item: Site) {
  if (item.portGiven) return item.port === page.port;
  return isLocalHost(page.host) || page.port === DEFAULT_PORT[page.scheme];
}

export function matchTier(pageOrigin: string, itemUrl: string): MatchTier {
  const page = parseSite(pageOrigin);
  const item = parseSite(itemUrl);
  if (!page || !item || !isSecureOrigin(pageOrigin)) return TIER.none;
  if (!portsMatch(page, item)) return TIER.none;
  const ph = bare(page.host);
  const ih = bare(item.host);
  if (ph === ih) return TIER.exact;
  if (isIp(ph) || isIp(ih)) return TIER.none;
  const parentOk = (parent: string) => !!registrableDomain(parent);
  if ((ph.endsWith(`.${ih}`) && parentOk(ih)) || (ih.endsWith(`.${ph}`) && parentOk(ph))) return TIER.subdomain;
  const site = registrableDomain(ph);
  return site && site === registrableDomain(ih) ? TIER.sibling : TIER.none;
}

export const itemTier = (item: Pick<VaultItem, "urls">, origin: string): MatchTier =>
  item.urls.reduce<MatchTier>((best, url) => Math.max(best, matchTier(origin, url)) as MatchTier, TIER.none);

export type RankedItem = { item: VaultItem; tier: MatchTier };

const byRank = (a: RankedItem, b: RankedItem) =>
  b.tier - a.tier ||
  Number(!!b.item.favorite) - Number(!!a.item.favorite) ||
  (b.item.updatedAt ?? 0) - (a.item.updatedAt ?? 0) ||
  a.item.title.localeCompare(b.item.title) ||
  a.item.username.localeCompare(b.item.username);

export function rankItems(items: readonly VaultItem[], origin: string): RankedItem[] {
  if (!isSecureOrigin(origin)) return [];
  return items
    .map((item) => ({ item, tier: itemTier(item, origin) }))
    .filter((r) => r.tier > TIER.none)
    .sort(byRank);
}

export const bestItem = (items: readonly VaultItem[], origin: string) => rankItems(items, origin).find((r) => r.tier >= TIER.subdomain)?.item ?? null;

export const sameUsername = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const loginSavedIn = (items: readonly VaultItem[], origin: string, username: string) =>
  items.some((item) => sameUsername(item.username, username) && itemTier(item, origin) >= TIER.subdomain);

export function sameSite(a: string, b: string): boolean {
  const x = parseSite(a);
  const y = parseSite(b);
  if (!x || !y) return false;
  const site = registrableDomain(x.host);
  return !!site && site === registrableDomain(y.host);
}

const hostsOf = (item: VaultItem) => item.urls.map((u) => parseSite(u)?.host ?? u.toLowerCase());

export function searchItems(items: readonly VaultItem[], query: string, limit = 100): VaultItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { item: VaultItem; score: number }[] = [];
  for (const item of items) {
    const title = item.title.toLowerCase();
    const haystack = [title, item.username.toLowerCase(), ...hostsOf(item)].join("\n");
    if (!words.every((w) => haystack.includes(w))) continue;
    const first = words[0] ?? "";
    scored.push({ item, score: !first ? 0 : title.startsWith(first) ? 2 : title.includes(first) ? 1 : 0 });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title) || a.item.username.localeCompare(b.item.username))
    .slice(0, limit)
    .map((s) => s.item);
}

export const siteLabel = (origin: string) => bare(parseSite(origin)?.host ?? origin);
