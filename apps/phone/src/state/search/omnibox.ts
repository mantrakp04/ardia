import {
  mobileDisplay,
  mobileEngines,
  mobileParseRemote,
  mobileResolve,
  mobileSetSearch,
  mobileSetSources,
  mobileSuggest,
  mobileSuggestRequest,
} from "@ardia/core/src/mobile";
import { dedupeByLanding, displayHost, landingKey } from "../../lib/url";

export type TrayRow =
  | { key: string; kind: "query"; title: string; url: string; query: string }
  | { key: string; kind: "page"; title: string; detail: string; url: string; favicon: string | null; tabId: string | null; switchesTab: boolean }
  | { key: string; kind: "calc"; title: string; detail: string; url: string };

export const SWITCH_TO_TAB = "Switch to Tab";

export const IDLE_ROW_LIMIT = 5;

export type Suggested = { rows: TrayRow[]; completion: string };

export type SuggestContext = { currentUrl: string | null; currentTabId: string | null };

export type OmniboxSources = Parameters<typeof mobileSetSources>[0];

export function suggest(text: string, remote: readonly string[], context: SuggestContext, macTabs: ReadonlyMap<string, string> = new Map()): Suggested {
  if (!text.trim()) return { rows: [], completion: "" };
  const result = mobileSuggest(text, { remote: [...remote], preference: "website", limit: 8, now: Date.now(), ...context });
  const rows: TrayRow[] = [];
  for (const item of result.items) {
    if (item.kind === "search") rows.push({ key: `q:${item.query}`, kind: "query", title: item.query, url: item.url, query: item.query });
    else if (item.kind === "page") {
      const shown = mobileDisplay(item.url, item.title);
      const host = displayHost(shown.host, item.url);
      rows.push({
        key: `p:${item.tabId ?? ""}:${item.url}`,
        kind: "page",
        title: item.title || host,
        detail: item.tabId ? SWITCH_TO_TAB : (macTabs.get(landingKey(item.url)) ?? host),
        url: item.url,
        favicon: item.favicon ?? null,
        tabId: item.tabId ?? null,
        switchesTab: Boolean(item.tabId),
      });
    } else if (item.kind === "calc") rows.push({ key: `c:${item.expression}`, kind: "calc", title: item.value, detail: item.expression, url: item.url });
  }
  const unique = dedupeByLanding(rows.map((row) => ({ row, url: row.kind === "page" ? row.url : row.key, opensTab: row.kind === "page" && row.switchesTab })));
  return { rows: unique.map((item) => item.row), completion: result.completion };
}

export function idleRows(queries: readonly string[], macTabs: readonly { url: string; title: string; deviceName: string; favicon?: string | null }[] = []): TrayRow[] {
  const rows: TrayRow[] = [];
  for (const query of queries) {
    const url = mobileResolve(`?${query}`)?.url;
    if (url) rows.push({ key: `q:${query}`, kind: "query", title: query, url, query });
  }
  for (const tab of macTabs) rows.push({ key: `r:${tab.url}`, kind: "page", title: tab.title, detail: tab.deviceName, url: tab.url, favicon: tab.favicon ?? null, tabId: null, switchesTab: false });
  return rows.slice(0, IDLE_ROW_LIMIT);
}

export const searchEngines = () => mobileEngines().map((engine) => ({ id: engine.id, name: engine.name }));

export const resolve = (text: string) => mobileResolve(text);

export const display = (url: string) => mobileDisplay(url);

export const setSources = (sources: OmniboxSources) => mobileSetSources(sources);

export const setSearchEngine = (engineId: string) => mobileSetSearch({ engineId });

export const setSyncedSearch = (search: { engineId: string; customURL: string | null; customEngines: { id: string; name: string; keyword: string; url: string }[] }) =>
  mobileSetSearch({ engineId: search.engineId, customUrl: search.customURL ?? undefined, customEngines: search.customEngines });

const REMOTE_TIMEOUT_MS = 4000;

export type RemoteOutcome = { values: string[]; status: "ok" | "none" | "http" | "failed" | "timeout" };

export async function remoteSuggestions(text: string, signal: AbortSignal): Promise<RemoteOutcome> {
  const address = mobileSuggestRequest(text);
  if (!address) return { values: [], status: "none" };
  const timeout = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeout.abort();
  }, REMOTE_TIMEOUT_MS);
  const cancel = () => timeout.abort();
  signal.addEventListener("abort", cancel);
  try {
    const response = await fetch(address, { headers: { Accept: "application/json" }, signal: timeout.signal });
    if (response.status !== 200) return { values: [], status: "http" };
    return { values: mobileParseRemote(await response.text()), status: "ok" };
  } catch {
    return { values: [], status: timedOut ? "timeout" : "failed" };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

export const refinedText = (row: TrayRow) => (row.kind === "query" ? `${row.query.trim()} ` : row.title);

export function queryPrefixLength(title: string, typed: string): number {
  const needle = typed.trim();
  if (!needle || title.length <= needle.length) return 0;
  return title.toLowerCase().startsWith(needle.toLowerCase()) ? needle.length : 0;
}
