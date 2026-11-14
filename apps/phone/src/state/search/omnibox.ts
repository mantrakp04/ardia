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
import { displayHost } from "../../lib/url";

export type TrayRow =
  | { key: string; kind: "query"; title: string; url: string; query: string }
  | { key: string; kind: "page"; title: string; detail: string; url: string; tabId: string | null; switchesTab: boolean }
  | { key: string; kind: "calc"; title: string; detail: string; url: string };

export const SWITCH_TO_TAB = "Switch to Tab";

export type Suggested = { rows: TrayRow[]; completion: string };

export type SuggestContext = { currentUrl: string | null; currentTabId: string | null };

export type OmniboxSources = Parameters<typeof mobileSetSources>[0];

export function suggest(text: string, remote: readonly string[], context: SuggestContext): Suggested {
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
        detail: item.tabId ? SWITCH_TO_TAB : host,
        url: item.url,
        tabId: item.tabId ?? null,
        switchesTab: Boolean(item.tabId),
      });
    } else if (item.kind === "calc") rows.push({ key: `c:${item.expression}`, kind: "calc", title: item.value, detail: item.expression, url: item.url });
  }
  return { rows, completion: result.completion };
}

export function idleRows(queries: readonly string[]): TrayRow[] {
  const rows: TrayRow[] = [];
  for (const query of queries) {
    const url = mobileResolve(`?${query}`)?.url;
    if (url) rows.push({ key: `q:${query}`, kind: "query", title: query, url, query });
  }
  return rows;
}

export const searchEngines = () => mobileEngines().map((engine) => ({ id: engine.id, name: engine.name }));

export const resolve = (text: string) => mobileResolve(text);

export const display = (url: string) => mobileDisplay(url);

export const setSources = (sources: OmniboxSources) => mobileSetSources(sources);

export const setSearchEngine = (engineId: string) => mobileSetSearch({ engineId });

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
