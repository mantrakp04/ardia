import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../browser/store";
import { splitTabIds, splitTabIdsOf } from "./splits";

export const useDragFallbackPane = (dragging: string | null | undefined, panes: Record<string, unknown>, windowId: string) =>
  useBrowser((s) => {
    if (!dragging || Object.keys(panes).length !== 1 || !panes[dragging]) return null;
    const tab = s.tabs[dragging];
    const others = (s.windows[windowId]?.tabIds ?? []).map((id) => s.tabs[id]!).filter((t) => t && t.id !== dragging && t.profileId === tab?.profileId);
    return others.sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]?.id ?? null;
  });

export const useSplitSuggestions = (tabId: string) =>
  useBrowser(
    useShallow((s) => {
      const tab = s.tabs[tabId];
      const w = tab && s.windows[tab.windowId];
      if (!w) return [];
      const inSplit = new Set(splitTabIdsOf(Object.values(s.splits).find((v) => splitTabIds(v).includes(tabId))) ?? [tabId]);
      return w.tabIds
        .map((id) => s.tabs[id]!)
        .filter((t) => t && t.url && t.profileId === tab.profileId && !inSplit.has(t.id))
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
        .slice(0, 5)
        .map((t) => t.id);
    }),
  );
