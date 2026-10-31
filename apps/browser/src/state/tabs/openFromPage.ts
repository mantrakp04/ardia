import type { OpenWindowRequest } from "../../platform/tabs";
import { openWindow } from "../browser/actions";
import { useBrowser, type BrowserState } from "../browser/store";
import { engineProfile } from "../browser/model";
import { peekSourceOf } from "../peek/peek";
import { isSmall, originalProfile, privateWindowProfile } from "../windows/small";
import { openLinkInSplit, openSplitPane } from "../splits/actions";
import { asAdoptId, isAdoptKind } from "./adoptIds";
import { openAtPlacement } from "../linkRouting/actions";
import { placeLinkFromProfile } from "../linkRouting/placement";

export type { OpenWindowRequest } from "../../platform/tabs";

export function openFromPage(request: OpenWindowRequest, page: { windowId: string; profileId: string; tabId?: string }) {
  const { url, disposition, profile, point } = request;
  const adoptId = asAdoptId(request.adoptId);
  const s = useBrowser.getState();
  const w = s.windows[page.windowId];
  if (!w) return;
  if (request.routed) return openRoutedLink(s, request, page, w);
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
    if (isAdoptKind(adoptId, "tab")) return void openWindow({ kind: "private", url, adoptId, profileId });
    return void openWindow({ kind: "private", url, profileId });
  }
  if (disposition === "window") {
    return void openWindow(w.kind === "private" ? { kind: "private", url, profileId: originalProfile(s, w) } : { profileId: from.profileId, url, adoptId });
  }
  const background = disposition === "background" || from.profileId !== w.profileId;
  s.newTab(w.id, { url, adoptId, openerId: from.tabId, profileId: from.profileId, background });
}

function openRoutedLink(s: BrowserState, request: OpenWindowRequest, page: { windowId: string; profileId: string; tabId?: string }, w: BrowserState["windows"][string]) {
  const { url, disposition } = request;
  const how = disposition === "background" ? "background" : disposition === "window" ? "window" : "foreground";
  const placement = w.kind === "private" ? null : placeLinkFromProfile(s, url, page.profileId, { windowId: w.id, tabId: page.tabId });
  if (placement) return void openAtPlacement(placement, { url, how, from: { windowId: w.id, tabId: page.tabId } });
  if (how === "foreground" && request.opens !== "tab" && page.tabId) return s.navigate(page.tabId, url, { userInitiated: true });
  if (how === "window") return void openWindow(w.kind === "private" ? { kind: "private", url, profileId: originalProfile(s, w) } : { profileId: page.profileId, url });
  s.newTab(w.id, { url, openerId: page.tabId, profileId: page.profileId, background: how === "background" });
}

export function pageProfileId(windowId: string, pageProfile: string): string {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (w && engineProfile(s, w.profileId) === pageProfile) return w.profileId;
  return s.profileOrder.find((p) => engineProfile(s, p) === pageProfile) ?? w?.profileId ?? s.settings.defaultProfileId;
}
