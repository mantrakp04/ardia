import { useBrowser, type BrowserState } from "../browser/store";
import { muteState, type MuteState } from "./mute";

export const useTabs = <T>(select: (tabs: BrowserState["tabs"]) => T): T => useBrowser((s) => select(s.tabs));

export const useMuteState = (tabId: string | undefined): MuteState =>
  useBrowser((s) => {
    const tab = tabId ? s.tabs[tabId] : undefined;
    return tab ? muteState(s, tab) : null;
  });
