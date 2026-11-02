import {
  buildSuggestions,
  createSuggestFetcher,
  engineById,
  findBang,
  prepareSuggestions,
  type SearchEngine,
  type SearchScope,
  type SuggestionResult,
} from "@ardia/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { bookmarksByUrl } from "../../state/bookmarks/bookmarks";
import { useMenuBarRevision } from "../../state/commands/commandShortcuts";
import { useSettings } from "../../state/browser/hooks";
import { useBookmarkEngine, useBookmarks } from "../../state/bookmarks/hooks";
import { useProfileHistory } from "../../state/history/hooks";
import { useTabs } from "../../state/tabs/hooks";
import { defaultSearchEngine, searchEngines } from "../../state/settings/settings";
import type { Bookmarks } from "../../state/browser/types";
import { currentBarActions } from "../../state/omnibox/barActions";
import { useBangs } from "../../state/omnibox/bangs";
import { useBarExtensions } from "./extensions";
import { historyHosts } from "../../state/omnibox/knownHosts";

const NO_REMOTE: string[] = [];
const EMPTY: SuggestionResult = { items: [], completion: "" };
const WARM_SLICE_MS = 4;

type BookmarkRow = { url: string; title: string; favicon: string | null };
const bookmarkCache = new WeakMap<Bookmarks, Map<string, BookmarkRow[]>>();

function engineBookmarks(b: Bookmarks, engine: string): BookmarkRow[] {
  let perEngine = bookmarkCache.get(b);
  if (!perEngine) bookmarkCache.set(b, (perEngine = new Map()));
  let rows = perEngine.get(engine);
  if (!rows) {
    rows = [];
    for (const [url, ids] of bookmarksByUrl(b, engine)) {
      const node = b.nodes[ids[0]!];
      if (node?.kind === "url") rows.push({ url, title: node.title, favicon: node.favicon });
    }
    perEngine.set(engine, rows);
  }
  return rows;
}

function suggestEngine(scope: SearchScope | null, engines: SearchEngine[], fallback: SearchEngine): SearchEngine {
  return scope?.kind === "engine" ? engineById(engines, scope.engineId) : fallback;
}

export function useSuggestions({
  text,
  active,
  windowId,
  profileId,
  currentTabId,
  currentUrl,
  scope,
  preventInline,
}: {
  text: string;
  active: boolean;
  windowId: string;
  profileId: string;
  currentTabId?: string;
  currentUrl?: string;
  scope: SearchScope | null;
  preventInline?: boolean;
}): SuggestionResult {
  const allTabs = useTabs((tabs) => tabs);
  const history = useProfileHistory(profileId);
  const bookmarks = useBookmarks((b) => b);
  const bookmarkEngine = useBookmarkEngine(windowId);
  const engines = useSettings((st) => searchEngines(st));
  const engine = useSettings((st) => defaultSearchEngine(st));
  const preference = useSettings((st) => st.commandBarPreference);
  const suggestionsOn = useSettings((st) => st.searchSuggestions);
  const extensions = useBarExtensions(windowId);
  const shortcuts = useSettings((st) => st.shortcuts);
  const menuBar = useMenuBarRevision();

  const tabs = useMemo(() => Object.values(allTabs).filter((t) => t.profileId === profileId), [allTabs, profileId]);
  const bookmarkRows = useMemo(() => engineBookmarks(bookmarks, bookmarkEngine), [bookmarks, bookmarkEngine]);
  const source = useMemo(() => ({ tabs, history, bookmarks: bookmarkRows }), [tabs, history, bookmarkRows]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      timer = prepareSuggestions(source, Date.now() + WARM_SLICE_MS) ? undefined : setTimeout(step, 16);
      if (!timer) historyHosts(source.history);
    };
    timer = setTimeout(step, 0);
    return () => clearTimeout(timer);
  }, [source]);

  const [remote, setRemote] = useState<{ text: string; list: string[] }>({ text: "", list: [] });
  const fetcher = useRef(createSuggestFetcher({ fetch: (url, init) => fetch(url, init) })).current;
  const query = text.trim();
  const fromEngine = suggestEngine(scope, engines, engine);
  const bangs = useBangs(active && !scope && query.includes("!"));
  const bang = useMemo(() => (bangs ? findBang(query, bangs) : null), [bangs, query]);
  useEffect(() => {
    const q = query.replace(/^\?/, "").trim();
    if (!active || !suggestionsOn || !q || bang || /^[a-z][a-z0-9+.-]*:\/\//i.test(q) || scope?.kind === "history") {
      fetcher.cancel();
      return;
    }
    fetcher.request(fromEngine, q, (list) => setRemote({ text: query, list }));
  }, [active, suggestionsOn, query, bang, fromEngine, scope, fetcher]);
  useEffect(() => () => fetcher.cancel(), [fetcher]);

  const remoteList = useMemo(() => {
    if (remote.text === query) return remote.list;
    const q = query.toLowerCase();
    if (!remote.text || !q.startsWith(remote.text.toLowerCase())) return NO_REMOTE;
    return remote.list.filter((s) => s.toLowerCase().startsWith(q));
  }, [remote, query]);

  return useMemo(() => {
    if (!active || !query) return EMPTY;
    return buildSuggestions(text, source, {
      engine,
      preference,
      remote: remoteList,
      actions: currentBarActions(windowId),
      extensions,
      currentTabId,
      currentUrl,
      scope,
      preventInline,
      bangs,
    });
  }, [active, text, query, source, engine, preference, remoteList, windowId, extensions, shortcuts, menuBar, currentTabId, currentUrl, scope, preventInline, bangs]);
}
