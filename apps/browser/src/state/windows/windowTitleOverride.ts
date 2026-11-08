import type { BrowserState } from "../browser/store";
import { activeTab, tabTitle } from "../browser/model";
import { tabEngine } from "../engines/engines";
import { hasLoadedPage } from "../tabs/pageSession";

const NEW_TAB = "New Tab";

export function windowTitleOverride(s: BrowserState, windowId: string): string | null {
  const tab = activeTab(s, windowId);
  if (!tab) return NEW_TAB;
  if (tabEngine(s, tab.id) === "chromium" && hasLoadedPage(tab)) return null;
  return tabTitle(tab);
}
