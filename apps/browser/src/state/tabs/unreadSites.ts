import { hostOf } from "@ardia/core";
import type { Settings } from "../settings/settings";
import type { Tab } from "../browser/types";
import { useBrowser } from "../browser/store";
import { isIncognitoProfile } from "../browser/model";

export type UnreadSiteSettings = Pick<Settings, "showUnreadCounts" | "unreadHiddenSites">;

const HOST_CACHE_LIMIT = 512;
const hosts = new Map<string, string>();

function cachedHost(url: string): string {
  let host = hosts.get(url);
  if (host === undefined) {
    if (hosts.size >= HOST_CACHE_LIMIT) hosts.clear();
    host = hostOf(url);
    hosts.set(url, host);
  }
  return host;
}

export function isUnreadSiteHidden(settings: UnreadSiteSettings, url: string): boolean {
  if (!url || !settings.unreadHiddenSites?.length) return false;
  const host = cachedHost(url);
  return !!host && settings.unreadHiddenSites.includes(host);
}

export const isUnreadShown = (settings: UnreadSiteSettings, url: string): boolean =>
  settings.showUnreadCounts !== false && !isUnreadSiteHidden(settings, url);

export const unreadSiteTitle = (hidden: boolean) => (hidden ? "Show Unread Count" : "Hide Unread Count");

export const ALL_UNREAD_TITLE = "Show Unread Counts";

export const showUnreadCounts = (shown: boolean) => useBrowser.getState().updateSettings({ showUnreadCounts: shown });

export const canChooseSiteUnread = (tab: Pick<Tab, "url" | "profileId">) => !!tab.url && !!hostOf(tab.url) && !isIncognitoProfile(tab.profileId);

export function setSiteUnreadShown(url: string, shown: boolean) {
  const host = hostOf(url);
  if (!host) return;
  const s = useBrowser.getState();
  const sites = s.settings.unreadHiddenSites;
  if (shown === !sites.includes(host)) return;
  s.updateSettings({ unreadHiddenSites: shown ? sites.filter((site) => site !== host) : [...sites, host] });
}

export function toggleSiteUnread(tabId: string) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!tab || !canChooseSiteUnread(tab)) return;
  setSiteUnreadShown(tab.url, isUnreadSiteHidden(useBrowser.getState().settings, tab.url));
}

export const hiddenUnreadSiteCount = (settings: UnreadSiteSettings): number => settings.unreadHiddenSites?.length ?? 0;
