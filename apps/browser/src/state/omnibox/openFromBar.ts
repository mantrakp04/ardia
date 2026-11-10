import { openWindow, switchToTab } from "../browser/actions";
import { useBrowser } from "../browser/store";
import { activeTabId, viewTabIds } from "../browser/model";
import type { Tab } from "../browser/types";
import { openSplitPane } from "../splits/actions";
import { originalProfile } from "../windows/small";

export type Disposition = "current" | "newTab" | "newWindow" | "split";

export function dispositionFor(mods: { metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): Disposition {
  if (mods.altKey) return "split";
  if (mods.metaKey) return "newTab";
  if (mods.shiftKey) return "newWindow";
  return "current";
}

export function openFromBar(url: string, tabId: string, disposition: Disposition) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  if (!url || !tab) return;
  const w = s.windows[tab.windowId];
  if (disposition === "current") return s.navigate(tabId, url);
  s.closePanel(tab.windowId);
  if (disposition === "split") return void openSplitPane(tab.windowId, { anchorTabId: tabId, url, side: "right" });
  if (disposition === "newTab") return void s.newTab(tab.windowId, { url, profileId: tab.profileId, openerId: tab.url ? tabId : undefined });
  openWindow(w?.kind === "private" ? { kind: "private", url, profileId: originalProfile(s, w) } : { profileId: tab.profileId, url });
}

export function switchFromBar(targetTabId: string, url: string, barTabId: string, disposition: Disposition) {
  if (disposition !== "current") return openFromBar(url, barTabId, disposition);
  const s = useBrowser.getState();
  const bar = s.tabs[barTabId];
  if (bar) s.closePanel(bar.windowId);
  switchToTab(targetTabId);
}

export function otherOpenTabs(windowId: string, limit: number): Tab[] {
  const s = useBrowser.getState();
  const active = activeTabId(s, windowId);
  return viewTabIds(s, windowId)
    .map((id) => s.tabs[id]!)
    .filter((t) => t.id !== active && t.url)
    .slice(0, limit);
}
