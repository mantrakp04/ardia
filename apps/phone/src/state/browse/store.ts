import { create } from "zustand";
import { history } from "../history/store";
import { HISTORY_RETENTION_MS } from "../history/historySummary";
import { pageHandle, pageNavigation, storeNavigation, storeTone, type PageNavigationState, type PageTone } from "../pages/store";
import { loadPreferences } from "../settings/store";
import type { VisitTransition, Visit } from "../store/browserDatabase";
import { resolve, type TrayRow } from "../search/omnibox";
import { applySearchEngine, dismissSearch, presentSearch, searchState } from "../search/store";
import {
  archiveDueTabs,
  closeEveryTab,
  closePrivateTabs,
  closeTabById,
  currentTabs,
  loadTabs,
  openNewTab,
  reopenClosedTab,
  restoreArchivedTab,
  selectTabById,
  setIncognito,
  updateTabById,
  useTabs,
} from "../tabs/store";
import { deckOrder, findTab, isPrivateTab, selectedTab } from "../tabs/tabsState";
import { isSyncableUrl, type BrowserTab, type TabOrigin } from "../tabs/tabModels";

export type Surface = "start" | "browsing" | "deck";
export type Sheet = "archive" | null;

type BrowseState = { surface: Surface; sheet: Sheet; deckEntrance: string | null; frozenOrder: string[] | null };

export const useBrowse = create<BrowseState>()(() => ({ surface: "start", sheet: null, deckEntrance: null, frozenOrder: null }));

const freshVisits = new Map<string, VisitTransition>();
const lastVisits = new Map<string, Visit>();
const visitedUrls = new Map<string, string>();

let started = false;

export function startBrowser() {
  if (started) return;
  started = true;
  loadPreferences();
  applySearchEngine();
  loadTabs();
  history().pruneBefore(Date.now() - HISTORY_RETENTION_MS);
  archiveDueTabs();
}

export function appBecameActive() {
  const selected = currentTabs().selectedId;
  if (selected) selectTabById(selected);
  archiveDueTabs();
}

export function appWillResignActive() {
  const selected = currentTabs().selectedId;
  if (selected) selectTabById(selected);
}

const show = (surface: Surface) => useBrowse.setState({ surface });

export function openPage(url: string, origin: TabOrigin) {
  dismissSearch();
  const tab = openNewTab({ url, origin });
  freshVisits.set(tab.id, origin === "link" ? "link" : "typed");
  useBrowse.setState({ surface: "browsing", sheet: null, frozenOrder: null });
}

export function submitSearch(text: string) {
  const resolution = resolve(text);
  if (resolution) openPage(resolution.url, resolution.kind === "url" ? "typed" : "search");
}

export function activateRow(row: TrayRow) {
  if (row.kind === "calc") return;
  if (row.kind === "page" && row.tabId && findTab(currentTabs(), row.tabId)) {
    openTab(row.tabId);
    return;
  }
  openPage(row.url, row.kind === "query" ? "search" : "typed");
}

export function openTab(id: string) {
  dismissSearch();
  setIncognito(isPrivateTab(currentTabs(), id));
  selectTabById(id);
  useBrowse.setState({ surface: "browsing", sheet: null });
}

function trayOrigin() {
  return useBrowse.getState().surface === "start" ? "start" : "page";
}

export function newTab() {
  presentSearch(trayOrigin(), "", useTabs.getState().incognito);
}

export function newIncognitoTab() {
  const was = useTabs.getState().incognito;
  setIncognito(true);
  presentSearch(trayOrigin(), "", was);
}

export function newRegularTab() {
  const was = useTabs.getState().incognito;
  setIncognito(false);
  presentSearch(trayOrigin(), "", was);
}

export function cancelSearch() {
  const { incognitoOnCancel } = searchState();
  dismissSearch();
  if (incognitoOnCancel !== null) setIncognito(incognitoOnCancel);
}

export function showDeck() {
  const { surface } = useBrowse.getState();
  const selected = currentTabs().selectedId;
  dismissSearch();
  useBrowse.setState({ surface: "deck", deckEntrance: surface === "browsing" ? selected : null, frozenOrder: null });
}

export const consumeDeckEntrance = () => {
  const entrance = useBrowse.getState().deckEntrance;
  if (entrance) useBrowse.setState({ deckEntrance: null });
  return entrance;
};

export function leaveDeck() {
  const tab = selectedTab(currentTabs());
  if (tab) openTab(tab.id);
  else show("start");
}

export const closeTabFromDeck = (id: string) => closeTabById(id);

export const closeAllFromDeck = () => closeEveryTab();

export const leaveIncognito = () => closePrivateTabs();

export function reopenLastClosed() {
  const tab = reopenClosedTab();
  if (tab) openTab(tab.id);
}

export const openArchive = () => useBrowse.setState({ sheet: "archive" });

export const closeArchive = () => useBrowse.setState({ sheet: null });

export function reopenArchived(tab: BrowserTab) {
  restoreArchivedTab(tab);
  openTab(tab.id);
}

export function swipeOrder(): string[] {
  const live = deckOrder(currentTabs()).map((t) => t.id);
  const frozen = useBrowse.getState().frozenOrder;
  if (!frozen) return live;
  const alive = new Set(live);
  const kept = frozen.filter((id) => alive.has(id));
  const known = new Set(kept);
  return [...kept, ...live.filter((id) => !known.has(id))];
}

export function switchToNeighbour(id: string) {
  const order = swipeOrder();
  useBrowse.setState({ frozenOrder: order });
  openTab(id);
}

export function pageMounted(id: string) {
  if (freshVisits.has(id) || visitedUrls.has(id)) return;
  const tab = findTab(currentTabs(), id);
  if (tab) visitedUrls.set(id, tab.url);
}

export function pageStateChanged(id: string, state: PageNavigationState) {
  storeNavigation(id, state);
  const data = currentTabs();
  const tab = findTab(data, id);
  if (!tab) return;
  const url = state.url && isSyncableUrl(state.url) ? state.url : null;
  const title = state.title.trim() ? state.title : null;
  if ((url && url !== tab.url) || (title && title !== tab.title)) updateTabFromPage(id, url, title);
  if (url && visitedUrls.get(id) !== url) {
    visitedUrls.set(id, url);
    const transition = freshVisits.get(id) ?? "link";
    freshVisits.delete(id);
    const visit = tab.isPrivate ? null : history().record(url, title ?? "", transition, tab.profileSyncId, Date.now());
    if (visit) lastVisits.set(id, visit);
    else lastVisits.delete(id);
    return;
  }
  const visit = lastVisits.get(id);
  if (visit && title && visit.url === url && visit.title !== title) lastVisits.set(id, history().amend(visit, { title }));
}

function updateTabFromPage(id: string, url: string | null, title: string | null) {
  updateTabById(id, { url: url ?? undefined, title: title ?? undefined });
}

export const pageToneChanged = (id: string, tone: PageTone) => storeTone(id, tone);

useTabs.subscribe((tabs) => {
  for (const id of [...visitedUrls.keys(), ...freshVisits.keys()]) {
    if (findTab(tabs, id)) continue;
    freshVisits.delete(id);
    lastVisits.delete(id);
    visitedUrls.delete(id);
  }
});

export function goBackToStartIfEmpty() {
  if (useBrowse.getState().surface === "browsing" && !selectedTab(currentTabs())) show("start");
}

export function handleSystemBack(): boolean {
  if (searchState().open) {
    cancelSearch();
    return true;
  }
  const { surface, sheet } = useBrowse.getState();
  if (sheet) {
    closeArchive();
    return true;
  }
  if (surface === "deck") {
    leaveDeck();
    return true;
  }
  if (surface === "browsing") {
    const id = currentTabs().selectedId;
    if (pageNavigation(id)?.canGoBack) {
      void pageHandle(id)?.goBack();
      return true;
    }
    showDeck();
    return true;
  }
  return false;
}
