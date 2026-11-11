import { useBrowser, type BrowserState } from "../browser/store";
import { newTabToasts, type NewTabToast } from "./newTabToasts";
import { muteState, type MuteState } from "./mute";

export const useTabs = <T>(select: (tabs: BrowserState["tabs"]) => T): T => useBrowser((s) => select(s.tabs));

export const useMuteState = (tabId: string | undefined): MuteState =>
  useBrowser((s) => {
    const tab = tabId ? s.tabs[tabId] : undefined;
    return tab ? muteState(s, tab) : null;
  });

export const useNewTabToastItems = (): NewTabToast[] => newTabToasts.useStore((s) => s.items);

export const useNewTabToastsCovered = (windowId: string, tabId: string): boolean =>
  useBrowser((s) => !!s.peeks[windowId] || !!s.find[tabId]?.open || !!s.windowUi[windowId]?.panel.open);
