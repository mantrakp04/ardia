import { useSyncExternalStore } from "react";
import { menuShown, watchMenus } from "../../platform/menus";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { useExtensions } from "../extensions/store";
import { pointerOnCard } from "../sidebar/hover";
import { sidebarUi, useSidebarUi } from "../sidebar/sidebarUi";
import { useHistoryMenu } from "../tabs/navigation";
import { usePages } from "../tabs/pageState";
import { addressBarInSidebar } from "../windows/layout";

export type Surface = "menu" | "rename" | "iconPicker" | "hoverCard" | "downloads" | "popover" | "panel" | "find" | "historyMenu" | "extensionPopup";
export type Held = "peek" | "toolbar" | "hoverCard" | "hoverStart";
type Reach = "thisWindow" | "anyWindow";
type Where = { windowId: string | null; tabId: string | undefined };
type Watch = (changed: () => void) => () => void;

const onBrowser: Watch = (changed) => useBrowser.subscribe(changed);
const onSidebarUi: Watch = (changed) => useSidebarUi.subscribe(changed);
const onPages: Watch = (changed) => usePages.subscribe(changed);
const onHistoryMenu: Watch = (changed) => useHistoryMenu.subscribe(changed);
const onExtensions: Watch = (changed) => useExtensions.subscribe(changed);
const inWindow = (windowId: string | undefined, at: Where) => !!windowId && (at.windowId === null || windowId === at.windowId);
const browser = () => useBrowser.getState();

const SURFACES: Record<Surface, { open: (at: Where) => boolean; watch: Watch[] }> = {
  menu: { open: () => menuShown(), watch: [watchMenus] },
  rename: { open: (at) => inWindow(sidebarUi().renaming?.windowId, at), watch: [onSidebarUi] },
  iconPicker: { open: (at) => inWindow(sidebarUi().iconPicker?.windowId, at), watch: [onSidebarUi] },
  hoverCard: { open: (at) => inWindow(sidebarUi().hover?.windowId, at) && pointerOnCard(), watch: [onSidebarUi] },
  downloads: { open: (at) => !!at.windowId && !!browser().windowUi[at.windowId]?.downloadsOpen, watch: [onBrowser] },
  panel: { open: (at) => !!at.windowId && !!browser().windowUi[at.windowId]?.panel.open, watch: [onBrowser] },
  popover: { open: (at) => !!at.tabId && !!usePages.getState().popover[at.tabId], watch: [onPages, onBrowser] },
  find: { open: (at) => !!at.tabId && !!browser().find[at.tabId]?.open, watch: [onBrowser] },
  historyMenu: { open: (at) => !!at.tabId && useHistoryMenu.getState().menu?.tabId === at.tabId, watch: [onHistoryMenu] },
  extensionPopup: { open: (at) => inWindow(useExtensions.getState().popup?.windowId, at), watch: [onExtensions] },
};

export const HOLDS: Record<Held, Partial<Record<Surface, Reach>>> = {
  peek: { menu: "anyWindow", rename: "thisWindow", iconPicker: "thisWindow", hoverCard: "thisWindow", downloads: "thisWindow", popover: "thisWindow", historyMenu: "thisWindow" },
  toolbar: { panel: "thisWindow", find: "thisWindow", popover: "thisWindow", historyMenu: "thisWindow", extensionPopup: "thisWindow" },
  hoverCard: { panel: "thisWindow", rename: "anyWindow", iconPicker: "anyWindow" },
  hoverStart: { panel: "thisWindow" },
};

export function holds(held: Held, windowId: string, tabId?: string): boolean {
  for (const [surface, reach] of Object.entries(HOLDS[held]) as [Surface, Reach][]) {
    if (SURFACES[surface].open(reach === "anyWindow" ? { windowId: null, tabId: undefined } : { windowId, tabId })) return true;
  }
  return false;
}

const watches = (held: Held) => [...new Set((Object.keys(HOLDS[held]) as Surface[]).flatMap((s) => SURFACES[s].watch))];

export function watchHolds(held: Held, changed: () => void): () => void {
  const stops = watches(held).map((watch) => watch(changed));
  return () => stops.forEach((stop) => stop());
}

const sidebarFieldTab = (windowId: string) => {
  const s = browser();
  return addressBarInSidebar(s, windowId) ? activeTabId(s, windowId) : undefined;
};

export const peekHeld = (windowId: string) => holds("peek", windowId, sidebarFieldTab(windowId));

const watchToolbarHolds: Watch = (changed) => watchHolds("toolbar", changed);
const idle = Object.assign((_: () => void) => () => {}, { inert: true });

export const useToolbarHeld = (windowId: string, tabId: string, live: boolean) =>
  useSyncExternalStore(live ? watchToolbarHolds : idle, () => live && holds("toolbar", windowId, tabId));
