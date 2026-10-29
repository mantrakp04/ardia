import { type LinkRoute, routeLinkTabs } from "../../platform/tabs";
import { showMenu } from "../../platform/menus";
import { focus, openWindow } from "../browser/actions";
import { menuShortcut } from "../commands/commandShortcuts";
import { closeWindowAnimated, isWindowClosing } from "../windows/closeAnimated";
import { routedLinks, type RoutedLinks } from "./linkRoutes";
import { runsJavaScript } from "../settings/scriptUrls";
import { profileAccentOf } from "../spaces/looks";
import { useBrowser } from "../browser/store";
import { confirm } from "../app/system";
import { engineProfileForSpace, activeTabId } from "../browser/model";
import { isSmall, lastActiveSpace, mainWindowFor } from "../windows/small";
import { isWebPageUrl } from "../../lib/url";
import { navigationOf } from "../tabs/pageSession";
import { asAdoptId } from "../tabs/adoptIds";
import type { AdoptId } from "../browser/types";

const store = () => useBrowser.getState();

export function openLittleArdia(url?: string, spaceId?: string, adoptId?: AdoptId, linkPointer?: [number, number]): string {
  const id = store().createWindow({ kind: "small", url, spaceId, adoptId, linkPointer });
  if (!url) store().openPanel(id, "");
  return id;
}


export function openExternalUrls(given: string[], pointer?: [number, number]) {
  const settings = store().settings;
  const urls = settings.allowJavaScriptFromAppleEvents ? given : given.filter((url) => !runsJavaScript(url, settings));
  if (!urls.length) return;
  void routeLinkTabs(urls).then(
    (route) => openRoutedUrls(urls, route, pointer),
    () => openUrlsFromApps(urls, routedLinks({}, urls.length), pointer),
  );
}

function openRoutedUrls(urls: string[], route: LinkRoute, pointer?: [number, number]) {
  const dismissed = new Set(route.dismissed ?? []);
  const kept = urls.map((_, i) => i).filter((i) => !dismissed.has(i));
  if (!kept.length) return;
  const marks = route.adoptIds ?? [];
  openUrlsFromApps(
    kept.map((i) => urls[i]!),
    routedLinks({ ...route, adoptIds: kept.map((i) => marks[i] ?? null) }, kept.length),
    pointer,
  );
}

function openUrlsFromApps(urls: string[], routed: RoutedLinks, pointer?: [number, number]) {
  const [url] = urls;
  const spaceId = routed.spaceId ?? store().settings.defaultSpaceId;
  if (store().settings.openLinksInLittleArdia && urls.length === 1 && url && isWebPageUrl(url)) return void openLittleArdia(url, spaceId, asAdoptId(routed.adoptIds[0]), pointer);
  openLinksInMainWindow(urls, spaceId, routed.adoptIds);
}

function openLinksInMainWindow(urls: string[], spaceId: string, adoptIds: (string | undefined)[]) {
  let target = mainWindowFor(store(), spaceId);
  urls.forEach((url, i) => {
    const s = store();
    const adoptId = asAdoptId(adoptIds[i]);
    const w = target ? s.windows[target] : undefined;
    const blank = w && w.tabIds.length === 1 ? s.tabs[w.tabIds[0]!] : undefined;
    const intoBlank = blank && !blank.url && !navigationOf(blank) && blank.spaceId === spaceId && !s.windowUi[w!.id]?.panel.open;
    if (!w) target = openWindow({ url, spaceId, adoptId });
    else if (intoBlank && !adoptId) s.navigate(blank.id, url);
    else {
      s.newTab(w.id, { url, spaceId, adoptId });
      if (intoBlank) store().closeTab(blank.id);
    }
  });
  if (target) focus(target);
}

export function openInMainWindow(windowId: string) {
  const s = store();
  if (!isSmall(s, windowId)) return;
  const tabId = activeTabId(s, windowId);
  const tab = tabId ? s.tabs[tabId] : undefined;
  const target = mainWindowFor(s, tab?.spaceId ?? s.windows[windowId]!.spaceId);
  if (!tab?.url) {
    s.closeWindow(windowId);
    if (target) focus(target);
    else openWindow({ spaceId: tab?.spaceId });
    return;
  }
  const moved = s.moveTabsToWindow([tab.id], target ?? null);
  if (moved) focus(moved);
}

export async function moveLittleArdiaToSpace(windowId: string, spaceId: string) {
  const s = store();
  const w = s.windows[windowId];
  if (!w || !isSmall(s, windowId) || isWindowClosing(windowId) || !s.spaces[spaceId] || w.spaceId === spaceId) return;
  const tabId = activeTabId(s, windowId);
  const url = (tabId ? s.tabs[tabId]?.url : undefined) || undefined;
  const id = store().createWindow({ kind: "small", url, spaceId, frame: w.frame });
  if (!url) store().openPanel(id, "");
  closeWindowAnimated(windowId, id, () => {
    if (tabId) useBrowser.setState((now) => ({ closedTabs: now.closedTabs.filter((c) => c.tabId !== tabId) }));
  });
}

export function cycleLittleArdiaSpace(windowId: string, delta: 1 | -1) {
  const s = store();
  const w = s.windows[windowId];
  if (!w || s.spaceOrder.length < 2) return;
  const i = s.spaceOrder.indexOf(w.spaceId);
  moveLittleArdiaToSpace(windowId, s.spaceOrder[(i + delta + s.spaceOrder.length) % s.spaceOrder.length]!);
}

export async function openLittleArdiaSpaceMenu(windowId: string) {
  const s = store();
  const current = s.windows[windowId]?.spaceId;
  const choice = await showMenu(
    s.spaceOrder.map((id) => ({
      id,
      title: s.spaces[id]!.name,
      checked: id === current,
      swatch: profileAccentOf(s.spaces[id]),
      ...menuShortcut(`switchSpace:${id}`, s),
    })),
  );
  if (choice) moveLittleArdiaToSpace(windowId, choice);
}

export function closeLittleArdia(windowId: string) {
  if (isSmall(store(), windowId)) closeWindowAnimated(windowId, null);
}

export function closeLittleArdiaOnEscape(tabId: string) {
  const s = store();
  const tab = s.tabs[tabId];
  if (!tab || !isSmall(s, tab.windowId) || s.find[tabId]?.open || s.windowUi[tab.windowId]?.panel.open) return;
  closeLittleArdia(tab.windowId);
}
