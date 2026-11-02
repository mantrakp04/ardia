import { useEffect, useMemo, useState } from "react";
import { newTabLingeringOver, successorWhenLeaving, useMountedTabIds, useShownPaneKeys, useSplitsOf, useWarmTabIds, wakePanes } from "../../state/windows/card";
import { pagerFor } from "../../state/windows/profilePager";
import { useTabDrag } from "../../state/drag/tabDrag";
import type { SplitView } from "../../state/browser/types";
import { splitGeometry, type Rect } from "./geometry";
import { splitTabIds } from "../../state/splits/splits";

const NEW_TAB_LINGER_MS = 400;

export function usePaneLayout(windowId: string, activeId: string | undefined, split: SplitView | undefined, fullscreenTab: string | undefined, size: { width: number; height: number }) {
  const mounted = useMountedTabIds(windowId);

  const mountedIds = useMemo(() => new Set(mounted), [mounted]);

  const { panes, dividers } = useMemo(() => {
    const full: Rect = { x: 0, y: 0, width: size.width, height: size.height };
    if (fullscreenTab) {
      const under = split && splitTabIds(split).includes(fullscreenTab) ? splitGeometry(split, size.width, size.height).panes : {};
      return { panes: { ...under, [fullscreenTab]: full }, dividers: [] };
    }
    if (split) return splitGeometry(split, size.width, size.height);
    return { panes: activeId ? { [activeId]: full } : {}, dividers: [] };
  }, [split, activeId, fullscreenTab, size.width, size.height]);

  useEffect(() => wakePanes(Object.keys(panes)), [panes]);

  const [linger, setLinger] = useState<{ from: string | undefined; id?: string }>({ from: activeId });
  if (linger.from !== activeId) setLinger({ from: activeId, id: fullscreenTab ? undefined : newTabLingeringOver(windowId, linger.from, activeId, mounted) });
  const lingerId = linger.from === activeId ? linger.id : undefined;
  useEffect(() => {
    if (!linger.id) return;
    const timer = setTimeout(() => setLinger((now) => (now === linger ? { from: now.from } : now)), NEW_TAB_LINGER_MS);
    return () => clearTimeout(timer);
  }, [linger]);
  const lingerRect: Rect | undefined = lingerId && size.width > 0 ? { x: 0, y: 0, width: size.width, height: size.height } : undefined;
  const shownPanes = useMemo(() => (lingerId && lingerRect ? { ...panes, [lingerId]: lingerRect } : panes), [panes, lingerId, lingerRect?.width, lingerRect?.height]);

  const pagerPages = pagerFor(windowId).state((st) => st.pages);
  const leaving = useTabDrag((d) => (d.phase === "tab" && d.windowId === windowId && (d.outside || !!(d.lifted ?? d.onPage)) ? d.tabIds : null));
  const successor = useMemo(() => (leaving ? successorWhenLeaving(leaving, windowId) : undefined), [leaving, windowId]);
  const warm = useWarmTabIds(windowId, pagerPages, successor);
  const warmSplits = useSplitsOf(warm);
  const warmPanes = useMemo(() => {
    const out: Record<string, Rect> = {};
    for (const id of warm) out[id] = { x: 0, y: 0, width: size.width, height: size.height };
    for (const v of warmSplits) Object.assign(out, splitGeometry(v, size.width, size.height).panes);
    return out;
  }, [warm, warmSplits, size.width, size.height]);

  const shown = useShownPaneKeys(mounted, shownPanes);

  return { mountedIds, panes, dividers, warmPanes, shown, lingerId: lingerRect ? lingerId : undefined, lingerRect };
}
