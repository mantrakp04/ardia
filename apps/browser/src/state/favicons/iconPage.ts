import { faviconOutlived } from "./favicons";
import { useBrowser } from "../browser/store";
import { pageOf, patchPage } from "../tabs/pageState";

export function adoptIconPage(tabId: string) {
  if (pageOf(tabId).iconPage === null) patchPage(tabId, { iconPage: useBrowser.getState().tabs[tabId]?.url || null });
}

export function noteIconPage(tabId: string) {
  patchPage(tabId, { iconPage: useBrowser.getState().tabs[tabId]?.url || null });
}

export function dropOutlivedFavicon(tabId: string, url: string, isLoading: boolean) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!isLoading && tab?.favicon && faviconOutlived(pageOf(tabId).iconPage, url)) useBrowser.getState().updateTab(tabId, { favicon: null });
}
