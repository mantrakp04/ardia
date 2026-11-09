import type { Shortcut } from "../commands/shortcuts";
import { storeAction, useBrowser } from "../browser/store";
import { tabLayoutOf } from "../browser/model";
import { isRegularWindow } from "../windows/small";
import { choose } from "./settings";

export const updateSettings = storeAction("updateSettings");
export const setSearchEngine = storeAction("setSearchEngine");
export const addCustomEngine = storeAction("addCustomEngine");
export const updateCustomEngine = storeAction("updateCustomEngine");
export const removeCustomEngine = storeAction("removeCustomEngine");

export function setShortcutOverride(id: string, combo: Shortcut | null) {
  const next = { ...useBrowser.getState().settings.shortcuts };
  if (combo) next[id] = [combo.key, ...combo.modifiers];
  else delete next[id];
  useBrowser.getState().updateSettings({ shortcuts: next });
}

export function chooseTabLayout(layout: "sidebar" | "top") {
  useBrowser.getState().updateSettings({ tabLayout: layout });
  for (const id of Object.keys(useBrowser.getState().windows)) {
    if (tabLayoutOf(useBrowser.getState(), id) !== layout) useBrowser.getState().toggleTabLayout(id);
  }
}

export function chooseAutoHideTabs(on: boolean) {
  useBrowser.setState((s) => ({
    ...choose(s, { autoHideTabs: on }),
    windows: Object.fromEntries(Object.entries(s.windows).map(([id, w]) => [id, isRegularWindow(w) && w.sidebarOpen === on ? { ...w, sidebarOpen: !on } : w])),
  }));
}

export function chooseSidebarSide(side: "left" | "right") {
  useBrowser.getState().updateSettings({ sidebarSide: side });
}

export function toggleSidebarSide() {
  chooseSidebarSide(useBrowser.getState().settings.sidebarSide === "right" ? "left" : "right");
}
