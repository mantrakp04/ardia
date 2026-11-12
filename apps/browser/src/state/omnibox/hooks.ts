import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { useStoreWhile } from "../tabs/tabWatch";

export const useActiveTabIdWhile = (windowId: string, live: boolean): string | undefined =>
  useBrowser((s) => (live ? activeTabId(s, windowId) : undefined));

export const useTabHasUrlWhile = (tabId: string | undefined, live: boolean): boolean =>
  useStoreWhile(useBrowser, live, (s) => !!(tabId && s.tabs[tabId]?.url));
