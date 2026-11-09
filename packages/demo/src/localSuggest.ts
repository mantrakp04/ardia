import { BUILT_IN_ENGINES, calculate } from "@ardia/core";
import table from "./suggestions.json";

const LIMIT = 10;
const FALLBACK = ["", " meaning", " near me", " app", " online", " definition", " download", " login", " vs", " review", " reddit", " 2026"];
const QUERY_PARAMS = ["q", "query", "part", "command", "wd"];
const ROWS = table as Record<string, string[]>;
const KEYS = Object.keys(ROWS);

const SUGGEST_HOSTS = new Set(
  BUILT_IN_ENGINES.flatMap((engine) => {
    try {
      return engine.suggestUrl ? [new URL(engine.suggestUrl.replace(/%s/g, "q")).hostname] : [];
    } catch {
      return [];
    }
  }),
);

export function localSuggestions(raw: string): string[] {
  const query = raw.trim().toLowerCase();
  if (!query) return [];
  const math = calculate(raw);
  if (math) return [`= ${math.display}`, query, `${query}0`];
  const out: string[] = [];
  const add = (row: string) => {
    if (out.length < LIMIT && row.startsWith(query) && !out.includes(row)) out.push(row);
  };
  const exact = ROWS[query];
  if (exact) for (const suffix of exact) add(query + suffix);
  const longer = KEYS.filter((key) => key !== query && key.startsWith(query)).sort((a, b) => a.length - b.length);
  const shorter = KEYS.filter((key) => key !== query && query.startsWith(key)).sort((a, b) => b.length - a.length);
  for (const key of [...longer, ...shorter]) for (const suffix of ROWS[key]!) add(key + suffix);
  for (const suffix of FALLBACK) add(query + suffix);
  return out;
}

function suggestQuery(url: URL) {
  if (!SUGGEST_HOSTS.has(url.hostname)) return null;
  for (const name of QUERY_PARAMS) {
    const value = url.searchParams.get(name);
    if (value !== null) return value;
  }
  return null;
}

export function installLocalSuggestions() {
  const pageFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let url: URL | null = null;
    try {
      url = new URL(href, location.href);
    } catch {}
    const query = url && suggestQuery(url);
    if (query === null || query === undefined) return pageFetch(input, init);
    const body = JSON.stringify([query, localSuggestions(query), [], {}]);
    return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
  };
}
