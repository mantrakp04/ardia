import { appUrlRoute, type AppPageHost } from "@ardia/core";
import { focus } from "../browser/actions";
import { useBrowser } from "../browser/store";
import { activeTabId, resolveWindowId, viewTabIds } from "../browser/model";
import type { Tab } from "../browser/types";
import { navigationOf } from "../tabs/pageSession";

export const INTERNAL_PAGES: Record<AppPageHost, { title: string }> = {
  history: { title: "History" },
  bookmarks: { title: "Bookmarks" },
  downloads: { title: "Downloads" },
};

const internalUrl = (page: AppPageHost, query?: string) => `ardia://${page}${query ? `?q=${encodeURIComponent(query)}` : ""}`;

export function internalPageOf(url: string | null | undefined): AppPageHost | null {
  const route = url ? appUrlRoute(url) : null;
  return route?.kind === "page" ? route.page : null;
}

export function internalQuery(url: string): string {
  const q = /[?&]q=([^&#]*)/.exec(url)?.[1];
  try {
    return q ? decodeURIComponent(q) : "";
  } catch {
    return q ?? "";
  }
}

export const tabDestination = (t: Pick<Tab, "url" | "page">) => navigationOf(t)?.url ?? t.url;

export const isInternalTab = (t: Pick<Tab, "url" | "page">) => internalPageOf(tabDestination(t)) !== null;

export function openInternalPage(page: AppPageHost, windowId?: string | null, options: { query?: string; background?: boolean } = {}) {
  const s = useBrowser.getState();
  const id = resolveWindowId(s, windowId);
  if (!id) return;
  if (!options.background && (!windowId || windowId !== id)) focus(id);
  const url = internalUrl(page, options.query);
  const existing = viewTabIds(s, id).find((t) => internalPageOf(tabDestination(s.tabs[t]!)) === page);
  if (existing) {
    if (options.query) s.navigate(existing, url);
    if (!options.background) s.activate(existing);
    return;
  }
  const active = activeTabId(s, id);
  if (active && !s.tabs[active]!.url && !options.background) return s.navigate(active, url);
  s.newTab(id, { url, background: options.background });
}
