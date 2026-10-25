import { type LinkRoute, routeLinkTabs } from "@ardia/ardiacore";
import { animateWindowClose, showMenu } from "@ardia/shell";
import { focus, openWindow } from "../../lib/actions";
import { routedLinks, type RoutedLinks } from "../../lib/linkRoutes";
import { runsJavaScript } from "../../lib/scriptUrls";
import { profileAccent } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { isSmall, lastActiveProfile, mainWindowFor } from "../../store/small";

const store = () => useBrowser.getState();

const closing = new Set<string>();

function closeAfterAnimation(windowId: string, replacedBy: string | null, then?: () => void) {
  if (closing.has(windowId)) return;
  closing.add(windowId);
  const close = () => {
    closing.delete(windowId);
    if (!isSmall(store(), windowId)) return;
    store().closeWindow(windowId);
    then?.();
  };
  void animateWindowClose(windowId, replacedBy).then(close, close);
}

export function openLittleArdia(url?: string, profileId?: string, adoptId?: string, linkPointer?: [number, number]): string {
  const id = store().createWindow({ small: true, url, profileId, adoptId, linkPointer });
  if (!url) store().openPanel(id, "");
  return id;
}

const opensInLittleArdia = (url: string) => /^(https?|file):/i.test(url);

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
  const profileId = routed.profileId ?? lastActiveProfile(store());
  if (store().settings.openLinksInLittleArdia && urls.length === 1 && url && opensInLittleArdia(url)) return void openLittleArdia(url, profileId, routed.adoptIds[0], pointer);
  openLinksInMainWindow(urls, profileId, routed.adoptIds);
}

function openLinksInMainWindow(urls: string[], profileId: string, adoptIds: (string | undefined)[]) {
  let target = mainWindowFor(store(), profileId);
  urls.forEach((url, i) => {
    const s = store();
    const adoptId = adoptIds[i];
    const w = target ? s.windows[target] : undefined;
    const blank = w && w.tabIds.length === 1 ? s.tabs[w.tabIds[0]!] : undefined;
    const intoBlank = blank && !blank.url && !blank.navigation && blank.profileId === profileId && !s.windowUi[w!.id]?.panel.open;
    if (!w) target = openWindow({ url, profileId, adoptId });
    else if (intoBlank && !adoptId) s.navigate(blank.id, url);
    else {
      s.newTab(w.id, { url, profileId, adoptId });
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
  if (!w || !isSmall(s, windowId) || closing.has(windowId) || !s.profiles[profileId] || w.profileId === profileId) return;
  const tabId = activeTabId(s, windowId);
  const url = (tabId ? s.tabs[tabId]?.url : undefined) || undefined;
  const id = store().createWindow({ small: true, url, profileId, frame: w.frame });
  if (!url) store().openPanel(id, "");
  closeAfterAnimation(windowId, id, () => {
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
    s.profileOrder.map((id, i) => ({
      id,
      title: s.profiles[id]!.name,
      checked: id === current,
      swatch: profileAccent(s.profiles[id]),
      ...(i < 9 ? { key: String(i + 1), modifiers: ["control" as const] } : {}),
    })),
  );
  if (choice) moveLittleArdiaToProfile(windowId, choice);
}

export function closeLittleArdia(windowId: string) {
  if (isSmall(store(), windowId)) closeAfterAnimation(windowId, null);
}

export function closeLittleArdiaOnEscape(tabId: string) {
  const s = store();
  const tab = s.tabs[tabId];
  if (!tab || !isSmall(s, tab.windowId) || s.find[tabId]?.open || s.windowUi[tab.windowId]?.panel.open) return;
  closeLittleArdia(tab.windowId);
}
