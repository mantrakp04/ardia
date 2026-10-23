import { type LinkRoute, routeLinkTabs } from "@ardia/ardiacore";
import { focus, openWindow } from "../../lib/actions";
import { routedLinks, type RoutedLinks } from "../../lib/linkRoutes";
import { runsJavaScript } from "../../lib/scriptUrls";
import { useBrowser } from "../../store/browser";
import { linkRuleProfile } from "../../store/linkRules";
import { activeTabId, engineProfile } from "../../store/model";
import { isSmall, lastActiveProfile, mainWindowFor } from "../../store/small";
import { trackExternalLinksOpened } from "../../telemetry/track";

const store = () => useBrowser.getState();

export function openLittleArdia(url?: string, profileId?: string, adoptId?: string): string {
  const id = store().createWindow({ small: true, url, profileId, adoptId });
  if (!url) store().openPanel(id, "");
  return id;
}

const opensInLittleArdia = (url: string) => /^(https?|file):/i.test(url);

export function openExternalUrls(given: string[]) {
  const settings = store().settings;
  const urls = settings.allowJavaScriptFromAppleEvents ? given : given.filter((url) => !runsJavaScript(url, settings));
  if (!urls.length) return;
  void routeLinkTabs(urls).then(
    (route) => openRoutedUrls(urls, route),
    () => openUrlsFromApps(urls, routedLinks({}, urls.length)),
  );
}

function openRoutedUrls(urls: string[], route: LinkRoute) {
  const dismissed = new Set(route.dismissed ?? []);
  const kept = urls.map((_, i) => i).filter((i) => !dismissed.has(i));
  if (!kept.length) return;
  const marks = route.adoptIds ?? [];
  openUrlsFromApps(
    kept.map((i) => urls[i]!),
    routedLinks({ ...route, adoptIds: kept.map((i) => marks[i] ?? null) }, kept.length),
  );
}

function openUrlsFromApps(urls: string[], routed: RoutedLinks) {
  const s = store();
  const [url] = urls;
  const fallback = routed.profileId ?? lastActiveProfile(s);
  const ruled = urls.map((link) => linkRuleProfile(s, link));
  const profileIds = ruled.map((profileId) => profileId ?? fallback);
  const adoptIds = routed.adoptIds.map((adoptId, i) => (engineProfile(profileIds[i]!) === engineProfile(fallback) ? adoptId : undefined));
  trackExternalLinksOpened(urls.length, ruled.some((profileId) => profileId !== null));
  if (s.settings.openLinksInLittleArdia && urls.length === 1 && url && opensInLittleArdia(url)) return void openLittleArdia(url, profileIds[0], adoptIds[0]);
  for (const profileId of new Set(profileIds)) {
    const picked = urls.flatMap((_, i) => (profileIds[i] === profileId ? [i] : []));
    openLinksInMainWindow(
      picked.map((i) => urls[i]!),
      profileId,
      picked.map((i) => adoptIds[i]),
    );
  }
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

export function closeLittleArdia(windowId: string) {
  if (isSmall(store(), windowId)) store().closeWindow(windowId);
}

export function closeLittleArdiaOnEscape(tabId: string) {
  const s = store();
  const tab = s.tabs[tabId];
  if (!tab || !isSmall(s, tab.windowId) || s.find[tabId]?.open || s.windowUi[tab.windowId]?.panel.open) return;
  closeLittleArdia(tab.windowId);
}
