import { useEffect, useMemo } from "react";
import { successorWhenLeaving, useMountedTabIds, useShownPaneKeys, useSplitsOf, useWarmTabIds, wakePanes } from "../../state/windows/card";
import { pagerFor } from "../../state/windows/profilePager";
import { useTabDrag } from "../../state/drag/tabDrag";
import type { SplitView } from "../../state/browser/types";
import { splitGeometry, type Rect } from "./geometry";

export function usePaneLayout(windowId: string, activeId: string | undefined, split: SplitView | undefined, fullscreenTab: string | undefined, size: { width: number; height: number }) {
  const mounted = useMountedTabIds(windowId);

  const mountedIds = useMemo(() => new Set(mounted), [mounted]);

  const { panes, dividers } = useMemo(() => {
    const full: Rect = { x: 0, y: 0, width: size.width, height: size.height };
    if (fullscreenTab) {
      const under = split?.tabIds.includes(fullscreenTab) ? splitGeometry(split, size.width, size.height).panes : {};
      return { panes: { ...under, [fullscreenTab]: full }, dividers: [] };
    }
    if (split) return splitGeometry(split, size.width, size.height);
    return { panes: activeId ? { [activeId]: full } : {}, dividers: [] };
  }, [split, activeId, fullscreenTab, size.width, size.height]);

  useEffect(() => wakePanes(Object.keys(panes)), [panes]);

  const pagerPages = pagerFor(windowId).state((st) => st.pages);
  const leaving = useTabDrag((d) => (d.windowId === windowId && d.tabIds.length && (d.outside || !!(d.lifted ?? d.onPage)) ? d.tabIds : null));
  const successor = useMemo(() => (leaving ? successorWhenLeaving(leaving, windowId) : undefined), [leaving, windowId]);
  const warm = useWarmTabIds(windowId, pagerPages, successor);
  const warmSplits = useSplitsOf(warm);
  const warmPanes = useMemo(() => {
    const out: Record<string, Rect> = {};
    for (const id of warm) out[id] = { x: 0, y: 0, width: size.width, height: size.height };
    for (const v of warmSplits) Object.assign(out, splitGeometry(v, size.width, size.height).panes);
    return out;
  }, [warm, warmSplits, size.width, size.height]);

  const shown = useShownPaneKeys(mounted, panes);

  return { mountedIds, panes, dividers, warmPanes, shown };
}
