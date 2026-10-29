import type { OpenWindowRequest } from "../../platform/tabs";
import { openWindow } from "../browser/actions";
import { useBrowser } from "../browser/store";
import { engineProfile, engineProfileForSpace } from "../browser/model";
import { peekSourceOf } from "../peek/peek";
import { isSmall, originalSpace, privateWindowSpace } from "../windows/small";
import { openLinkInSplit, openSplitPane } from "../splits/actions";
import { asAdoptId, isAdoptKind } from "./adoptIds";

export type { OpenWindowRequest } from "../../platform/tabs";

export function openFromPage(request: OpenWindowRequest, page: { windowId: string; spaceId: string; tabId?: string }) {
  const { url, disposition, profile: space, point } = request;
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
    if (page.tabId) s.openPeek(page.tabId, url, point ?? null);
    return;
  }
  const from = peekSource ? { ...page, tabId: peekSource } : page;
  if (isSmall(s, w.id) && disposition !== "window" && disposition !== "incognito") {
    return void s.newTab(w.id, { url, adoptId, openerId: from.tabId, spaceId: from.spaceId, background: true });
  }
  if (disposition === "split") {
    if (from.tabId) return openLinkInSplit(from.tabId, url, adoptId);
    openSplitPane(w.id, { url, adoptId });
    return;
  }
  if (disposition === "incognito") {
    const spaceId = privateWindowSpace(s, w, space);
    const incognitoEngineId = (w.kind === "private") ? w.incognitoEngineId : undefined;
    if (isAdoptKind(adoptId, "tab")) return void openWindow({ kind: "private", url, adoptId, spaceId, incognitoEngineId });
    return void openWindow({ kind: "private", url, spaceId, incognitoEngineId });
  }
  if (disposition === "window") {
    return void openWindow((w.kind === "private") ? { kind: "private", url, spaceId: originalSpace(s, w), incognitoEngineId: w.incognitoEngineId } : { spaceId: from.spaceId, url, adoptId });
  }
  const background = disposition === "background" || from.spaceId !== w.spaceId;
  s.newTab(w.id, { url, adoptId, openerId: from.tabId, spaceId: from.spaceId, background });
}

export function pageSpaceId(windowId: string, pageSpace: string): string {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (w && engineProfile(s, w.spaceId) === pageSpace) return w.spaceId;
  return s.spaceOrder.find((p) => engineProfile(s, p) === pageSpace) ?? w?.spaceId ?? s.settings.defaultSpaceId;
}
