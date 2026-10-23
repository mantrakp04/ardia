import { focus, openWindow } from "../../lib/actions";
import { destinationStillMaps, resolveExternalLinks } from "../../lib/linkRoutes";
import { runsJavaScript } from "../../lib/scriptUrls";
import { useBrowser } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { isSmall, mainWindowFor } from "../../store/small";

const store = () => useBrowser.getState();

export function openLittleArdia(url?: string, profileId?: string, adoptId?: string, requiresAdoption?: boolean, background?: boolean): string {
  const id = store().createWindow({ small: true, url, profileId, adoptId, requiresAdoption, background });
  if (!url) store().openPanel(id, "");
  return id;
}

export function openExternalUrls(given: string[]) {
  const settings = store().settings;
  const urls = settings.allowJavaScriptFromAppleEvents ? given : given.filter((url) => !runsJavaScript(url, settings));
  if (!urls.length) return;
  void resolveExternalLinks(urls).then((links) => {
    if (!links || links.length !== urls.length) return console.warn("Couldn't route links from other apps");
    let main: string | undefined;
    urls.forEach((url, i) => {
      const link = links[i];
      if (!link || "dismissed" in link) return;
      if (!destinationStillMaps(link.profileId, link.engine)) return console.warn("A link's profile changed before it opened");
      if (link.action === "little") return void openLittleArdia(url, link.profileId, link.adoptId, link.requiresAdoption);
      main = openLinkInMainWindow(url, link.profileId, link.adoptId, link.requiresAdoption);
    });
    if (main) focus(main);
  });
}

function openLinkInMainWindow(url: string, profileId: string, adoptId: string | undefined, requiresAdoption: boolean | undefined): string {
  const s = store();
  const w = s.windows[mainWindowFor(s, profileId) ?? ""];
  if (!w) return openWindow({ url, profileId, adoptId, requiresAdoption });
  const blank = w.tabIds.length === 1 ? s.tabs[w.tabIds[0]!] : undefined;
  const intoBlank = blank && !blank.url && !blank.navigation && blank.profileId === profileId && !s.windowUi[w.id]?.panel.open;
  if (intoBlank && !adoptId && !requiresAdoption) s.navigate(blank.id, url);
  else {
    s.newTab(w.id, { url, profileId, adoptId, requiresAdoption });
    if (intoBlank) store().closeTab(blank.id);
  }
  return w.id;
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
