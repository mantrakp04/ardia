import { openWindow, switchToTab } from "../../lib/actions";
import { useBrowser } from "../../store/browser";
import { originalProfile } from "../../store/small";
import { paneToReuse } from "../../store/splits";
import { openSplitPane } from "../layout/splitActions";
import type { Disposition } from "./disposition";

export { dispositionFor, type Disposition } from "./disposition";

export function openFromBar(url: string, tabId: string, disposition: Disposition): boolean {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  if (!url || !tab) return false;
  const w = s.windows[tab.windowId];
  if (disposition === "current" || (disposition === "split" && !tab.url)) {
    s.navigate(tabId, url);
    return true;
  }
  if (disposition === "split") {
    if (!openBesideInSplit(tabId, url)) return false;
    useBrowser.getState().closePanel(tab.windowId);
    return true;
  }
  s.closePanel(tab.windowId);
  if (disposition === "newTab" || disposition === "background")
    s.newTab(tab.windowId, { url, profileId: tab.profileId, openerId: tab.url ? tabId : undefined, background: disposition === "background" });
  else openWindow(w?.incognito ? { incognito: true, url, profileId: originalProfile(s, w) } : { profileId: tab.profileId, url });
  return true;
}

function openBesideInSplit(tabId: string, url: string): boolean {
  const s = useBrowser.getState();
  const reuse = paneToReuse(s, tabId);
  if (!reuse) return openSplitPane(s.tabs[tabId]!.windowId, { anchorTabId: tabId, url, side: "right" }) !== null;
  s.navigate(reuse, url);
  s.activate(reuse);
  return true;
}

export function switchFromBar(targetTabId: string, url: string, barTabId: string, disposition: Disposition) {
  const s = useBrowser.getState();
  const bar = s.tabs[barTabId];
  const target = s.tabs[targetTabId];
  if (disposition === "split" && bar?.url && target?.windowId === bar.windowId && targetTabId !== barTabId) {
    if (!openSplitPane(bar.windowId, { tabId: targetTabId, anchorTabId: barTabId, side: "right" })) return;
    return useBrowser.getState().closePanel(bar.windowId);
  }
  if (disposition !== "current") return void openFromBar(url, barTabId, disposition);
  if (bar) s.closePanel(bar.windowId);
  switchToTab(targetTabId);
}
