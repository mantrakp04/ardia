import type { BrowserState } from "./browser";
import { closesWindow } from "./model";
import { splitOf } from "./splits";
import type { Tab } from "./types";

export const NEW_TAB_BAR_POLICY = {
  pickGoesToTopOfList: true,
  closeTabKeyOnlyDismissesBar: true,
  dismissOnWindowDeactivation: true,
  showOnceOverNewEmptyWindow: true,
  showOnLaunch: false,
  closingLastTabLeavesEmptyWindow: true,
};

export const newTabOpensBar = (s: Pick<BrowserState, "settings">) => s.settings.newTabOpens === "commandBar";

export function isEmptyCardTab(s: Pick<BrowserState, "splits">, tab: Tab | undefined): tab is Tab {
  return !!tab && !tab.pinned && !tab.url && !tab.navigation && !tab.adoptId && !splitOf(s as BrowserState, tab.id);
}

export const hiddenEmptyCard = (s: BrowserState, tab: Tab) => !tab.pinned && newTabOpensBar(s) && isEmptyCardTab(s, tab);

let lastTabKeepsWindow = false;
export const setLastTabKeepsWindow = (keeps: boolean) => void (lastTabKeepsWindow = keeps);

export function leavesEmptyWindow(s: BrowserState, id: string): boolean {
  const tab = s.tabs[id];
  const w = tab && s.windows[tab.windowId];
  if (!w || w.kind === "small") return false;
  if (lastTabKeepsWindow) return closesWindow(s, id);
  if (!NEW_TAB_BAR_POLICY.closingLastTabLeavesEmptyWindow || !newTabOpensBar(s)) return false;
  if (w.incognito || isEmptyCardTab(s, tab)) return false;
  return closesWindow(s, id);
}
