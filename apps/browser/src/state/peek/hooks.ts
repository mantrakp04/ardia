import { useBrowser, type BrowserState } from "../browser/store";
import { peekOpenedFrom, shownPageId } from "./peek";
import { MAX_SPLIT_PANES, splitOf, splitTabIdsOf } from "../splits/splits";

export const usePeeks = <T>(select: (peeks: BrowserState["peeks"]) => T): T => useBrowser((s) => select(s.peeks));

export const useShownPageId = (windowId: string) => useBrowser((s) => shownPageId(s, windowId));

export const usePeekSplitFull = (windowId: string) =>
  useBrowser((s) => {
    const source = s.peeks[windowId]?.sourceId;
    return (splitTabIdsOf(splitOf(s, source))?.length ?? 0) >= MAX_SPLIT_PANES;
  });

export const usePeekOpenedFrom = (sourceTabId: string) => useBrowser((s) => peekOpenedFrom(s, sourceTabId));
