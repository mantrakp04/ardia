import { useCallback, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBrowser, type BrowserState } from "../browser/store";
import { watchBrowser } from "../tabs/tabWatch";
import { peekOpenedFrom, shownPageId, shownPeek, type Peek } from "./peek";
import { MAX_SPLIT_PANES, splitOf, splitTabIdsOf } from "../splits/splits";

export const usePeeks = <T>(select: (peeks: BrowserState["peeks"]) => T): T => useBrowser((s) => select(s.peeks));

export function useWindowPeeks(windowId: string): Peek[] {
  return useBrowser(
    useShallow((s) =>
      Object.values(s.peeks)
        .filter((peek) => s.tabs[peek.tabId]?.windowId === windowId)
        .sort((a, b) => (a.tabId < b.tabId ? -1 : 1)),
    ),
  );
}

export const useShownPageId = (windowId: string) => useBrowser((s) => shownPageId(s, windowId));

export const usePeekSplitFull = (windowId: string) =>
  useBrowser((s) => {
    const source = shownPeek(s, windowId)?.sourceId;
    return (splitTabIdsOf(splitOf(s, source))?.length ?? 0) >= MAX_SPLIT_PANES;
  });

const peekMarkWatchers = new Map<string, Set<() => void>>();
let watchingPeekMarks = false;

function wakePeekMarks(s: BrowserState, prev: BrowserState) {
  if (s.peeks === prev.peeks && s.tabs === prev.tabs) return;
  const sources = new Set<string>();
  for (const peek of Object.values(prev.peeks)) sources.add(peek.sourceId);
  for (const peek of Object.values(s.peeks)) sources.add(peek.sourceId);
  for (const id of sources) {
    const listeners = peekMarkWatchers.get(id);
    if (listeners && peekOpenedFrom(s, id) !== peekOpenedFrom(prev, id)) for (const listener of [...listeners]) listener();
  }
}

export function watchPeekOpenedFrom(sourceTabId: string, listener: () => void): () => void {
  if (!watchingPeekMarks) {
    watchingPeekMarks = true;
    watchBrowser(wakePeekMarks);
  }
  let listeners = peekMarkWatchers.get(sourceTabId);
  if (!listeners) peekMarkWatchers.set(sourceTabId, (listeners = new Set()));
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && peekMarkWatchers.get(sourceTabId) === listeners) peekMarkWatchers.delete(sourceTabId);
  };
}

export function usePeekOpenedFrom(sourceTabId: string): string | undefined {
  const subscribe = useCallback((listener: () => void) => watchPeekOpenedFrom(sourceTabId, listener), [sourceTabId]);
  return useSyncExternalStore(subscribe, () => peekOpenedFrom(useBrowser.getState(), sourceTabId));
}
