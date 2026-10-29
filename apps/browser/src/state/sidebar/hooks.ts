import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../browser/store";
import { activeTabId, tabTitle, viewTabIds } from "../browser/model";
import { liveTabPlace } from "../live/rows";
import type { Tab } from "../browser/types";
import { cleanedTabsFor } from "../pins/closedTabs";
import { groupLabel } from "../pins/tabGrouping";
import { canTidyPins } from "../pins/tidyPins";
import { folderIn } from "../pins/tileFolders";
import { useStoreWhile } from "../tabs/tabWatch";
import { splitOf, splitRowPanes } from "../splits/splits";
import { downloadsIn } from "../downloads/downloadsSlice";
import { groupEntries, keptEntry, sidebarEntries } from "./entries";
import { groupTabIds } from "./groupPanelRows";
import { capture, type Capture } from "./listCapture";
import { pinnedCollapsed, pinnedKept } from "./pinnedFold";
import { useSidebarUi, type Hover } from "./sidebarUi";

export function useSidebarWidth(windowId: string): number {
  const saved = useBrowser((s) => s.settings.sidebarWidth);
  const dragging = useSidebarUi((u) => u.dragWidth[windowId]);
  return dragging ?? saved;
}

export const useIsInSplit = (tabId: string) => useBrowser((s) => !!splitOf(s, tabId));

export const useDragGhostLabel = (folderName: string | undefined, groupId: string | undefined, tab: Tab | undefined) =>
  useBrowser((s) => folderName ?? (groupId && s.groups[groupId] ? groupLabel(s, s.groups[groupId]!) : tab ? tabTitle(tab) : ""));

const NO_TABS: string[] = [];

export const useSplitRowPanes = (splitId: string) => useBrowser(useShallow((s) => splitRowPanes(s, s.splits[splitId])));

export const useGroupTabIds = (groupId: string) => useBrowser(useShallow((s) => s.groups[groupId]?.tabIds ?? NO_TABS));

export const useIconPickerCurrent = (kind: "tab" | "group" | "live" | "folder", id: string, liveIcon: string | null | undefined) =>
  useBrowser((s) => (kind === "tab" ? s.tabs[id]?.customIcon : kind === "live" ? liveIcon : s.groups[id]?.icon) ?? null);

export const useCapturedGroupEntries = (groupId: string, captured: Capture) =>
  useBrowser(
    useShallow((s) => {
      const list = groupEntries(s, groupId);
      return capture(captured, s, list, list);
    }),
  );

export const useCapturedSidebarEntries = (windowId: string, spaceId: string, captured: Capture) =>
  useBrowser((s) => {
    const entries = sidebarEntries(s, windowId, spaceId);
    return capture(captured, s, entries.list, entries);
  });

export const useKeptEntry = (windowId: string, spaceId: string, entries: string[]) => useBrowser((s) => keptEntry(s, windowId, spaceId, entries));

export const usePinnedCollapsed = (profileId: string) => useBrowser((s) => pinnedCollapsed(s, profileId));

export const usePinnedKept = (windowId: string, profileId: string, entries: string[]) => useBrowser((s) => pinnedKept(s, windowId, profileId, entries));

export const useGroupFirstTabIcon = (groupId: string) =>
  useBrowser(
    useShallow((s) => {
      const t = s.tabs[s.groups[groupId]?.tabIds[0] ?? ""];
      return t && { url: t.url, favicon: t.favicon, customIcon: t.customIcon, spaceId: t.spaceId };
    }),
  );

export const useHasDownloads = (windowId: string) => useBrowser((s) => downloadsIn(s, windowId).length > 0);

export const useNoTiles = (windowId: string, spaceId: string) => useBrowser((s) => sidebarEntries(s, windowId, spaceId).tiles.length === 0);

const NO_CELLS: string[] = [];

export const useSidebarCells = (windowId: string, spaceId: string, offScreen: boolean) =>
  useBrowser((s) => (offScreen ? NO_CELLS : sidebarEntries(s, windowId, spaceId).cells));

export const useCanTidyPins = (windowId: string, spaceId: string, offScreen: boolean) => useBrowser((s) => !offScreen && canTidyPins(s, windowId, spaceId));

export const useCleanedCount = (windowId: string) => useBrowser((s) => cleanedTabsFor(s, windowId).length);

export const useShownTabId = (windowId: string) => useBrowser((s) => activeTabId(s, windowId));

export const useIsShownTab = (windowId: string, tabId: string) => useBrowser((s) => activeTabId(s, windowId) === tabId);

export const useHoverOrphaned = (windowId: string, hover: Hover | null) =>
  useStoreWhile(
    useBrowser,
    !!hover,
    (s) => (hover?.kind === "tab" && !s.tabs[hover.id]) || (hover?.kind === "group" && !s.groups[hover.id]) || (hover?.kind === "folder" && !folderIn(s, windowId, hover.id)),
  );

export const useGroupPanelTabIds = (groupId: string) => useBrowser(useShallow((s) => groupTabIds(s.groups, groupId)));

export const useTabsById = (ids: string[]) => useBrowser(useShallow((s) => ids.map((id) => s.tabs[id])));

export const useClosedTabs = () => useBrowser((s) => s.closedTabs);

export const useClosedGroups = () => useBrowser((s) => s.closedGroups);

export const useLiveStrays = (windowId: string, spaceId: string, folderId: string, itemIds: Set<string>, hiddenIds: Set<string>) =>
  useBrowser(
    useShallow((s) =>
      viewTabIds(s, windowId, spaceId).filter((id) => s.tabs[id]?.liveItem?.folderId === folderId && liveTabPlace(s.tabs[id]!.liveItem!.itemId, itemIds, hiddenIds) === "stray"),
    ),
  );

export const useLiveActiveTab = (windowId: string, spaceId: string, folderId: string, itemIds: Set<string>, hiddenIds: Set<string>) =>
  useBrowser((s) => {
    const id = activeTabId(s, windowId, spaceId) ?? "";
    const liveItem = s.tabs[id]?.liveItem;
    return liveItem?.folderId === folderId && liveTabPlace(liveItem.itemId, itemIds, hiddenIds) !== "hidden" ? id : null;
  });

export const useLiveItemTab = (windowId: string, spaceId: string, folderId: string, itemId: string) =>
  useBrowser((s) => viewTabIds(s, windowId, spaceId).find((id) => s.tabs[id]?.liveItem?.itemId === itemId && s.tabs[id]?.liveItem?.folderId === folderId) ?? null);

export const useIsActiveIn = (windowId: string, spaceId: string, tabId: string | null) => useBrowser((s) => !!tabId && activeTabId(s, windowId, spaceId) === tabId);

