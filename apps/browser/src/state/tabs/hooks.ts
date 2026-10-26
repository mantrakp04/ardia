import { useBrowser, type BrowserState } from "../browser/store";
import { newTabToasts, type NewTabToast } from "./newTabToasts";

export const useTabs = <T>(select: (tabs: BrowserState["tabs"]) => T): T => useBrowser((s) => select(s.tabs));

export const useNewTabToastItems = (): NewTabToast[] => newTabToasts.useStore((s) => s.items);

export const useNewTabToastsCovered = (windowId: string, tabId: string): boolean =>
  useBrowser((s) => !!s.peeks[windowId] || !!s.find[tabId]?.open || !!s.windowUi[windowId]?.panel.open);
