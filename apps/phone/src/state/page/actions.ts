import { mobileClean } from "@ardia/core/src/mobile";
import { blocking } from "../../platform/blocking";
import { downloads, type DownloadEvent } from "../../platform/downloads";
import { pages, type PageEngineEvent, type PageRequestAnswer } from "../../platform/pages";

export type { ReadableContent } from "../../platform/pages";
import { copyText, openExternal, preferredLanguage, pressHaptic, shareLink, successHaptic } from "../../platform/system";
import { cancelSearch, closeArchive, leaveDeck, openTab, showDeck, useBrowse } from "../browse/store";
import { display } from "../search/omnibox";
import { presentSearch, searchState } from "../search/store";
import { setPreference } from "../settings/store";
import { listenToPages, openPageInBackground, pageHandle, pageIsFullscreen, pageRequest, settled, storeFind, storeFullscreen, storeRequest, usePages } from "../pages/store";
import { closeTabById, currentTabs, openNewTab, useTabs } from "../tabs/store";
import { isSyncableUrl } from "../tabs/tabModels";
import { findTab } from "../tabs/tabsState";
import { blockersToast, searchQuery, translationUrl, type NightShadeMode } from "./pageMenu";
import { backLayer, downloadedToast, downloadFailedToast, downloadingToast, pressPlan, type PressAction, type Request } from "./pagePrompts";
import { onboardingBack } from "../onboarding/store";
import { openSettings, popSettings } from "../settings/nav";
import { pinToMac, sendTab } from "../sync/actions";
import type { SyncedDevice } from "../../platform/sync";
import { pageUi, usePageUi, type Press } from "./store";
import { closeVoiceSearch, useVoice } from "../voice/store";
import { showToast, TOAST_LONG_DURATION_MS } from "../toasts/store";

const TITLE_FEEDBACK_MS = 1500;
const COPIED_URL = "Copied URL";
const NO_APP_FOR_LINK = "No App Can Open This Link";

const quietly = (call: () => Promise<unknown>) => void settled(call, undefined);

const selectedId = () => currentTabs().selectedId;
const selectedTab = () => {
  const id = selectedId();
  return id ? findTab(currentTabs(), id) ?? null : null;
};
const hostOf = (url: string | null) => (url ? display(url).host || null : null);

export async function openPageMenu() {
  const tab = selectedTab();
  if (!tab) return;
  usePageUi.setState({ menuOpen: true, titleFeedback: null, menuSite: null });
  const url = usePages.getState().navigation[tab.id]?.url ?? tab.url;
  const host = hostOf(url);
  const [shade, blockers, capabilities] = await Promise.all([
    settled(() => pages.nightShade(host, tab.isPrivate), null),
    settled(() => blocking.isEnabledForSite(url, tab.isPrivate), true),
    settled(async () => pages.capabilities(), null),
  ]);
  usePageUi.setState({
    menuSite: { host, nightShade: shade?.mode ?? "disabled", blockersEnabled: blockers },
    zoomLevels: capabilities?.pageZoomLevels ?? pageUi().zoomLevels,
  });
}

export const closePageMenu = () => usePageUi.setState({ menuOpen: false });

export function openInDefaultBrowser() {
  const tab = selectedTab();
  closePageMenu();
  const url = tab ? (usePages.getState().navigation[tab.id]?.url ?? tab.url) : null;
  if (url && isSyncableUrl(url)) quietly(() => openExternal(url));
}

export function pinCurrentToMac() {
  const tab = selectedTab();
  if (!tab) return;
  closePageMenu();
  void pinToMac(tab, () => openSettings({ page: "sync" }));
}

export function sendCurrentTab(device: SyncedDevice) {
  const tab = selectedTab();
  closePageMenu();
  if (tab) void sendTab(tab, device);
}

export function openSiteSettings() {
  closePageMenu();
  openSettings({ page: "siteSettings" });
}

const withPage = (run: (id: string) => Promise<unknown>) => {
  const id = selectedId();
  if (id) quietly(() => run(id));
};

export const menuBack = () => {
  closePageMenu();
  void pageHandle(selectedId())?.goBack();
};

export const menuForward = () => {
  closePageMenu();
  void pageHandle(selectedId())?.goForward();
};

export const menuReload = () => {
  closePageMenu();
  void pageHandle(selectedId())?.reload();
};

export const retryPage = (tabId: string) => void pageHandle(tabId)?.reload();

export const menuStop = () => void pageHandle(selectedId())?.stopLoading();

export function editPageQuery() {
  const tab = selectedTab();
  if (!tab) return;
  closePageMenu();
  presentSearch("page", searchQuery(tab.url) ?? tab.url, null, { currentUrl: tab.url, currentTabId: tab.id });
}

export function copyCurrentLink() {
  const tab = selectedTab();
  if (!tab || !isSyncableUrl(tab.url)) return;
  quietly(() => copyText(mobileClean(tab.url)));
  quietly(successHaptic);
  usePageUi.setState({ titleFeedback: COPIED_URL });
  setTimeout(() => {
    if (pageUi().titleFeedback === COPIED_URL) usePageUi.setState({ titleFeedback: null });
  }, TITLE_FEEDBACK_MS);
}

export function shareCurrentPage() {
  const tab = selectedTab();
  if (!tab || !isSyncableUrl(tab.url)) return;
  closePageMenu();
  quietly(() => shareLink(tab.url, tab.title));
}

export function showReader() {
  const id = selectedId();
  if (!id) return;
  usePageUi.setState({ menuOpen: false, readerTabId: id });
}

export const closeReader = () => usePageUi.setState({ readerTabId: null });

export const readableContent = (id: string) => settled(() => pages.readableContent(id), null);

export const setReaderStep = (step: number) => setPreference("readerStep", step);
export const setReaderSerif = (serif: boolean) => setPreference("readerSerif", serif);
export const setReaderTheme = (theme: "light" | "sepia" | "dark") => setPreference("readerTheme", theme);

export function showFind() {
  usePageUi.setState({ menuOpen: false, findOpen: true, findQuery: "" });
}

export function typeFind(query: string) {
  usePageUi.setState({ findQuery: query });
  withPage((id) => (query ? pages.find(id, query) : pages.endFind(id)));
}

export const findNext = () => withPage((id) => pages.findNext(id));
export const findPrevious = () => withPage((id) => pages.findPrevious(id));

export function closeFind() {
  const id = selectedId();
  usePageUi.setState({ findOpen: false, findQuery: "" });
  if (id) {
    storeFind(id, null);
    quietly(() => pages.endFind(id));
  }
}

export function translatePage() {
  const tab = selectedTab();
  if (!tab || !isSyncableUrl(tab.url)) return;
  closePageMenu();
  void pageHandle(tab.id)?.loadUrl(translationUrl(tab.url, preferredLanguage()));
}

export function setNightShadeOn(on: boolean) {
  const tab = selectedTab();
  const site = pageUi().menuSite;
  if (!tab || !site?.host) return;
  const mode: NightShadeMode = on ? "always" : "disabled";
  usePageUi.setState({ menuSite: { ...site, nightShade: mode } });
  quietly(() => pages.setNightShade(mode, site.host, tab.isPrivate));
}

export const zoomOut = () => withPage((id) => pages.zoomOut(id));
export const zoomIn = () => withPage((id) => pages.zoomIn(id));
export const resetZoom = () => withPage((id) => pages.setPageZoom(id, 1));

export function setDesktopSite(on: boolean) {
  closePageMenu();
  withPage((id) => pages.setDesktopSite(id, on));
}

export function setBlockersOn(on: boolean) {
  const tab = selectedTab();
  const site = pageUi().menuSite;
  if (!tab || !site?.host) return;
  closePageMenu();
  const url = usePages.getState().navigation[tab.id]?.url ?? tab.url;
  const host = site.host;
  quietly(async () => {
    await blocking.setEnabledForSite(url, on, tab.isPrivate);
    showToast(blockersToast(on, host), on ? "blocking" : "warning");
    await pageHandle(tab.id)?.reload();
  });
}

export function answerRequest(pageId: string, request: Request, answer: PageRequestAnswer) {
  storeRequest(pageId, null);
  quietly(() => pages.answerRequest(pageId, request.id, answer));
}

export const dismissPress = () => usePageUi.setState({ press: null });

export function pressAction(press: Press, action: PressAction) {
  dismissPress();
  const opener = findTab(currentTabs(), press.tabId);
  const plan = pressPlan(press, action, opener?.isPrivate ?? false, isSyncableUrl);
  switch (plan.kind) {
    case "open": {
      const tab = openNewTab({ url: plan.url, origin: "link", after: plan.after, selecting: false, isPrivate: plan.isPrivate });
      if (plan.background) void openPageInBackground(tab.id, plan.url, plan.isPrivate);
      else openTab(tab.id);
      return;
    }
    case "copy":
      quietly(() => copyText(mobileClean(plan.url)));
      quietly(successHaptic);
      showToast(COPIED_URL, "link");
      return;
    case "share":
      quietly(() => shareLink(plan.url, ""));
      return;
    case "download":
      quietly(() => pages.download(plan.pageId, plan.url));
      return;
    case "none":
      return;
  }
}

async function openPopup(openerId: string, popupId: string, url: string | null, isPrivate: boolean) {
  const tab = openNewTab({ url: url ?? "about:blank", origin: "link", after: openerId, selecting: false, isPrivate });
  const opened = await settled(() => pages.openPopup(tab.id, popupId), false);
  if (opened) openTab(tab.id);
  else closeTabById(tab.id);
}

function downloadEvent(event: DownloadEvent) {
  if (event.name !== "downloads.finished") return;
  if (event.failure) {
    showToast(downloadFailedToast(event.fileName), "warning");
    return;
  }
  const uri = event.uri;
  showToast(downloadedToast(event.fileName), "download", TOAST_LONG_DURATION_MS, uri ? () => quietly(() => downloads.open(uri)) : null);
}

function pageEvent(event: PageEngineEvent) {
  switch (event.name) {
    case "page.find":
      storeFind(event.pageId, event.result);
      return;
    case "page.request":
      storeRequest(event.pageId, event.request);
      return;
    case "page.fullscreen":
      storeFullscreen(event.pageId, event.isFullscreen);
      return;
    case "page.popup":
      void openPopup(event.pageId, event.popupId, event.url, event.isPrivate);
      return;
    case "page.download":
      showToast(downloadingToast(event.fileName), "download");
      return;
    case "page.longPress":
      if (event.pageId !== selectedId()) return;
      quietly(pressHaptic);
      usePageUi.setState({ press: { tabId: event.pageId, target: event.target, x: event.x, y: event.y } });
      return;
    case "page.externalAppMissing":
      showToast(NO_APP_FOR_LINK, "warning");
      return;
    default:
      return;
  }
}

let started = false;

export function startPageUi() {
  if (started) return;
  started = true;
  listenToPages(pageEvent);
  try {
    downloads.addListener(downloadEvent);
  } catch {
    return;
  }
}

export const openInOtherApp = (url: string) => quietly(() => openExternal(url));

export function handleSystemBack(): boolean {
  if (onboardingBack()) return true;
  if (useVoice.getState().presented) {
    closeVoiceSearch();
    return true;
  }
  if (popSettings()) return true;
  const { surface, sheet } = useBrowse.getState();
  const id = selectedId();
  const ui = pageUi();
  if (searchState().open && surface !== "browsing") {
    cancelSearch();
    return true;
  }
  if (sheet) {
    closeArchive();
    return true;
  }
  if (surface === "deck") {
    leaveDeck();
    return true;
  }
  const layer = backLayer({
    isFullscreen: surface === "browsing" && pageIsFullscreen(id),
    hasRequest: surface === "browsing" && pageRequest(id) !== null,
    isSearching: searchState().open,
    hasPressMenu: ui.press !== null,
    isReading: ui.readerTabId !== null,
    isMenuOpen: ui.menuOpen,
    isFinding: ui.findOpen,
    canGoBack: surface === "browsing" && Boolean(id && usePages.getState().navigation[id]?.canGoBack),
    hasTab: surface === "browsing" && id !== null,
  });
  switch (layer) {
    case "fullscreen":
      if (id) quietly(() => pages.exitFullscreen(id));
      return true;
    case "request": {
      const request = pageRequest(id);
      if (id && request) answerRequest(id, request as Request, { type: "dismiss" });
      return true;
    }
    case "tray":
      cancelSearch();
      return true;
    case "pressMenu":
      dismissPress();
      return true;
    case "reader":
      closeReader();
      return true;
    case "menu":
      closePageMenu();
      return true;
    case "find":
      closeFind();
      return true;
    case "pageHistory":
      void pageHandle(id)?.goBack();
      return true;
    case "deck":
      void showDeck();
      return true;
    default:
      return false;
  }
}

function closePageLayers() {
  const ui = pageUi();
  if (ui.menuOpen || ui.findOpen || ui.readerTabId || ui.press) {
    if (ui.findOpen) closeFind();
    usePageUi.setState({ menuOpen: false, readerTabId: null, press: null });
  }
}

useBrowse.subscribe((browse, previous) => {
  if (browse.surface !== previous.surface) closePageLayers();
});

useTabs.subscribe((tabs, previous) => {
  if (tabs.selectedId !== previous.selectedId) closePageLayers();
});
