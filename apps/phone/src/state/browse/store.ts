import { create } from "zustand";
import { history } from "../history/store";
import { HISTORY_RETENTION_MS } from "../history/historySummary";
import {
  livePageIds,
  listenToPages,
  savePageState,
  snapshotPage,
  storeNavigation,
  storeTone,
  type PageEngineEvent,
  type PageState,
  type PageTone,
} from "../pages/store";
import type { VisitKind } from "../../platform/pages";
import { currentPreferences, loadPreferences } from "../settings/store";
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
  saveTabState,
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

const lastVisits = new Map<string, Visit>();

const SNAPSHOT_SETTLE_MS = 700;
const DECK_SNAPSHOT_WAIT_MS = 400;

let started = false;

export function startBrowser() {
  if (started) return;
  started = true;
  loadPreferences();
  applySearchEngine();
  loadTabs();
  history().pruneBefore(Date.now() - HISTORY_RETENTION_MS);
  archiveDueTabs();
  listenToPages(pageEvent);
  if (currentPreferences().autoOpensKeyboard) presentSearch("home", "", useTabs.getState().incognito);
}

export function appBecameActive() {
  const selected = currentTabs().selectedId;
  if (selected) selectTabById(selected);
  archiveDueTabs();
}

export function appWillResignActive() {
  const selected = currentTabs().selectedId;
  if (selected) selectTabById(selected);
  void savePageStates();
}

const show = (surface: Surface) => useBrowse.setState({ surface });

export function openPage(url: string, origin: TabOrigin) {
  dismissSearch();
  openNewTab({ url, origin });
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
  const { incognitoOnCancel, origin } = searchState();
  dismissSearch();
  const selected = currentTabs().selectedId;
  if (origin === "home" && useBrowse.getState().surface === "start" && selected) {
    openTab(selected);
    return;
  }
  if (incognitoOnCancel !== null) setIncognito(incognitoOnCancel);
}

export async function showDeck() {
  const { surface } = useBrowse.getState();
  const selected = currentTabs().selectedId;
  dismissSearch();
  if (surface === "browsing" && selected) {
    await Promise.race([captureSnapshot(selected), new Promise((done) => setTimeout(done, DECK_SNAPSHOT_WAIT_MS))]);
  }
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

const transitions: Record<VisitKind, VisitTransition | null> = {
  typed: "typed",
  link: "link",
  sameDocument: "link",
  backForward: "backForward",
  redirect: "other",
  restored: null,
};

function pageVisited(id: string, url: string, title: string, kind: VisitKind) {
  const tab = findTab(currentTabs(), id);
  if (!tab) return;
  if (isSyncableUrl(url)) updateTabById(id, { url, title: title.trim() ? title : undefined });
  const transition = transitions[kind];
  if (!transition || tab.isPrivate) return;
  const visit = history().record(url, title, transition, tab.profileSyncId, Date.now());
  if (visit) lastVisits.set(id, visit);
}

function pageEvent(event: PageEngineEvent) {
  if (event.name === "page.visited") pageVisited(event.pageId, event.url, event.title, event.kind);
  else if (event.name === "page.closeRequested") closeTabById(event.pageId);
}

const loading = new Map<string, boolean>();
const snapshotTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function captureCurrentCover() {
  const id = currentTabs().selectedId;
  if (!id || loading.get(id) !== false) return;
  void captureSnapshot(id);
}

export async function captureSnapshot(id: string) {
  const snapshot = await snapshotPage(id);
  if (snapshot && findTab(currentTabs(), id)) updateTabById(id, { snapshotFileName: snapshot.uri });
}

function scheduleSnapshot(id: string) {
  clearTimeout(snapshotTimers.get(id));
  snapshotTimers.set(
    id,
    setTimeout(() => {
      snapshotTimers.delete(id);
      if (currentTabs().selectedId === id && useBrowse.getState().surface === "browsing") void captureSnapshot(id);
    }, SNAPSHOT_SETTLE_MS),
  );
}

export function pageStateChanged(id: string, state: PageState) {
  storeNavigation(id, state);
  const tab = findTab(currentTabs(), id);
  if (!tab) return;
  const url = state.url && isSyncableUrl(state.url) ? state.url : null;
  const title = state.title.trim() ? state.title : null;
  if ((url && url !== tab.url) || (title && title !== tab.title)) updateTabById(id, { url: url ?? undefined, title: title ?? undefined });
  const visit = lastVisits.get(id);
  if (visit && title && visit.url === state.url && visit.title !== title) lastVisits.set(id, history().amend(visit, { title }));
  const wasLoading = loading.get(id);
  loading.set(id, state.isLoading);
  if (wasLoading && !state.isLoading) scheduleSnapshot(id);
}

export const pageToneChanged = (id: string, tone: PageTone) => storeTone(id, tone);

export async function savePageStates() {
  const live = new Set(await livePageIds());
  const data = currentTabs();
  for (const tab of [...data.open, ...data.privates]) {
    if (!live.has(tab.id)) continue;
    saveTabState(tab.id, await savePageState(tab.id));
  }
}

useTabs.subscribe((tabs) => {
  for (const id of [...lastVisits.keys(), ...loading.keys()]) {
    if (findTab(tabs, id)) continue;
    lastVisits.delete(id);
    loading.delete(id);
    clearTimeout(snapshotTimers.get(id));
    snapshotTimers.delete(id);
  }
});

export function goBackToStartIfEmpty() {
  if (useBrowse.getState().surface === "browsing" && !selectedTab(currentTabs())) show("start");
}
