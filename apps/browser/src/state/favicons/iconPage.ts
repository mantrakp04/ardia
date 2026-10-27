import { faviconOutlived } from "./favicons";
import { useBrowser } from "../browser/store";
import { iconPageOf, setIconPage } from "../tabs/pageState";

export function adoptIconPage(tabId: string) {
  if (iconPageOf(tabId) === null) setIconPage(tabId, useBrowser.getState().tabs[tabId]?.url || null);
}

export function noteIconPage(tabId: string) {
  setIconPage(tabId, useBrowser.getState().tabs[tabId]?.url || null);
}

export function dropOutlivedFavicon(tabId: string, url: string, isLoading: boolean) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!isLoading && tab?.favicon && faviconOutlived(iconPageOf(tabId), url)) useBrowser.getState().updateTab(tabId, { favicon: null });
}
