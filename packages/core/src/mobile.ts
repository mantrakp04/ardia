import { BANG_LIST, BANG_LIST_UNICODE } from "./bangList.ts";
import { bangDocument, bangTable, findBang, joinBangTables, readBangDocument, slimBangs, type BangTable } from "./bangs.ts";
import { cleanUrl } from "./cleanUrl.ts";
import { allEngines, engineById, parseSuggestions, suggestRequestUrl, type CustomSearchEngine, type SearchEngine } from "./engines.ts";
import { breadcrumb, fixupUrl, searchUrlFor, urlForDisplay } from "./omnibox.ts";
import { findScope, type SearchScope } from "./siteSearch.ts";
import { buildSuggestions, prepareSuggestions, type SuggestionResult, type SuggestionSource } from "./suggest.ts";

export * from "./index.ts";

class HostURL {
  readonly protocol: string;
  readonly hostname: string;
  readonly href: string;
  constructor(url: string) {
    const match = /^([a-z][a-z0-9+.-]*:)(?:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*))?/i.exec(String(url));
    if (!match) throw new TypeError("Invalid URL");
    this.protocol = match[1]!.toLowerCase();
    this.hostname = (match[2] ?? "").toLowerCase();
    this.href = String(url);
  }
}

const scope = globalThis as { URL?: unknown };
if (typeof scope.URL === "undefined") scope.URL = HostURL;

type MobileSearch = { engineId?: string | null; customUrl?: string | null; customEngines?: CustomSearchEngine[] | null };
type MobileSuggestOptions = {
  currentUrl?: string | null;
  currentTabId?: string | null;
  remote?: string[] | null;
  preference?: "website" | "search";
  limit?: number;
  preventInline?: boolean;
  scope?: SearchScope | null;
  now?: number;
};
export type MobileResolution = { kind: "url" | "search" | "bang"; url: string; query: string; engine: string };

let source: SuggestionSource = { tabs: [], history: [], bookmarks: [] };
let engines: SearchEngine[] = allEngines();
let engine: SearchEngine = engines[0]!;
let bangs: BangTable | null = null;

const bangTableOnce = () => (bangs ??= joinBangTables([bangTable(BANG_LIST), bangTable(BANG_LIST_UNICODE)]));

export function mobileLoadBangDocument(doc: string): string | null {
  const read = readBangDocument(doc);
  if (!read) return null;
  bangs = read.table;
  return read.etag ?? "";
}

export function mobileBangDocument(json: string, etag: string | null): string | null {
  const slim = slimBangs(json);
  if (!slim) return null;
  const doc = bangDocument(etag, slim);
  return mobileLoadBangDocument(doc) === null ? null : doc;
}

export function mobileSetSources(next: SuggestionSource): boolean {
  source = { tabs: next.tabs ?? [], history: next.history ?? [], bookmarks: next.bookmarks ?? [] };
  return prepareSuggestions(source, Infinity);
}

export function mobileSetSearch(search: MobileSearch): { id: string; name: string; url: string; suggests: boolean } {
  const list = allEngines(search.customEngines ?? []);
  if (search.customUrl?.includes("%s")) list.push({ id: "custom", name: "Custom", keyword: "custom", url: search.customUrl, custom: true });
  engines = list;
  engine = engineById(engines, search.engineId ?? undefined);
  return { id: engine.id, name: engine.name, url: engine.url, suggests: Boolean(engine.suggestUrl) };
}

export function mobileEngines(): { id: string; name: string; url: string; custom: boolean }[] {
  return engines.map((e) => ({ id: e.id, name: e.name, url: e.url, custom: Boolean(e.custom) }));
}

export function mobileWarmBangs(): number {
  return bangTableOnce().size;
}

export function mobileSuggest(text: string, options: MobileSuggestOptions = {}): SuggestionResult {
  const result = buildSuggestions(text, source, {
    engine,
    limit: options.limit ?? 8,
    preference: options.preference ?? "website",
    remote: options.remote ?? [],
    currentUrl: options.currentUrl ?? undefined,
    currentTabId: options.currentTabId ?? undefined,
    preventInline: options.preventInline ?? false,
    scope: options.scope ?? null,
    now: options.now,
    bangs: text.includes("!") ? bangTableOnce() : null,
  });
  return { items: result.items.filter((s) => s.kind === "page" || s.kind === "search" || s.kind === "calc"), completion: result.completion };
}

export function mobileResolve(text: string, scope: SearchScope | null = null): MobileResolution | null {
  const input = text.trim();
  if (!input) return null;
  if (scope) return { kind: "search", url: searchUrlFor(scope.url, input), query: input, engine: scope.name };
  const bang = input.includes("!") ? findBang(input, bangTableOnce()) : null;
  if (bang) return { kind: "bang", url: bang.url, query: bang.query, engine: bang.bang.name };
  if (input.startsWith("?")) {
    const query = input.slice(1).trim();
    return query ? { kind: "search", url: searchUrlFor(engine.url, query), query, engine: engine.name } : null;
  }
  const url = fixupUrl(input);
  if (url) return { kind: "url", url, query: input, engine: engine.name };
  return { kind: "search", url: searchUrlFor(engine.url, input), query: input, engine: engine.name };
}

export function mobileSuggestRequest(text: string, scope: SearchScope | null = null): string | null {
  const query = text.trim().replace(/^\?/, "").trim();
  if (!query || /^[a-z][a-z0-9+.-]*:\/\//i.test(query)) return null;
  if (query.includes("!") && findBang(query, bangTableOnce())) return null;
  if (scope && scope.kind !== "engine") return null;
  const from = scope?.kind === "engine" ? engineById(engines, scope.engineId) : engine;
  return suggestRequestUrl(from, query);
}

export function mobileParseRemote(body: string): string[] {
  try {
    return parseSuggestions(JSON.parse(body)).slice(0, 8);
  } catch {
    return [];
  }
}

export function mobileFindScope(text: string): SearchScope | null {
  return findScope(text, { engines, hosts: [] });
}

export function mobileClean(url: string): string {
  return cleanUrl(url);
}

export function mobileDisplay(url: string, title = ""): { display: string; host: string; trail: string[] } {
  return { display: urlForDisplay(url), ...breadcrumb(url, title) };
}
