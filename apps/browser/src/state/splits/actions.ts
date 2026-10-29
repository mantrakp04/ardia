import { showMenu, type MenuItem } from "../../platform/menus";
import { showToast } from "../app/toasts";
import { closeTab } from "../browser/actions";
import { menuShortcut } from "../commands/commandShortcuts";
import { storeAction, useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { isStacked, MAX_SPLIT_PANES, type OpenPaneOptions, splitOf, type SplitSide, splitTabIds, splitTabIdsOf } from "./splits";
import type { AdoptId } from "../browser/types";

const store = () => useBrowser.getState();

const maxedOut = (windowId: string) =>
  showToast(windowId, "Cannot Add New Pane", `Split View can show up to ${MAX_SPLIT_PANES} tabs at once.`);

export function openSplitPane(windowId: string, options: OpenPaneOptions = {}): string | null {
  const result = store().openSplitPane(windowId, options);
  if (!result.ok) {
    if (result.reason === "max") maxedOut(windowId);
    return null;
  }
  return result.tabId;
}

export const openNewTabInSplit = (windowId: string) => openSplitPane(windowId);

export function openInSplit(tabId: string, side: SplitSide = "right") {
  const tab = store().tabs[tabId];
  if (!tab) return;
  const active = activeTabId(store(), tab.windowId);
  if (!active || active === tabId) return;
  openSplitPane(tab.windowId, { tabId, anchorTabId: active, side });
}

export function openLinkInSplit(sourceTabId: string, url: string, adoptId?: AdoptId) {
  const s = store();
  const source = s.tabs[sourceTabId];
  if (!source) return;
  const split = splitOf(s, sourceTabId);
  const panes = splitTabIdsOf(split);
  const next = panes?.[panes.indexOf(sourceTabId) + 1];
  const target = panes && (next || panes.length >= MAX_SPLIT_PANES) ? (next ?? panes.at(-1)) : undefined;
  const inPlaceOf = target !== sourceTabId ? target : undefined;
  openSplitPane(source.windowId, { anchorTabId: sourceTabId, url, side: "right", background: true, adoptId, inPlaceOf });
}

export function dropTabIntoSplit(tabId: string, targetTabId: string, side: SplitSide) {
  const target = store().tabs[targetTabId];
  if (!target || tabId === targetTabId) return;
  openSplitPane(target.windowId, { tabId, anchorTabId: targetTabId, side });
}

export function closePane(tabId: string) {
  void closeTab(tabId);
}

export async function showSplitMenu(tabId: string) {
  const s = store();
  const split = splitOf(s, tabId);
  const tab = s.tabs[tabId];
  if (!split || !tab) return;
  const horizontal = split.orientation === "horizontal";
  const index = splitTabIds(split).indexOf(tabId);
  const full = splitTabIds(split).length >= MAX_SPLIT_PANES;
  const stacked = isStacked(split, tabId);
  const items: MenuItem[] = [
    { id: "add", title: horizontal ? "Add Vertical Split View" : "Add Horizontal Split View", symbol: horizontal ? "rectangle.split.2x1" : "rectangle.split.1x2", enabled: !full, ...menuShortcut("openSplitPane") },
    { id: "bottom", title: horizontal ? "Add Bottom Split" : "Add Right Split", symbol: horizontal ? "rectangle.bottomhalf.inset.filled" : "rectangle.righthalf.inset.filled", enabled: !full && !stacked },
    { separator: true },
    { id: "left", title: horizontal ? "Move Pane Left" : "Move Pane Up", symbol: "rectangle.lefthalf.inset.filled.arrow.left", enabled: index > 0 },
    { id: "right", title: horizontal ? "Move Pane Right" : "Move Pane Down", symbol: "rectangle.righthalf.inset.filled.arrow.right", enabled: index < splitTabIds(split).length - 1 },
    { id: "flip", title: "Flip Split View", symbol: horizontal ? "arrow.left.arrow.right" : "arrow.up.arrow.down" },
    { id: "convert", title: horizontal ? "Convert to Vertical Split View" : "Convert to Horizontal Split View", symbol: horizontal ? "rectangle.split.1x2" : "rectangle.split.2x1" },
    { separator: true },
    { id: "remove", title: "Remove from Split View", symbol: "rectangle.portrait.and.arrow.right" },
    { id: "separate", title: "Separate All Tabs", symbol: "rectangle.split.3x1" },
    { separator: true },
    { id: "close", title: "Close Pane", symbol: "xmark" },
  ];
  const choice = await showMenu(items);
  const st = store();
  switch (choice) {
    case "add":
      return void openSplitPane(tab.windowId, { anchorTabId: tabId, side: horizontal ? "right" : "bottom" });
    case "bottom":
      return void openSplitPane(tab.windowId, { anchorTabId: tabId, side: horizontal ? "bottom" : "right" });
    case "left":
      return st.movePane(tabId, -1);
    case "right":
      return st.movePane(tabId, 1);
    case "flip":
      return st.flipSplit(split.id);
    case "convert":
      return st.toggleSplitOrientation(split.id);
    case "remove":
      return st.removeTabFromSplit(tabId);
    case "separate":
      return st.separateSplit(split.id);
    case "close":
      return closePane(tabId);
  }
}

export const updateSplit = storeAction("updateSplit");
export const replaceSplitPane = storeAction("replaceSplitPane");
export const removeTabFromSplit = storeAction("removeTabFromSplit");
export const toggleTabLayout = storeAction("toggleTabLayout");
