import { create } from "zustand";
import { goBackAcrossEngines } from "../engines/actions";
import { livePageId, withLivePage } from "./livePage";
import { webviews } from "../../platform/webviews";
import { useBrowser } from "../browser/store";
import { changedIds } from "../browser/changes";
import { useTabLive } from "../browser/hooks";
import type { TabLive } from "../browser/types";
import { internalPageOf, tabDestination } from "../pages/urls";
import { pageOf, patchPage, usePage } from "./pageState";
import { historyOf } from "../history/history";
import { adoptedPage, IDLE } from "./pageSession";

const store = () => useBrowser.getState();

export function canGoBack(tabId: string, live: Pick<TabLive, "canGoBack">): boolean {
  const page = pageOf(tabId);
  return !page.newTabShown && (live.canGoBack || page.backToNewTab || !!page.engineBack);
}

export function canGoForward(tabId: string, live: Pick<TabLive, "canGoForward">): boolean {
  return !!pageOf(tabId).newTabShown || live.canGoForward;
}

export function useHistoryAvailability(tabId: string) {
  const back = useTabLive(tabId, (l) => l.canGoBack);
  const forward = useTabLive(tabId, (l) => l.canGoForward);
  const shown = usePage(tabId, (p) => !!p.newTabShown);
  const backToNewTab = usePage(tabId, (p) => p.backToNewTab || !!p.engineBack);
  return { back: !shown && (back || backToNewTab), forward: shown || forward };
}

export function goBack(tabId: string): void {
  if (livePageId(tabId) !== tabId) return void withLivePage(tabId, (_, id) => goBack(id));
  const live = store().live[tabId];
  if (pageOf(tabId).newTabShown) return;
  if (live?.canGoBack) return void webviews.get(tabId)?.goBack();
  if (pageOf(tabId).engineBack) return void goBackAcrossEngines(tabId);
  if (pageOf(tabId).backToNewTab) showNewTab(tabId);
}

export function goForward(tabId: string): void {
  if (livePageId(tabId) !== tabId) return void withLivePage(tabId, (_, id) => goForward(id));
  if (pageOf(tabId).newTabShown) return hideNewTab(tabId);
  void webviews.get(tabId)?.goForward();
}

function showNewTab(tabId: string, keep?: { url: string; title: string }) {
  const tab = store().tabs[tabId];
  if (!tab?.url) return;
  patchPage(tabId, { newTabShown: { url: keep?.url ?? tab.url, title: keep?.title ?? tab.title, favicon: tab.favicon }, status: "" });
  const internal = internalPageOf(tabDestination(tab)) !== null;
  const page = internal && tab.page.kind === "loaded" ? IDLE : internal && tab.page.kind === "adopted" ? adoptedPage(tab.page.adopt) : tab.page;
  store().updateTab(tabId, { url: "", title: "", favicon: null, page });
}

function goBackToNewTab(tabId: string, offset: number, first: { url: string; title: string }) {
  if (!pageOf(tabId).backToNewTab || pageOf(tabId).newTabShown) return;
  if (offset) void webviews.get(tabId)?.goToOffset(offset);
  showNewTab(tabId, offset ? first : undefined);
}

function hideNewTab(tabId: string) {
  const kept = pageOf(tabId).newTabShown;
  if (!kept) return;
  patchPage(tabId, { newTabShown: null });
  store().updateTab(tabId, { url: kept.url, title: kept.title, favicon: kept.favicon });
}

useBrowser.subscribe((s, prev) => {
  for (const id of changedIds(s.tabs, prev.tabs)) {
    const tab = s.tabs[id];
    const before = prev.tabs[id];
    if (!tab || !before) continue;
    if (!tabDestination(before) && internalPageOf(tabDestination(tab)) && !pageOf(id).backToNewTab) patchPage(id, { backToNewTab: true });
  }
});

export type HistoryItem = {
  key: string;
  title: string;
  url: string;
  offset: number | "newTab";
};

export async function historyItems(asked: string, direction: -1 | 1, max = 15): Promise<HistoryItem[]> {
  const tabId = livePageId(asked);
  const page = pageOf(tabId);
  const list = (await webviews.get(tabId)?.navigationEntries()) ?? [];
  const current = list.findIndex((e) => e.current);
  if (page.newTabShown) {
    if (direction < 0) return [];
    const items: HistoryItem[] = [];
    for (let i = Math.max(current, 0); i < list.length && items.length < max; i++) {
      const e = list[i]!;
      items.push({ key: String(i), title: e.title || e.url, url: e.url, offset: i - current });
    }
    if (!items.length) items.push({ key: "kept", title: page.newTabShown.title || page.newTabShown.url, url: page.newTabShown.url, offset: 0 });
    return items;
  }
  const items: HistoryItem[] = [];
  if (current >= 0) {
    for (let i = current + direction; i >= 0 && i < list.length && items.length < max; i += direction) {
      const e = list[i]!;
      items.push({ key: String(i), title: e.title || e.url, url: e.url, offset: i - current });
    }
  }
  if (direction < 0 && page.backToNewTab && items.length < max) items.push({ key: "newTab", title: "New Tab", url: "", offset: "newTab" });
  return items;
}

export async function goToHistoryItem(tabId: string, item: HistoryItem): Promise<void> {
  if (livePageId(tabId) !== tabId) return withLivePage(tabId, (_, id) => void goToHistoryItem(id, item));
  const page = pageOf(tabId);
  if (item.offset === "newTab") {
    const list = (await webviews.get(tabId)?.navigationEntries()) ?? [];
    const current = list.findIndex((e) => e.current);
    if (current <= 0 || !list[0]) return goBack(tabId);
    return goBackToNewTab(tabId, -current, list[0]);
  }
  if (page.newTabShown) {
    hideNewTab(tabId);
    if (item.offset) void webviews.get(tabId)?.goToOffset(item.offset);
    return;
  }
  if (item.offset === -1) return goBack(tabId);
  if (item.offset === 1) return goForward(tabId);
  if (item.offset) void webviews.get(tabId)?.goToOffset(item.offset);
}

type HistoryMenu = { tabId: string; direction: -1 | 1; items: HistoryItem[] };
export const useHistoryMenu = create<{ menu: HistoryMenu | null }>()(() => ({ menu: null }));

export async function openHistoryMenu(tabId: string, direction: -1 | 1) {
  const items = await historyItems(tabId, direction);
  if (!items.length) return;
  useHistoryMenu.setState({ menu: { tabId, direction, items } });
}

export const closeHistoryMenu = () => useHistoryMenu.setState({ menu: null });

export const closeHistoryMenuOf = (tabId: string) => {
  if (useHistoryMenu.getState().menu?.tabId === tabId) closeHistoryMenu();
};

export function historyFavicons(profileId: string, items: readonly { url: string }[]): Map<string, string | null> {
  const urls = new Set(items.map((i) => i.url));
  return new Map(historyOf(useBrowser.getState(), profileId).filter((h) => urls.has(h.url)).map((h) => [h.url, h.favicon]));
}

export function toggleHistoryMenu(tabId: string, direction: -1 | 1) {
  const open = useHistoryMenu.getState().menu;
  if (open?.tabId === tabId && open.direction === direction) return closeHistoryMenu();
  void openHistoryMenu(tabId, direction);
}
