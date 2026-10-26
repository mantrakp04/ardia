import type { OpenWindowRequest } from "../../platform/tabs";
import { openWindow } from "../browser/actions";
import { useBrowser } from "../browser/store";
import { engineProfile } from "../browser/model";
import { peekSourceOf } from "../peek/peek";
import { isSmall, originalProfile, privateWindowProfile } from "../windows/small";
import { openLinkInSplit, openSplitPane } from "../splits/actions";

export type { OpenWindowRequest } from "../../platform/tabs";

export function openFromPage({ url, adoptId, disposition, profile, point }: OpenWindowRequest, page: { windowId: string; profileId: string; tabId?: string }) {
  const s = useBrowser.getState();
  const w = s.windows[page.windowId];
  if (!w) return;
  const peekSource = peekSourceOf(s, page.tabId);
  if (disposition === "current" || (disposition === "peek" && (peekSource || isSmall(s, w.id)))) {
    if (page.tabId) s.navigate(page.tabId, url, { userInitiated: false });
    return;
  }
  if (disposition === "peek") {
    if (page.tabId) s.openPeek(page.tabId, url, point ?? null);
    return;
  }
  const from = peekSource ? { ...page, tabId: peekSource } : page;
  if (isSmall(s, w.id) && disposition !== "window" && disposition !== "incognito") {
    return void s.newTab(w.id, { url, adoptId, openerId: from.tabId, profileId: from.profileId, background: true });
  }
  if (disposition === "split") {
    if (from.tabId) return openLinkInSplit(from.tabId, url, adoptId);
    openSplitPane(w.id, { url, adoptId });
    return;
  }
  if (disposition === "incognito") {
    const profileId = privateWindowProfile(s, w, profile);
    if (adoptId?.startsWith("tab:")) return void openWindow({ incognito: true, url, adoptId, profileId });
    return void openWindow({ incognito: true, url, profileId });
  }
  if (disposition === "window") {
    return void openWindow(w.incognito ? { incognito: true, url, profileId: originalProfile(s, w) } : { profileId: from.profileId, url, adoptId });
  }
  const background = disposition === "background" || from.profileId !== w.profileId;
  s.newTab(w.id, { url, adoptId, openerId: from.tabId, profileId: from.profileId, background });
}

export function pageProfileId(windowId: string, pageProfile: string): string {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (w && engineProfile(w.profileId) === pageProfile) return w.profileId;
  return s.profileOrder.find((p) => engineProfile(p) === pageProfile) ?? w?.profileId ?? s.settings.defaultProfileId;
}
