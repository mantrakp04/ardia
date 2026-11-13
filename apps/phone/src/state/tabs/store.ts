import { create } from "zustand";
import { newUuid } from "../../lib/ids";
import { deletePageSnapshots, endPages, endPrivateSession } from "../pages/store";
import { currentPreferences, setPreference } from "../settings/store";
import {
  countArchivedTabs,
  deleteArchivedTabs,
  expiredArchivedIds,
  readArchivedTabs,
  readOpenTabs,
  readTabState,
  searchArchivedTabs,
  writeTabState,
  writeTabs,
} from "../store/browserDatabase";
import { browserDatabase } from "../store/database";
import type { AutoArchiveInterval, BrowserTab, TabPatch } from "./tabModels";
import {
  archiveTabs,
  clearArchive,
  closeAllPrivateTabs,
  closeAllTabs,
  closeTab,
  deleteArchived,
  emptyTabs,
  launchTabs,
  openTab,
  reopenLastClosed,
  restoreArchived,
  runAutoArchive,
  selectTab,
  updateTab,
  withArchive,
  type OpenRequest,
  type TabsChange,
  type TabsData,
} from "./tabsState";

export type TabsStore = TabsData & { incognito: boolean; listing: number };

export const useTabs = create<TabsStore>()(() => ({ ...emptyTabs(), incognito: false, listing: 0 }));

export const ARCHIVE_LIMIT = 2000;
export const ARCHIVE_SEARCH_LIMIT = 200;
export const ARCHIVE_RETENTION_MS = 90 * 24 * 3_600_000;

const now = () => Date.now();

const data = (): TabsData => useTabs.getState();

const privateStates = new Map<string, string>();

function apply(change: TabsChange) {
  const db = browserDatabase();
  const hadPrivate = useTabs.getState().privates.length > 0;
  writeTabs(db, change.put, change.remove);
  const cleared = change.clearArchived ? deleteArchivedTabs(db) : [];
  const listed = change.put.some((t) => !t.isPrivate) || change.remove.length > 0;
  useTabs.setState((s) => ({ ...change.data, listing: listed ? s.listing + 1 : s.listing }));
  endPages(change.endedPages);
  deletePageSnapshots([...change.remove, ...cleared]);
  for (const id of change.endedPages) privateStates.delete(id);
  if (hadPrivate && change.data.privates.length === 0) endPrivateSession();
}

export function tabSavedState(id: string): string | null {
  return privateStates.get(id) ?? (data().privates.some((t) => t.id === id) ? null : readTabState(browserDatabase(), id));
}

export function saveTabState(id: string, saved: string | null) {
  if (data().privates.some((t) => t.id === id)) {
    if (saved) privateStates.set(id, saved);
    else privateStates.delete(id);
    return;
  }
  if (data().open.some((t) => t.id === id)) writeTabState(browserDatabase(), id, saved);
}

export function loadTabs() {
  const db = browserDatabase();
  const expired = expiredArchivedIds(db, now() - ARCHIVE_RETENTION_MS, ARCHIVE_LIMIT);
  if (expired.length) writeTabs(db, [], expired);
  useTabs.setState({ ...launchTabs(readOpenTabs(db), countArchivedTabs(db)), incognito: false, listing: 0 });
}

export function openNewTab(request: Omit<OpenRequest, "isPrivate">): BrowserTab {
  const { change, tab } = openTab(data(), { ...request, isPrivate: useTabs.getState().incognito }, now(), newUuid());
  apply(change);
  return tab;
}

export const selectTabById = (id: string | null) => apply(selectTab(data(), id, now()));

export const closeTabById = (id: string) => apply(closeTab(data(), id, now()));

export const closeEveryTab = () => {
  apply(closeAllTabs(data(), now()));
  useTabs.setState({ incognito: false });
};

export const closePrivateTabs = () => {
  apply(closeAllPrivateTabs(data()));
  useTabs.setState({ incognito: false });
};

export function reopenClosedTab(): BrowserTab | null {
  const { change, reopened } = reopenLastClosed(data(), now());
  apply(change);
  return reopened[reopened.length - 1] ?? null;
}

export const updateTabById = (id: string, patch: TabPatch) => apply(updateTab(data(), id, patch));

export const archiveDueTabs = () => apply(runAutoArchive(data(), currentPreferences().autoArchiveInterval, now()));

export function setAutoArchiveInterval(interval: AutoArchiveInterval) {
  setPreference("autoArchiveInterval", interval);
  archiveDueTabs();
}

export const setIncognito = (incognito: boolean) => useTabs.setState({ incognito });

export const loadArchive = () => useTabs.setState(withArchive(data(), readArchivedTabs(browserDatabase(), ARCHIVE_LIMIT)));

export function searchArchive(text: string): BrowserTab[] {
  const query = text.trim();
  const archive = data().archive;
  if (!query && archive) return archive;
  return query ? searchArchivedTabs(browserDatabase(), query, ARCHIVE_SEARCH_LIMIT) : readArchivedTabs(browserDatabase(), ARCHIVE_SEARCH_LIMIT);
}

export const restoreArchivedTab = (tab: BrowserTab) => apply(restoreArchived(data(), tab, now()));

export const deleteArchivedTabsById = (ids: readonly string[]) => apply(deleteArchived(data(), ids));

export const clearArchivedTabs = () => apply(clearArchive(data()));

export const archiveTabById = (id: string) => apply(archiveTabs(data(), [id], true, now()));

export const currentTabs = data;
