import { setLinkRoutes } from "../../platform/pageOptions";
import { groupRouteKey, type LinkPlacement } from "../../lib/linkRouting";
import { focus, openWindow } from "../browser/actions";
import { useBrowser, type BrowserState } from "../browser/store";
import type { Disposition } from "../omnibox/openFromBar";
import type { AdoptId } from "../browser/types";
import { isRegularWindow, isSmall, mainWindowFor } from "../windows/small";
import { adoptOf, navigationOf } from "../tabs/pageSession";
import { pageLinkRoutes, placeLinkFromProfile } from "./placement";

const store = () => useBrowser.getState();

export type RoutedOpen = {
  url: string;
  how: "foreground" | "background" | "window";
  from?: { windowId: string; tabId?: string };
  adoptId?: AdoptId;
  pointer?: [number, number];
};

export function openAtPlacement(placement: LinkPlacement, open: RoutedOpen): string | undefined {
  const background = open.how === "background";
  if (placement.kind === "little") {
    store().createWindow({ kind: "small", url: open.url, profileId: placement.profileId, adoptId: open.adoptId, linkPointer: open.pointer, background });
    return undefined;
  }
  const s = store();
  const { profileId } = placement;
  const fromMain = open.from && isRegularWindow(s.windows[open.from.windowId]) ? open.from.windowId : undefined;
  const groupHome = placement.kind === "group" ? groupWindow(s, profileId, placement.groupKey) : undefined;
  let target = open.how === "window" || (placement.kind === "group" && !groupHome) ? undefined : (groupHome ?? fromMain ?? mainWindowFor(s, profileId));
  let tabId: string;
  const blank = target ? blankTabOf(s, target, profileId) : undefined;
  if (!target) {
    target = openWindow({ url: open.url, profileId, adoptId: open.adoptId, background });
    tabId = store().windows[target]?.activeTabIds[profileId] ?? "";
  } else if (blank && !open.adoptId && !background) {
    s.navigate(blank, open.url);
    tabId = blank;
  } else {
    const openerId = open.from?.tabId && s.tabs[open.from.tabId]?.profileId === profileId && s.tabs[open.from.tabId]?.windowId === target ? open.from.tabId : undefined;
    tabId = s.newTab(target, { url: open.url, profileId, adoptId: open.adoptId, background, openerId });
    if (blank && !background) store().closeTab(blank);
  }
  if (placement.kind === "group" && tabId) joinGroup(tabId, profileId, placement.groupKey);
  if (!background && target !== open.from?.windowId) focus(target);
  return target;
}

function blankTabOf(s: BrowserState, windowId: string, profileId: string): string | undefined {
  const w = s.windows[windowId];
  const only = w && w.tabIds.length === 1 ? s.tabs[w.tabIds[0]!] : undefined;
  return only && !only.url && !navigationOf(only) && !adoptOf(only) && only.profileId === profileId && !s.windowUi[windowId]?.panel.open ? only.id : undefined;
}

function groupWindow(s: BrowserState, profileId: string, groupKey: string): string | undefined {
  const copies = Object.values(s.groups).filter((g) => g.profileId === profileId && groupRouteKey(g) === groupKey);
  const order = [...new Set([...s.ui.focusOrder, ...s.windowOrder])];
  return order.find((id) => copies.some((g) => g.windowId === id)) ?? copies[0]?.windowId;
}

function joinGroup(tabId: string, profileId: string, groupKey: string) {
  const s = store();
  const tab = s.tabs[tabId];
  if (!tab) return;
  const group = Object.values(s.groups).find((g) => g.windowId === tab.windowId && g.profileId === profileId && groupRouteKey(g) === groupKey);
  if (!group) return;
  s.addTabsToGroup(group.id, [tabId]);
  if (group.collapsed) store().updateGroup(group.id, { collapsed: false });
}

export function routeTypedUrl(url: string, from: { windowId: string; tabId?: string; disposition: Disposition }): boolean {
  const s = store();
  const w = s.windows[from.windowId];
  if (!w || w.kind === "private") return false;
  const tab = from.tabId ? s.tabs[from.tabId] : undefined;
  const placement = placeLinkFromProfile(s, url, tab?.profileId ?? w.profileId, { windowId: w.id, tabId: from.tabId });
  if (!placement) return false;
  s.closePanel(from.windowId);
  const how = from.disposition === "newWindow" ? "window" : "foreground";
  openAtPlacement(placement, { url, how, from: isSmall(s, w.id) ? undefined : { windowId: w.id, tabId: from.tabId } });
  return true;
}

let started = false;

export function startLinkRouting() {
  if (started) return;
  started = true;
  let sent = "";
  const sync = () => {
    const routes = pageLinkRoutes(store());
    const json = JSON.stringify(routes);
    if (json === sent) return;
    sent = json;
    setLinkRoutes(routes).catch(() => {
      if (sent === json) sent = "";
    });
  };
  sync();
  useBrowser.subscribe(sync);
}
