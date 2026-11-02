import type { BrowserState } from "../browser/store";
import { closesWindow, pinnedItemsRemain } from "../browser/model";
import { splitOf } from "../splits/splits";
import type { Tab } from "../browser/types";
import { hasPage } from "../tabs/pageSession";

export const NEW_TAB_BAR_POLICY = {
  closeTabKeyOnlyDismissesBar: true,
  dismissOnWindowDeactivation: true,
  showOnceOverNewEmptyWindow: true,
  showOnLaunch: false,
  closingLastTabLeavesEmptyWindow: true,
};

export const newTabOpensBar = (s: Pick<BrowserState, "settings">) => s.settings.newTabOpens === "commandBar";

export function isEmptyCardTab(s: Pick<BrowserState, "splits">, tab: Tab | undefined): tab is Tab {
  return !!tab && !tab.pin && !tab.url && !hasPage(tab) && !splitOf(s as BrowserState, tab.id);
}

export const hiddenEmptyCard = (s: BrowserState, tab: Tab) => !tab.pin && newTabOpensBar(s) && isEmptyCardTab(s, tab);

let lastTabKeepsWindow = false;
export const setLastTabKeepsWindow = (keeps: boolean) => void (lastTabKeepsWindow = keeps);

export function leavesEmptyWindow(s: BrowserState, id: string): boolean {
  const tab = s.tabs[id];
  const w = tab && s.windows[tab.windowId];
  if (!w || w.kind === "small") return false;
  if (lastTabKeepsWindow) return closesWindow(s, id);
  if (!isEmptyCardTab(s, tab) && pinnedItemsRemain(s, id)) return closesWindow(s, id);
  if (!NEW_TAB_BAR_POLICY.closingLastTabLeavesEmptyWindow || !newTabOpensBar(s)) return false;
  if (w.kind === "private" || isEmptyCardTab(s, tab)) return false;
  return closesWindow(s, id);
}
