import { type LinkRoute, routeLinkTabs } from "../../platform/tabs";
import { showMenu } from "../../platform/menus";
import { focus, openWindow } from "../browser/actions";
import { menuShortcut } from "../commands/commandShortcuts";
import { closeWindowAnimated, isWindowClosing } from "../windows/closeAnimated";
import { runsJavaScript } from "../settings/scriptUrls";
import { profileAccentOf } from "../profiles/looks";
import { useBrowser } from "../browser/store";
import { activeTabId, engineProfile } from "../browser/model";
import { openAtPlacement } from "../linkRouting/actions";
import { placeLinkFromOtherApp } from "../linkRouting/placement";
import { isSmall, mainWindowFor } from "../windows/small";
import { isWebPageUrl } from "../../lib/url";
import { navigationOf } from "../tabs/pageSession";
import { asAdoptId } from "../tabs/adoptIds";
import type { AdoptId } from "../browser/types";

const store = () => useBrowser.getState();

export function openLittleArdia(url?: string, profileId?: string, adoptId?: AdoptId, linkPointer?: [number, number]): string {
  const id = store().createWindow({ kind: "small", url, profileId, adoptId, linkPointer });
  if (!url) store().openPanel(id, "");
  return id;
}


export function openExternalUrls(given: string[], pointer?: [number, number]) {
  const settings = store().settings;
  const urls = settings.allowJavaScriptFromAppleEvents ? given : given.filter((url) => !runsJavaScript(url, settings));
  if (!urls.length) return;
  void routeLinkTabs(urls).then(
    (route) => openRoutedUrls(urls, route, pointer),
    () => openUrlsFromApps(urls, {}, pointer),
  );
}

function openRoutedUrls(urls: string[], route: LinkRoute, pointer?: [number, number]) {
  const dismissed = new Set(route.dismissed ?? []);
  const kept = urls.map((_, i) => i).filter((i) => !dismissed.has(i));
  if (!kept.length) return;
  const marks = route.adoptIds ?? [];
  openUrlsFromApps(kept.map((i) => urls[i]!), { ...route, adoptIds: kept.map((i) => marks[i] ?? null) }, pointer);
}

function openUrlsFromApps(urls: string[], route: LinkRoute, pointer?: [number, number]) {
  const marks = route.adoptIds ?? [];
  let main: string | undefined;
  urls.forEach((url, i) => {
    const s = store();
    const placement = placeLinkFromOtherApp(s, url);
    const adoptId = route.profile !== undefined && engineProfile(s, placement.profileId) === route.profile ? asAdoptId(marks[i] ?? undefined) : undefined;
    if (placement.kind === "little" && urls.length === 1 && isWebPageUrl(url)) return void openLittleArdia(url, placement.profileId, adoptId, pointer);
    main = openAtPlacement(placement.kind === "little" ? { kind: "profile", profileId: placement.profileId } : placement, { url, how: "foreground", adoptId }) ?? main;
  });
  if (main) focus(main);
}

export function openInMainWindow(windowId: string) {
  const s = store();
  if (!isSmall(s, windowId)) return;
  const tabId = activeTabId(s, windowId);
  const tab = tabId ? s.tabs[tabId] : undefined;
  const target = mainWindowFor(s, tab?.profileId ?? s.windows[windowId]!.profileId);
  if (!tab?.url) {
    s.closeWindow(windowId);
    if (target) focus(target);
    else openWindow({ profileId: tab?.profileId });
    return;
  }
  const moved = s.moveTabsToWindow([tab.id], target ?? null);
  if (moved) focus(moved);
}

export function moveLittleArdiaToProfile(windowId: string, profileId: string) {
  const s = store();
  const w = s.windows[windowId];
  if (!w || !isSmall(s, windowId) || isWindowClosing(windowId) || !s.profiles[profileId] || w.profileId === profileId) return;
  const tabId = activeTabId(s, windowId);
  const url = (tabId ? s.tabs[tabId]?.url : undefined) || undefined;
  const id = store().createWindow({ kind: "small", url, profileId, frame: w.frame });
  if (!url) store().openPanel(id, "");
  closeWindowAnimated(windowId, id, () => {
    if (tabId) useBrowser.setState((now) => ({ closedTabs: now.closedTabs.filter((c) => c.tabId !== tabId) }));
  });
}

export function cycleLittleArdiaProfile(windowId: string, delta: 1 | -1) {
  const s = store();
  const w = s.windows[windowId];
  if (!w || s.profileOrder.length < 2) return;
  const i = s.profileOrder.indexOf(w.profileId);
  moveLittleArdiaToProfile(windowId, s.profileOrder[(i + delta + s.profileOrder.length) % s.profileOrder.length]!);
}

export async function openLittleArdiaProfileMenu(windowId: string) {
  const s = store();
  const current = s.windows[windowId]?.profileId;
  const choice = await showMenu(
    s.profileOrder.map((id) => ({
      id,
      title: s.profiles[id]!.name,
      checked: id === current,
      swatch: profileAccentOf(s.profiles[id]),
      ...menuShortcut(`switchProfile:${id}`, s),
    })),
  );
  if (choice) moveLittleArdiaToProfile(windowId, choice);
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
