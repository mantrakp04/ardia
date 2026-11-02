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
import { peekShown } from "../windows/dockMotion";
import { useToolbarAutoHide } from "../windows/toolbarAutoHide";
import { focusedWindowOf } from "../windows/ui";

export type Surface = "menu" | "rename" | "iconPicker" | "hoverCard" | "downloads" | "popover" | "panel" | "find" | "historyMenu" | "extensionPopup";
export type Held = "peek" | "toolbar" | "hover";
type Chrome = "sidebar" | "toolbar";
type Where = { windowId: string; chrome: Chrome | null; tab: (tabId: string) => boolean };
type Watch = (changed: () => void) => () => void;
type MenuOrigin = { windowId: string; sidebar: boolean; toolbarTabs: string[] };

const onBrowser: Watch = (changed) => useBrowser.subscribe(changed);
const onSidebarUi: Watch = (changed) => useSidebarUi.subscribe(changed);
const onPages: Watch = (changed) => usePages.subscribe(changed);
const onHistoryMenu: Watch = (changed) => useHistoryMenu.subscribe(changed);
const onExtensions: Watch = (changed) => useExtensions.subscribe(changed);
const browser = () => useBrowser.getState();

let menuOrigin: MenuOrigin | null = null;

function noteMenuOrigin() {
  if (!menuShown()) return void (menuOrigin = null);
  if (menuOrigin) return;
  const s = browser();
  const windowId = focusedWindowOf(s);
  if (!windowId) return;
  const toolbarTabs = Object.keys(useToolbarAutoHide.getState().peek).filter((id) => s.tabs[id]?.windowId === windowId);
  menuOrigin = { windowId, sidebar: peekShown(windowId), toolbarTabs };
}

watchMenus(noteMenuOrigin);

function menuHolds(at: Where): boolean {
  if (!menuOrigin || menuOrigin.windowId !== at.windowId) return false;
  if (at.chrome === "sidebar") return menuOrigin.sidebar;
  if (at.chrome === "toolbar") return menuOrigin.toolbarTabs.some(at.tab);
  return true;
}

const SURFACES: Record<Surface, { open: (at: Where) => boolean; watch: Watch[] }> = {
  menu: { open: menuHolds, watch: [watchMenus] },
  rename: { open: (at) => sidebarUi().renaming?.windowId === at.windowId, watch: [onSidebarUi] },
  iconPicker: { open: (at) => sidebarUi().iconPicker?.windowId === at.windowId, watch: [onSidebarUi] },
  hoverCard: { open: (at) => sidebarUi().hover?.windowId === at.windowId && pointerOnCard(), watch: [onSidebarUi] },
  downloads: { open: (at) => !!browser().windowUi[at.windowId]?.downloadsOpen, watch: [onBrowser] },
  panel: { open: (at) => !!browser().windowUi[at.windowId]?.panel.open, watch: [onBrowser] },
  popover: { open: (at) => Object.entries(usePages.getState().popover).some(([id, open]) => !!open && at.tab(id)), watch: [onPages, onBrowser] },
  find: { open: (at) => Object.entries(browser().find).some(([id, find]) => !!find?.open && at.tab(id)), watch: [onBrowser] },
  historyMenu: { open: (at) => !!useHistoryMenu.getState().menu && at.tab(useHistoryMenu.getState().menu!.tabId), watch: [onHistoryMenu] },
  extensionPopup: { open: (at) => useExtensions.getState().popup?.windowId === at.windowId, watch: [onExtensions] },
};

export const HOLDS: Record<Held, { chrome: Chrome | null; surfaces: Surface[] }> = {
  peek: { chrome: "sidebar", surfaces: ["menu", "rename", "iconPicker", "hoverCard", "downloads", "popover"] },
  toolbar: { chrome: "toolbar", surfaces: ["menu", "panel", "find", "popover", "historyMenu", "extensionPopup"] },
  hover: { chrome: null, surfaces: ["menu", "rename", "iconPicker", "downloads", "popover", "panel", "find", "historyMenu", "extensionPopup"] },
};

const noTab = () => false;

function holds(held: Held, windowId: string, tab: (tabId: string) => boolean): boolean {
  const at: Where = { windowId, chrome: HOLDS[held].chrome, tab };
  return HOLDS[held].surfaces.some((surface) => SURFACES[surface].open(at));
}

const watches = (held: Held) => [...new Set(HOLDS[held].surfaces.flatMap((s) => SURFACES[s].watch))];

export function watchHolds(held: Held, changed: () => void): () => void {
  const stops = watches(held).map((watch) => watch(changed));
  return () => stops.forEach((stop) => stop());
}

const sidebarFieldTab = (windowId: string) => {
  const s = browser();
  return addressBarInSidebar(s, windowId) ? activeTabId(s, windowId) : undefined;
};

export const peekHeld = (windowId: string) => {
  const field = sidebarFieldTab(windowId);
  return holds("peek", windowId, field ? (id) => id === field : noTab);
};

export const hoverHeld = (windowId: string) => holds("hover", windowId, (id) => browser().tabs[id]?.windowId === windowId);

export const toolbarHeld = (windowId: string, tabId: string) => holds("toolbar", windowId, (id) => id === tabId);

const watchToolbarHolds: Watch = (changed) => watchHolds("toolbar", changed);
const idle = Object.assign((_: () => void) => () => {}, { inert: true });

export const useToolbarHeld = (windowId: string, tabId: string, live: boolean) =>
  useSyncExternalStore(live ? watchToolbarHolds : idle, () => live && toolbarHeld(windowId, tabId));
