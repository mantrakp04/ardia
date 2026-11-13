import { mobileDisplay, mobileParseRemote, mobileResolve, mobileSuggest, mobileSuggestRequest } from "@ardia/core/src/mobile";

export type TrayRow =
  | { key: string; kind: "query"; title: string; url: string; query: string }
  | { key: string; kind: "page"; title: string; detail: string; url: string }
  | { key: string; kind: "calc"; title: string; detail: string; url: string };

export type Suggested = { rows: TrayRow[]; completion: string };

export function suggest(text: string, remote: readonly string[]): Suggested {
  if (!text.trim()) return { rows: [], completion: "" };
  const result = mobileSuggest(text, { remote: [...remote], preference: "website", limit: 8 });
  const rows: TrayRow[] = [];
  for (const item of result.items) {
    if (item.kind === "search") rows.push({ key: `q:${item.query}`, kind: "query", title: item.query, url: item.url, query: item.query });
    else if (item.kind === "page") {
      const shown = mobileDisplay(item.url, item.title);
      rows.push({ key: `p:${item.url}`, kind: "page", title: item.title || shown.host || shown.display, detail: shown.display, url: item.url });
    } else if (item.kind === "calc") rows.push({ key: `c:${item.expression}`, kind: "calc", title: item.value, detail: item.expression, url: item.url });
  }
  return { rows, completion: result.completion };
}

export const resolve = (text: string) => mobileResolve(text);

export const display = (url: string) => mobileDisplay(url);

const REMOTE_TIMEOUT_MS = 4000;

export async function remoteSuggestions(text: string, signal: AbortSignal): Promise<string[]> {
  const address = mobileSuggestRequest(text);
  if (!address) return [];
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REMOTE_TIMEOUT_MS);
  const cancel = () => timeout.abort();
  signal.addEventListener("abort", cancel);
  try {
    const response = await fetch(address, { headers: { Accept: "application/json" }, signal: timeout.signal });
    if (response.status !== 200) return [];
    return mobileParseRemote(await response.text());
  } catch {
    return [];
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
