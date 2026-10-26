import { lastTabClosesWindow } from "../../platform/tabs";
import { onDownload } from "../../platform/downloads";
import { releaseProfile } from "../../platform/profiles";
import { cancelFocusMove, claimFocus } from "../../platform/focus";
import { closeWindow, onWindowEvent, openWindow, restoreFullScreen, setTrafficLightsCenter, setWindowTitle, windowIds } from "../../platform/windows";
import { isDarkAppearance, onAppEvent, onOpenURLs, replyToTerminate, setAppearance, setThinScrollBars } from "../../platform/app";
import { menuShortcuts, onCommand, setMenuStateParts, type MenuBookmark, type MenuState } from "../../platform/commands";
import { Appearance } from "react-native";
import { folderChildren, isBookmarked } from "../bookmarks/bookmarks";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTab, bookmarkProfileId, IDLE_LIVE, isPinnedRow, tabLabel, togglePinTitle, windowTitle } from "../browser/model";
import { canSwitchEngine, tabEngine } from "../engines/engines";
import { setLastTabKeepsWindow } from "../omnibox/newTabBarPolicy";
import { peekTabId } from "../peek/peek";
import { splitOf } from "../splits/splits";
import { canGoBack, canGoForward } from "../tabs/navigation";
import type { Bookmarks, BookmarkNode } from "../browser/types";
import { isUtilityWindowId } from "../settings/settingsWindows";
import { openingLightsCenter } from "../windows/layout";
import { isInternalTab } from "../pages/urls";
import { sidebarMenuState } from "../sidebar/commands";
import { openWindow as createWindow } from "../browser/actions";
import { createWindowSync, type WindowPort } from "../windows/windowSync";
import { openExternalUrls } from "../littleArdia/actions";
import { SMALL_LIGHTS_CENTER } from "../windows/small";
import { runCommand } from "../commands/commands";
import { LITTLE_ARDIA_DISABLED_COMMANDS, PAGE_COMMANDS, PAGE_COMMANDS_OFF_INTERNAL_PAGES, WINDOW_COMMANDS } from "../commands/commandCatalog";
import { setMenuBarShortcuts } from "../commands/commandShortcuts";
import { finishAnimatedCloses } from "../windows/closeAnimated";
import { setFocusSenders } from "../focus/focusClaims";
import { cancelAbandonedFocusMoves, settlingCommandFocus } from "../focus/focusHandoff";
import { flushPersistence, resumePersistence } from "../session/persist";
import { startWindowCloseGuard } from "../windows/windowClose";
import { startExtensionsBridge } from "../extensions/bridge";
import { extensionMenu, useExtensions } from "../extensions/actions";

let quitting = false;
export const isQuitting = () => quitting;

export const shellWindowPort: WindowPort = {
  open(id, options, lightsCenter) {
    void setTrafficLightsCenter(id, lightsCenter);
    void openWindow(id, options);
  },
  close: (id) => void closeWindow(id),
  setTitle: (id, title) => void setWindowTitle(id, title),
  windowIds,
  restoreFullScreen: (ids, focus) => void restoreFullScreen(ids, focus),
  onEvent: (listener) => void onWindowEvent(listener),
  releaseProfile: (profile) => void releaseProfile(profile),
};

export function startNativeSync() {
  const store = useBrowser;
  if (!store.getState().windowOrder.length) store.getState().createWindow();

  setFocusSenders(claimFocus, cancelFocusMove);
  cancelAbandonedFocusMoves();
  onCommand((e) => settlingCommandFocus(e, runCommand));
  startWindowCloseGuard();
  startExtensionsBridge();
  onOpenURLs((urls, pointer) => openExternalUrls(urls, pointer));
  void lastTabClosesWindow()
    .catch(() => true)
    .then((closes) => setLastTabKeepsWindow(!closes));
  onDownload((d) => store.getState().upsertDownload(d));

  store.getState().setAppDark(Appearance.getColorScheme() === "dark");
  void setAppearance(store.getState().settings.appearance);
  void setThinScrollBars(store.getState().settings.pageScrollBars === "thin");
  void isDarkAppearance().then((dark) => store.getState().setAppDark(dark));

  onAppEvent((e) => {
    const s = store.getState();
    if (e.type === "appearance") s.setAppDark(e.dark);
    if (e.type === "reopen") createWindow();
    if (e.type === "quitWarningSuppressed") s.updateSettings({ warnBeforeQuitting: false });
    if (e.type === "willQuit") {
      quitting = true;
      finishAnimatedCloses();
      flushPersistence({ final: true });
      void replyToTerminate(true);
    }
    if (e.type === "quitCancelled") {
      quitting = false;
      resumePersistence();
    }
  });

  const windows = createWindowSync({
    port: shellWindowPort,
    getState: store.getState,
    isQuitting,
    lightsCenter: (s, id) => (s.windows[id]?.kind === "small" ? SMALL_LIGHTS_CENTER : openingLightsCenter(s, id)),
    isUtilityWindow: isUtilityWindowId,
  });
  windows.listen();

  let lastMenu = "";
  let lastMenuItems = "";
  let lastBookmarkMenus: unknown[] = [];
  let menuTimer: ReturnType<typeof setTimeout> | undefined;
  const syncMenu = () => {
    menuTimer = undefined;
    const state = menuState(store.getState());
    const { bookmarkFolders, recentBookmarks, bookmarksBar, otherBookmarks, ...rest } = state;
    const bookmarkMenus = [bookmarkFolders, recentBookmarks, bookmarksBar, otherBookmarks];
    const json = JSON.stringify(rest);
    const bookmarksChanged = !bookmarkMenus.every((menu, i) => menu === lastBookmarkMenus[i]);
    if (json === lastMenu && !bookmarksChanged) return;
    lastMenu = json;
    lastBookmarkMenus = bookmarkMenus;
    const sent = setMenuStateParts(state, bookmarksChanged);
    const menuItems = JSON.stringify([state.profiles.map((p) => p.id), (state.extensions ?? []).map((e) => e.id)]);
    if (menuItems === lastMenuItems) return void sent;
    lastMenuItems = menuItems;
    void sent.then(menuShortcuts).then(setMenuBarShortcuts, () => {});
  };

  windows.sync(store.getState());
  syncMenu();
  windows.restoreFullScreen(store.getState());
  store.subscribe((s, prev) => {
    windows.sync(s, prev);
    menuTimer ??= setTimeout(syncMenu, 120);
  });
  store.subscribe((s, prev) => {
    if (s.settings.appearance !== prev.settings.appearance) void setAppearance(s.settings.appearance);
    if (s.settings.pageScrollBars !== prev.settings.pageScrollBars) void setThinScrollBars(s.settings.pageScrollBars === "thin");
  });
  useExtensions.subscribe((e, prev) => {
    if (e.lists !== prev.lists) menuTimer ??= setTimeout(syncMenu, 120);
  });
  void windows.sweep();
}

function menuBookmarks(b: Bookmarks, folderId: string, depth = 0): MenuBookmark[] {
  return folderChildren(b, folderId).map((n: BookmarkNode) =>
    n.kind === "url"
      ? { id: n.id, title: n.title || n.url, url: n.url }
      : { id: n.id, title: n.title, children: depth < 6 ? menuBookmarks(b, n.id, depth + 1) : [] },
  );
}

type BookmarkMenus = Pick<MenuState, "bookmarkFolders" | "recentBookmarks" | "bookmarksBar" | "otherBookmarks">;
const bookmarkMenuCache = new WeakMap<Bookmarks, Map<string, BookmarkMenus>>();

function bookmarkMenus(b: Bookmarks, profileId: string): BookmarkMenus {
  let perProfile = bookmarkMenuCache.get(b);
  if (!perProfile) bookmarkMenuCache.set(b, (perProfile = new Map()));
  const cached = perProfile.get(profileId);
  if (cached) return cached;
  const roots = b.roots[profileId];
  const menus: BookmarkMenus = roots
    ? {
        bookmarkFolders: [
          { id: roots.bar, title: "Bookmarks Bar" },
          { id: roots.other, title: "Other Bookmarks" },
          ...[...folderChildren(b, roots.bar), ...folderChildren(b, roots.other)]
            .filter((n) => n.kind === "folder")
            .map((n) => ({ id: n.id, title: n.title })),
        ],
        recentBookmarks: Object.values(b.nodes)
          .filter((n): n is Extract<BookmarkNode, { kind: "url" }> => n.kind === "url" && isInTree(b, n.id, [roots.bar, roots.other]))
          .sort((x, y) => y.addedAt - x.addedAt)
          .slice(0, 5)
          .map((n) => ({ id: n.id, title: n.title || n.url, url: n.url })),
        bookmarksBar: menuBookmarks(b, roots.bar),
        otherBookmarks: menuBookmarks(b, roots.other),
      }
    : { bookmarkFolders: [], recentBookmarks: [], bookmarksBar: [], otherBookmarks: [] };
  perProfile.set(profileId, menus);
  return menus;
}

export function menuState(s: BrowserState): MenuState {
  const windowId = s.ui.focusedWindowId && s.windows[s.ui.focusedWindowId] ? s.ui.focusedWindowId : undefined;
  const w = windowId ? s.windows[windowId] : undefined;
  const tab = windowId ? activeTab(s, windowId) : undefined;
  const peek = windowId ? peekTabId(s, windowId) : undefined;
  const page = peek ? s.tabs[peek] : tab;
  const live = page ? s.live[page.id] : undefined;
  const bookmarkProfile = bookmarkProfileId(s, w);
  const regularWindows = s.windowOrder.filter((id) => !s.windows[id]!.incognito && s.windows[id]!.kind !== "small");

  const disabled: string[] = [];
  if (!tab || !splitOf(s, tab.id)) disabled.push("focusNextPane", "focusPreviousPane");
  if (w && (w.tabLayout ?? s.settings.tabLayout) === "top") disabled.push("toggleAddressBar");
  if (!w) disabled.push(...WINDOW_COMMANDS);
  else {
    if (!page?.url) disabled.push(...PAGE_COMMANDS);
    else if (isInternalTab(page)) disabled.push(...PAGE_COMMANDS_OFF_INTERNAL_PAGES);
    if (!page || !canGoBack(page.id, live ?? IDLE_LIVE)) disabled.push("back");
    if (!page || !canGoForward(page.id, live ?? IDLE_LIVE)) disabled.push("forward");
    if (!live?.isLoading) disabled.push("stop");
    if (w.incognito) disabled.push("moveTabToProfile", "moveTabToWindow", "switchProfile", "nextProfile", "previousProfile");
    else if (tab) disabled.push(`moveTabToProfile:${tab.profileId}`);
    if (regularWindows.length < 2) disabled.push("mergeAllWindows");
  }
  if (!s.closedTabs.length && !s.closedWindows.length && !s.closedGroups.length) disabled.push("reopenClosedTab");
  if (!s.closedWindows.length) disabled.push("reopenClosedWindow");

  const checked = [`setAppearance:${s.settings.appearance}`];
  if (s.settings.showFullUrl) checked.push("toggleFullUrl");
  if (s.settings.allowJavaScriptFromAppleEvents) checked.push("toggleJavaScriptFromAppleEvents");
  if (s.settings.addressBar === "sidebar") checked.push("toggleAddressBar");
  checked.push(`setBookmarksBar:${s.settings.bookmarksBar}`);
  if ((w?.tabLayout ?? s.settings.tabLayout) === "sidebar") checked.push("toggleTabLayout");
  if (w && !w.sidebarOpen) checked.push("toggleSidebar");

  const titles: Record<string, string> = {};
  if (tab?.pinned) titles.togglePin = togglePinTitle(tab);
  if (isPinnedRow(tab)) titles["togglePin:tile"] = "Move to Top Apps";
  else disabled.push("togglePin:tile");
  if (page?.muted) titles.toggleMute = "Unmute Site";
  if (page && tabEngine(s, page.id) === "webkit") titles.togglePageEngine = "Open Page in Chromium";
  if (!canSwitchEngine(page?.url)) disabled.push("togglePageEngine");
  if (page?.url && isBookmarked(s.bookmarks, bookmarkProfile, page.url)) {
    titles.bookmarkPage = "Edit Bookmark…";
  }

  if (!s.settings.openLinksInLittleArdia) titles.toggleOpenLinksInLittleArdia = "Open Links from Other Apps in Little Ardia";

  const sidebar = sidebarMenuState(s, windowId);
  disabled.push(...sidebar.disabled);
  Object.assign(titles, sidebar.titles);
  if (peek) {
    titles.openFile = "Open Peek as Tab";
    titles.closeTab = "Close Peek";
  }
  if (w?.kind === "small") {
    disabled.push(...LITTLE_ARDIA_DISABLED_COMMANDS);
    titles.openFile = "Open in Ardia";
  }

  const closed = [
    ...s.closedTabs.filter((c) => !c.tab.profileId.startsWith("incognito:")).map((c) => ({ id: c.id, title: c.tab.title || tabLabel(c.tab), at: c.closedAt })),
    ...s.closedWindows.map((c) => ({ id: c.id, title: c.tabs.length === 1 ? "Window (1 Tab)" : `Window (${c.tabs.length} Tabs)`, at: c.closedAt })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 10)
    .map(({ id, title }) => ({ id, title }));

  return {
    checked,
    disabled,
    titles,
    profiles: s.profileOrder.map((id) => ({ id, title: s.profiles[id]!.name, current: w?.profileId === id })),
    windows: w?.incognito ? [] : regularWindows.filter((id) => id !== windowId).map((id) => ({ id, title: windowTitle(s, id) })),
    ...bookmarkMenus(s.bookmarks, bookmarkProfile),
    recentlyClosed: closed,
    recentlyClosedGroups: sidebar.recentlyClosedGroups,
    warnBeforeQuitting: s.settings.warnBeforeQuitting,
    warnBeforeClosingWindow: s.settings.warnBeforeClosingWindow,
    undoReopensClosedTab: s.settings.undoReopensClosedTab,
    downloadsInProgress: s.downloads.filter((d) => d.state === "downloading").length,
    shortcuts: s.settings.shortcuts,
    extensions: extensionMenu(s, windowId),
  };
}

function isInTree(b: Bookmarks, id: string, roots: string[]): boolean {
  let node = b.nodes[id];
  for (let i = 0; node && i < 64; i++) {
    if (roots.includes(node.id)) return true;
    node = node.parentId ? b.nodes[node.parentId] : undefined;
  }
  return false;
}
