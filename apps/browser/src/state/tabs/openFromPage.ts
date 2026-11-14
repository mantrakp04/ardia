import { discardOffered, type OpenWindowRequest } from "../../platform/tabs";
import { openWindow } from "../browser/actions";
import { useBrowser } from "../browser/store";
import { engineProfile } from "../browser/model";
import { peekSourceOf } from "../peek/peek";
import { leavesSite, newTabLinkRoute, siteLanding } from "../peek/newTabLinkRoute";
import { openLittleArdia } from "../littleArdia/actions";
import { isSmall, originalProfile, privateWindowProfile } from "../windows/small";
import { openLinkInSplit, openSplitPane } from "../splits/actions";
import { asAdoptId, isAdoptKind } from "./adoptIds";
import { gateOpening, isGatedUrl, settleOpening } from "./openingGate";
import { noteBackgroundTab } from "./newTabNotice";
import { noteLinkTabWait } from "../telemetry/usage";

export type { OpenWindowRequest } from "../../platform/tabs";

type PageRef = { windowId: string; profileId: string; tabId?: string };

const UNGATED = new Set(["current", "peek", "incognito"]);

export function openFromPage(request: OpenWindowRequest, page: PageRef) {
  if (request.linkWait) noteLinkTabWait(request.linkWait);
  if (UNGATED.has(request.disposition) || !isGatedUrl(request.url)) return openNow(request, page, false);
  const gated = gateOpening(request.url, { tabId: page.tabId ?? null, windowId: page.windowId, profileId: page.profileId, via: "link" }, null);
  settleOpening(gated, null, (verdict) => {
    if (verdict && "cancel" in verdict) {
      if (request.adoptId) void discardOffered(request.adoptId).catch(() => false);
      return;
    }
    if (!verdict) return openNow(request, page, true);
    const adoptId = asAdoptId(request.adoptId);
    if (!adoptId) return openNow({ ...request, url: verdict.url }, page, true);
    openNow(request, page, true);
    const s = useBrowser.getState();
    const tabId = Object.keys(s.tabs).find((id) => {
      const p = s.tabs[id]!.page;
      return p.kind === "adopted" && p.adopt === adoptId;
    });
    if (tabId) s.navigate(tabId, verdict.url, { userInitiated: false, gated: true });
  });
}

function openNow(request: OpenWindowRequest, page: PageRef, gated: boolean) {
  const { url, disposition, profile, point } = request;
  const adoptId = asAdoptId(request.adoptId);
  const s = useBrowser.getState();
  const w = s.windows[page.windowId];
  if (!w) return;
  const peekSource = peekSourceOf(s, page.tabId);
  if (disposition === "current" || (disposition === "peek" && (peekSource || isSmall(s, w.id)))) {
    if (page.tabId) s.navigate(page.tabId, url, { userInitiated: false });
    return;
  }
  if (disposition === "peek") {
    if (!page.tabId) return;
    const pageUrl = s.tabs[page.tabId]?.url ?? "";
    if (request.site && (w.kind !== "main" || !leavesSite(url, pageUrl))) return void s.navigate(page.tabId, url, { userInitiated: false });
    s.openPeek(page.tabId, url, point ?? null, request.site ? { landing: siteLanding(pageUrl, "source") } : {});
    return;
  }
  const from = peekSource ? { ...page, tabId: peekSource } : page;
  if (isSmall(s, w.id) && disposition !== "window" && disposition !== "incognito") {
    return void s.newTab(w.id, { url, adoptId, openerId: from.tabId, profileId: from.profileId, background: true, gated });
  }
  if (disposition === "foreground" && request.fromClick && isAdoptKind(adoptId, "ardiacore") && page.tabId) {
    const route = newTabLinkRoute(s, page.tabId, url);
    if (route === "peek") return void s.openPeek(page.tabId, url, point ?? null, { adoptId });
    if (route === "otherSite") return void s.openPeek(page.tabId, url, point ?? null, { adoptId, landing: siteLanding(s.tabs[page.tabId]!.url, "tab") });
    if (route === "littleArdia") return void openLittleArdia(url, from.profileId, adoptId);
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
  const opened = s.newTab(w.id, { url, adoptId, openerId: from.tabId, profileId: from.profileId, background, gated });
  if (background) noteBackgroundTab(w.id, opened, page.tabId);
}

export function pageProfileId(windowId: string, pageProfile: string): string {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (w && engineProfile(s, w.profileId) === pageProfile) return w.profileId;
  return s.profileOrder.find((p) => engineProfile(s, p) === pageProfile) ?? w?.profileId ?? s.settings.defaultProfileId;
}
