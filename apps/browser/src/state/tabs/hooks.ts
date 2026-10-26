import { useBrowser, type BrowserState } from "../browser/store";

export const useTabs = <T>(select: (tabs: BrowserState["tabs"]) => T): T => useBrowser((s) => select(s.tabs));
