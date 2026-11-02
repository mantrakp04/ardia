import { engineHost, searchUrl, type SearchEngine } from "./engines.ts";
import { fixupUrl, hostOf, searchUrlFor } from "./omnibox.ts";
import { SITE_SEARCH_PRESETS, siteKeywords, normalizeSearchKeyword, validSearchTemplate, type SiteSearch } from "./siteSearches.ts";

export type SearchScope = {
  kind: "engine" | "site" | "history";
  name: string;
  host: string;
  url: string;
  engineId?: string;
  action?: "ask";
};

export type ScopeSources = {
  engines: readonly SearchEngine[];
  sites?: readonly SiteSearch[];
  hosts?: readonly string[];
};

function siteLabel(host: string): string {
  const parts = host.split(".");
  return parts.length >= 2 ? parts[parts.length - 2]! : host;
}

export function findScope(text: string, sources: ScopeSources): SearchScope | null {
  return resolveScope(text, sources) || null;
}

function resolveScope(text: string, { engines, sites = SITE_SEARCH_PRESETS, hosts = [] }: ScopeSources): SearchScope | null | false {
  const t = normalizeSearchKeyword(text);
  if (!t || /\s/.test(t)) return null;
  const host = hostOf(`https://${t}`) || t;

  for (const e of engines) {
    if (e.custom && [e.keyword, ...(e.aliases ?? [])].some((k) => normalizeSearchKeyword(k) === t)) return e.enabled === false || !validSearchTemplate(e.url) ? false : engineScope(e);
  }
  for (const site of sites) {
    if (siteKeywords(site).some((k) => normalizeSearchKeyword(k) === t)) return site.enabled === false ? false : siteScope(site);
  }
  for (const s of sites) {
    if (s.host === host || host.endsWith(`.${s.host}`) || (t === host && t.length >= 3 && s.host.split(".").length === 2 && siteLabel(s.host) === t)) {
      return s.enabled === false ? false : siteScope(s);
    }
  }
  for (const e of engines) {
    if (e.custom || e.enabled === false) continue;
    const eHost = engineHost(e);
    if (e.keyword.toLowerCase() === host || eHost === host || (t.length >= 3 && t === siteLabel(eHost))) return validSearchTemplate(e.url) ? engineScope(e) : false;
  }
  if (engines.some((e) => e.enabled === false && [e.keyword, ...(e.aliases ?? [])].some((k) => normalizeSearchKeyword(k) === t))) return null;
  if (host.includes(".") && hosts.includes(host)) return { kind: "history", name: host, host, url: "" };
  return null;
}

function siteScope(site: SiteSearch): SearchScope {
  return { kind: "site", name: site.name, host: site.host, url: site.url, ...(site.action ? { action: site.action } : {}) };
}

function engineScope(e: SearchEngine): SearchScope {
  return { kind: "engine", name: e.name, host: engineHost(e), url: e.url, engineId: e.id };
}

export function refreshScope(scope: SearchScope, { engines, sites = SITE_SEARCH_PRESETS }: ScopeSources): SearchScope | null {
  if (scope.kind === "history") return scope;
  if (scope.kind === "engine") {
    const engine = engines.find((e) => e.id === scope.engineId);
    return engine && engine.enabled !== false && validSearchTemplate(engine.url) ? engineScope(engine) : null;
  }
  const site = sites.find((s) => s.host === scope.host);
  return site && site.enabled !== false && validSearchTemplate(site.url) ? siteScope(site) : null;
}

export function scopedSearchUrl(scope: SearchScope, query: string, defaultEngine: Pick<SearchEngine, "url">): string {
  if (scope.kind === "history") return searchUrl(defaultEngine, `site:${scope.host} ${query.trim()}`);
  return searchUrlFor(scope.url, query);
}

export function emptyScopedUrl(scope: SearchScope, from: string): string {
  if (scope.url && !validSearchTemplate(scope.url)) return "";
  const candidate = fixupUrl(from.trim());
  if (candidate && /^https?:\/\//.test(candidate)) {
    const host = hostOf(candidate);
    if (host === scope.host || host.endsWith(`.${scope.host}`)) return candidate;
  }
  if (scope.url && hostOf(scope.url) === scope.host) return `${new URL(scope.url.replace(/%s/g, "")).origin}/`;
  return `https://${scope.host}/`;
}

export function offeredSiteSearch(typed: string, completion: string, sources: ScopeSources): SearchScope | null {
  const t = typed.trim();
  if (!t || /\s/.test(t)) return null;
  const exact = resolveScope(typed, sources);
  return exact === null ? findScope(typed + completion, sources) : exact || null;
}

export type SiteSearchKeyState = {
  typed: string;
  completion: string;
  scope: SearchScope | null;
  offered: SearchScope | null;
  scopeFrom: string;
};

export type SiteSearchKeyModifiers = { shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean };

export type SiteSearchKey =
  | { kind: "enter"; scope: SearchScope; from: string }
  | { kind: "leave"; text: string }
  | { kind: "accept"; text: string };

export type KeywordBySpace = { keyword: string; from: string };

export function keywordBySpace(typed: string, next: string): KeywordBySpace | null {
  if (!typed.trim() || /\s$/.test(typed) || next !== `${typed} `) return null;
  return { keyword: typed, from: next };
}

export function asksForBackspace(scope: SearchScope | null): boolean {
  return !!scope;
}

export function siteSearchKey(key: string, modifiers: SiteSearchKeyModifiers, state: SiteSearchKeyState): SiteSearchKey | null {
  const { shiftKey, altKey, metaKey, ctrlKey } = modifiers;
  if (key === "Tab" && !shiftKey && !ctrlKey) {
    if (!state.scope && state.offered) return { kind: "enter", scope: state.offered, from: state.typed + state.completion };
    if (state.completion) return { kind: "accept", text: state.typed + state.completion };
    return null;
  }
  const plain = !shiftKey && !altKey && !metaKey && !ctrlKey;
  if (key === "Backspace" && plain && state.scope) return { kind: "leave", text: state.scopeFrom };
  return null;
}
