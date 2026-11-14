import { typedSubmission } from "../../lib/url";
import { pinKeyOf } from "../browser/model";
import { focus, openWindow } from "../browser/actions";
import { useBrowser, type BrowserState } from "../browser/store";
import type { NewTabTarget } from "../browser/types";
import type { Disposition } from "../omnibox/openFromBar";
import { openAtNewTabTarget } from "../omnibox/newTabBar";
import { gateOpening, settleOpening, type OpeningContext, type OpeningVia } from "../tabs/openingGate";
import { navigationOf } from "../tabs/pageSession";
import { noteAirTrafficLink } from "../telemetry/airTrafficCounts";
import { isRegularWindow, isSmall, mainWindowFor } from "../windows/small";
import { groupWindow } from "./groups";
import { placeInside, type InsidePlacement, type InsideSource } from "./inside";
import { currentAirTraffic } from "./store";

const store = () => useBrowser.getState();

export type PlacedOpen = {
  url: string;
  how: "foreground" | "background" | "window";
  from?: { windowId: string; tabId?: string };
  gated?: boolean;
  via?: OpeningVia;
  pointer?: [number, number];
};

export function openAtPlacement(placement: InsidePlacement, open: PlacedOpen): void {
  if (!open.gated) {
    const context: OpeningContext = { tabId: open.from?.tabId ?? null, windowId: open.from?.windowId ?? null, profileId: placement.profileId, via: open.via ?? "typed" };
    return void settleOpening(gateOpening(open.url, context, null), null, (verdict) =>
      verdict && "cancel" in verdict ? undefined : openAtPlacement(placement, { ...open, url: verdict?.url ?? open.url, gated: true }),
    );
  }
  const background = open.how === "background";
  const { profileId, groupKey } = placement;
  if (placement.open === "littleArdia" && open.how !== "window") {
    store().createWindow({ kind: "small", url: open.url, profileId, linkPointer: open.pointer, background });
    return;
  }
  const s = store();
  const fromMain = open.from && isRegularWindow(s.windows[open.from.windowId]) ? open.from.windowId : undefined;
  const groupHome = groupKey ? groupWindow(s, profileId, groupKey) : undefined;
  const ownWindow = open.how === "window" || placement.open === "window" || (!!groupKey && !groupHome);
  let target = ownWindow ? undefined : (groupHome ?? fromMain ?? mainWindowFor(s, profileId));
  let tabId: string;
  const blank = target ? blankTabOf(s, target, profileId) : undefined;
  if (!target) {
    target = openWindow({ url: open.url, profileId, background });
    tabId = store().windows[target]?.activeTabIds[profileId] ?? "";
  } else if (blank && !background) {
    s.navigate(blank, open.url, { gated: true });
    tabId = blank;
  } else {
    const source = open.from?.tabId ? s.tabs[open.from.tabId] : undefined;
    const openerId = source?.profileId === profileId && source.windowId === target ? source.id : undefined;
    tabId = s.newTab(target, { url: open.url, profileId, background, openerId, gated: true });
  }
  if (groupKey && tabId && joinGroup(tabId, profileId, groupKey)) noteAirTrafficLink("group");
  if (!background && target !== open.from?.windowId) focus(target);
}

function blankTabOf(s: BrowserState, windowId: string, profileId: string): string | undefined {
  const w = s.windows[windowId];
  const only = w && w.tabIds.length === 1 ? s.tabs[w.tabIds[0]!] : undefined;
  return only && !only.url && !navigationOf(only) && only.profileId === profileId && !s.windowUi[windowId]?.panel.open ? only.id : undefined;
}

function joinGroup(tabId: string, profileId: string, groupKey: string): boolean {
  const s = store();
  const tab = s.tabs[tabId];
  const group = tab && Object.values(s.groups).find((g) => g.windowId === tab.windowId && g.profileId === profileId && pinKeyOf(g) === groupKey);
  if (!group) return false;
  s.addTabsToGroup(group.id, [tabId]);
  if (group.collapsed) store().updateGroup(group.id, { collapsed: false });
  return true;
}

export const isTypedSearch = (text: string): boolean => typedSubmission(text) === "search";

export type TypedFrom = { windowId: string; tabId?: string; disposition: Disposition; newTab?: NewTabTarget };

export function routeTypedUrl(url: string, from: TypedFrom): boolean {
  const s = store();
  const w = s.windows[from.windowId];
  if (!w || w.kind === "private") return false;
  const profileId = (from.tabId ? s.tabs[from.tabId]?.profileId : undefined) ?? w.profileId;
  const source: InsideSource = { profileId, windowId: w.id, tabId: from.tabId };
  if (!placeInside(s, currentAirTraffic(), url, source)) return false;
  s.closePanel(from.windowId);
  const how = from.disposition === "newWindow" ? "window" : "foreground";
  const context: OpeningContext = { tabId: from.tabId ?? null, windowId: w.id, profileId, via: "typed" };
  const key = from.tabId && from.disposition === "current" ? `tab:${from.tabId}` : null;
  settleOpening(gateOpening(url, context, key), key, (verdict) => {
    if (verdict && "cancel" in verdict) return;
    const target = verdict?.url ?? url;
    const now = store();
    const open: PlacedOpen = { url: target, how, from: isSmall(now, w.id) ? undefined : { windowId: w.id, tabId: from.tabId }, gated: true };
    const placement = placeInside(now, currentAirTraffic(), target, source);
    if (placement) {
      noteAirTrafficLink("typed");
      return openAtPlacement(placement, open);
    }
    if (from.tabId && from.disposition === "current") return now.navigate(from.tabId, target, { userInitiated: true, gated: true });
    if (from.newTab && from.disposition !== "newWindow" && now.windows[w.id]?.profileId === profileId) return openAtNewTabTarget(w.id, from.newTab, target, true);
    openAtPlacement({ profileId, open: "tab", groupKey: null }, open);
  });
  return true;
}
