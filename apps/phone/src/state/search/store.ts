import { create } from "zustand";
import { history } from "../history/store";
import { currentPreferences } from "../settings/store";
import { currentTabs, useTabs } from "../tabs/store";
import { idleMacTabs, macTabIndex, mergeSyncedHistory, syncedBookmarks } from "../sync/spaces";
import { selectedProfile, syncData } from "../sync/store";
import { idleRows, remoteSuggestions, setSearchEngine, setSources, setSyncedSearch, suggest, type SuggestContext, type TrayRow } from "./omnibox";
import { buildSources, recentSearches, sourcesKey } from "./sources";

export type SearchOrigin = "home" | "start" | "page";

type SearchState = {
  open: boolean;
  origin: SearchOrigin;
  initialText: string;
  text: string;
  rows: TrayRow[];
  session: number;
  incognitoOnCancel: boolean | null;
};

export const useSearch = create<SearchState>()(() => ({
  open: false,
  origin: "home",
  initialText: "",
  text: "",
  rows: [],
  session: 0,
  incognitoOnCancel: null,
}));

let remote: { text: string; values: string[] } = { text: "", values: [] };
let inFlight: AbortController | null = null;
let fedSources = "";
let context: SuggestContext = { currentUrl: null, currentTabId: null };

export function feedSources() {
  const key = sourcesKey(useTabs.getState().listing, history().revision(), syncData().revision);
  if (key === fedSources) return;
  fedSources = key;
  const profile = selectedProfile();
  const local = history().summary();
  setSources(buildSources(currentTabs().open, profile ? mergeSyncedHistory(local, profile.history) : local, profile ? syncedBookmarks(profile) : []));
}

function rowsFor(text: string, remoteValues: readonly string[]): TrayRow[] {
  const profile = selectedProfile();
  if (text.trim()) return suggest(text, remoteValues, context, macTabIndex(profile, syncData().view.devices)).rows;
  return useTabs.getState().incognito ? [] : idleRows(recentSearches(history().summary()), idleMacTabs(profile, syncData().view.devices));
}

export const refreshSearchRows = () => useSearch.setState((state) => ({ rows: rowsFor(state.text, []) }));

export function applySearchEngine() {
  const { status, view } = syncData();
  if (status.isEnabled && view.search) setSyncedSearch(view.search);
  else setSearchEngine(currentPreferences().searchEngineId);
}

export function presentSearch(origin: SearchOrigin, text = "", incognitoOnCancel: boolean | null = null, page: SuggestContext | null = null) {
  inFlight?.abort();
  remote = { text: "", values: [] };
  context = page ?? { currentUrl: null, currentTabId: null };
  feedSources();
  useSearch.setState((state) => ({
    open: true,
    origin,
    initialText: text,
    text,
    rows: rowsFor(text, []),
    session: state.session + 1,
    incognitoOnCancel,
  }));
}

export function dismissSearch() {
  inFlight?.abort();
  useSearch.setState({ open: false, incognitoOnCancel: null });
}

export function typeSearch(text: string) {
  const carried = remote.text && text.startsWith(remote.text) ? remote.values : [];
  useSearch.setState({ text, rows: rowsFor(text, carried) });
  inFlight?.abort();
  if (!text.trim() || !currentPreferences().searchSuggestions) return;
  const controller = new AbortController();
  inFlight = controller;
  void remoteSuggestions(text, controller.signal).then((outcome) => {
    if (controller.signal.aborted || useSearch.getState().text !== text) return;
    remote = { text, values: outcome.values };
    useSearch.setState({ rows: rowsFor(text, outcome.values) });
  });
}

export const searchState = () => useSearch.getState();
