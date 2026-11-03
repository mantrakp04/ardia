import { pageKey } from "./pageText.ts";
import type { Suggestion } from "./suggestion.ts";

export type ProviderRowInput = { title: string; url: string; subtitle?: string; icon?: string | null; badge?: string };

export type ProviderSection = { id: string; title: string; rows: readonly ProviderRowInput[] };

export type ProviderSuggestion = Extract<Suggestion, { kind: "provider" }>;

export const PROVIDER_LIMITS = {
  title: 120,
  subtitle: 160,
  url: 4096,
  iconBytes: 16_384,
  rowsPerProvider: 20,
  rowsPerGlobalSection: 3,
  globalRows: 6,
  keyword: 32,
  providerTitle: 60,
} as const;

const HIDDEN = "\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u061c\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff\\ufff9-\\ufffb";
const HIDDEN_CHARACTERS = new RegExp(`[${HIDDEN}]`, "g");
const UNSAFE_IN_URL = new RegExp(`[\\s${HIDDEN}]`);
const WEB_URL = /^https?:\/\/([^/?#]+)(?:[/?#].*)?$/i;
const AUTHORITY = /^(?:\[[0-9a-f:.]+\]|[^:@\[\]]+)(?::\d{1,5})?$/i;
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/]+={0,2}$/i;

export function providerText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(HIDDEN_CHARACTERS, " ").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${Array.from(text).slice(0, max - 1).join("").trimEnd()}…`;
}

export function providerUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!url || url.length > PROVIDER_LIMITS.url || UNSAFE_IN_URL.test(url)) return null;
  const authority = WEB_URL.exec(url)?.[1];
  return authority && AUTHORITY.test(authority) ? url : null;
}

export function providerIcon(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (/^data:/i.test(value)) return value.length <= PROVIDER_LIMITS.iconBytes && IMAGE_DATA_URL.test(value) ? value : null;
  return /^https?:\/\//i.test(value) ? providerUrl(value) : null;
}

export function safeProviderRows(section: { id: string; title: string }, rows: unknown, limit: number = PROVIDER_LIMITS.rowsPerProvider): ProviderSuggestion[] {
  if (!Array.isArray(rows)) return [];
  const out: ProviderSuggestion[] = [];
  const seen = new Set<string>();
  const providerTitle = providerText(section.title, PROVIDER_LIMITS.providerTitle);
  for (const row of rows) {
    if (out.length >= limit) break;
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const url = providerUrl(r.url);
    if (!url) continue;
    const key = pageKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = providerText(r.title, PROVIDER_LIMITS.title) || url.slice(0, PROVIDER_LIMITS.title);
    const subtitle = providerText(r.subtitle, PROVIDER_LIMITS.subtitle);
    out.push({
      kind: "provider",
      providerId: section.id,
      provider: providerTitle,
      title,
      url,
      icon: providerIcon(r.icon),
      ...(subtitle ? { subtitle } : {}),
    });
  }
  return out;
}

export function fillProviderTemplate(template: string, query: string): string | null {
  const q = query.trim();
  if (!q) return null;
  return providerUrl(template.split("{query}").join(encodeURIComponent(q)));
}

export function parseProviderReply(body: unknown, template?: string): ProviderRowInput[] {
  if (!Array.isArray(body)) return [];
  if (typeof body[0] === "string" && Array.isArray(body[1])) {
    const texts = body[1] as unknown[];
    const details = Array.isArray(body[2]) ? (body[2] as unknown[]) : [];
    const urls = Array.isArray(body[3]) ? (body[3] as unknown[]) : [];
    const rows: ProviderRowInput[] = [];
    texts.forEach((text, i) => {
      if (typeof text !== "string" || !text.trim()) return;
      const url = typeof urls[i] === "string" && urls[i] ? (urls[i] as string) : template ? fillProviderTemplate(template, text) : null;
      if (!url) return;
      const subtitle = details[i];
      rows.push({ title: text, url, ...(typeof subtitle === "string" && subtitle ? { subtitle } : {}) });
    });
    return rows;
  }
  return body.filter((row): row is ProviderRowInput => !!row && typeof row === "object" && !Array.isArray(row)) as ProviderRowInput[];
}

export function matchProviderRows(rows: readonly ProviderRowInput[], text: string): ProviderRowInput[] {
  const tokens = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [...rows];
  const scored: { row: ProviderRowInput; score: number; at: number }[] = [];
  rows.forEach((row, at) => {
    const title = (row.title ?? "").toLowerCase();
    const haystack = `${title} ${(row.subtitle ?? "").toLowerCase()} ${(row.url ?? "").toLowerCase()}`;
    if (!tokens.every((t) => haystack.includes(t))) return;
    const first = tokens[0]!;
    const score = title.startsWith(first) ? 3 : new RegExp(`(^|[^a-z0-9])${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(title) ? 2 : 1;
    scored.push({ row, score, at });
  });
  return scored.sort((a, b) => b.score - a.score || a.at - b.at).map((x) => x.row);
}

export function globalProviderRows(sections: readonly ProviderSection[], shown: readonly Suggestion[]): ProviderSuggestion[] {
  const taken = new Set<string>();
  for (const s of shown) if ("url" in s && s.kind !== "search") taken.add(pageKey(s.url));
  const out: ProviderSuggestion[] = [];
  for (const section of sections) {
    let inSection = 0;
    for (const row of safeProviderRows(section, section.rows)) {
      if (out.length >= PROVIDER_LIMITS.globalRows || inSection >= PROVIDER_LIMITS.rowsPerGlobalSection) break;
      const key = pageKey(row.url);
      if (taken.has(key)) continue;
      taken.add(key);
      out.push(row);
      inSection++;
    }
  }
  return out;
}
