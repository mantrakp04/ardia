import type { MenuBookmark, MenuState } from "../../platform/commands";
import { engineBookmarkRoots, folderChildren, isBookmarked, isWithin, ROOT_TITLES } from "../bookmarks/bookmarks";
import type { BrowserState } from "../browser/store";
import { activeTab, bookmarkProfileId, engineProfile, IDLE_LIVE, isPinnedRow, tabLabel, togglePinTitle, windowTitle, tabLayoutOf } from "../browser/model";
import { canSwitchEngine, tabEngine } from "../engines/engines";
import { peekTabId } from "../peek/peek";
import { splitOf } from "../splits/splits";
import { canGoBack, canGoForward } from "../tabs/navigation";
import type { Bookmarks, BookmarkNode } from "../browser/types";
import { isInternalTab } from "../pages/urls";
import { muteState, muteTitle } from "../tabs/mute";
import { sidebarMenuState } from "../sidebar/commands";
import { LITTLE_ARDIA_DISABLED_COMMANDS, PAGE_COMMANDS, PAGE_COMMANDS_OFF_INTERNAL_PAGES, settingChecks, WINDOW_COMMANDS } from "../commands/commandCatalog";
import { extensionMenu } from "../extensions/actions";
import { menuBarBindings } from "./commandShortcuts";
import { focusedWindowOf } from "../windows/ui";

function menuBookmarks(b: Bookmarks, folderId: string, depth = 0): MenuBookmark[] {
  return folderChildren(b, folderId).map((n: BookmarkNode) =>
    n.kind === "url"
      ? { id: n.id, title: n.title || n.url, url: n.url }
      : { id: n.id, title: n.title, children: depth < 6 ? menuBookmarks(b, n.id, depth + 1) : [] },
  );
}

type BookmarkMenus = Pick<MenuState, "bookmarkFolders" | "recentBookmarks" | "bookmarksBar" | "otherBookmarks">;
const bookmarkMenuCache = new WeakMap<Bookmarks, Map<string, BookmarkMenus>>();

function bookmarkMenus(b: Bookmarks, engine: string): BookmarkMenus {
  let perEngine = bookmarkMenuCache.get(b);
  if (!perEngine) bookmarkMenuCache.set(b, (perEngine = new Map()));
  const cached = perEngine.get(engine);
  if (cached) return cached;
  const roots = engineBookmarkRoots(b, engine);
  const menus: BookmarkMenus = roots
    ? {
        bookmarkFolders: [
          { id: roots.bar, title: ROOT_TITLES.bar },
          { id: roots.other, title: ROOT_TITLES.other },
          ...[...folderChildren(b, roots.bar), ...folderChildren(b, roots.other)]
            .filter((n) => n.kind === "folder")
            .map((n) => ({ id: n.id, title: n.title })),
        ],
        recentBookmarks: Object.values(b.nodes)
          .filter((n): n is Extract<BookmarkNode, { kind: "url" }> => n.kind === "url" && isWithin(b, n.id, [roots.bar, roots.other]))
          .sort((x, y) => y.addedAt - x.addedAt)
          .slice(0, 5)
          .map((n) => ({ id: n.id, title: n.title || n.url, url: n.url })),
        bookmarksBar: menuBookmarks(b, roots.bar),
        otherBookmarks: menuBookmarks(b, roots.other) }
    : { bookmarkFolders: [], recentBookmarks: [], bookmarksBar: [], otherBookmarks: [] };
  perEngine.set(engine, menus);
  return menus;
}

export function menuState(s: BrowserState): MenuState {
  const focused = focusedWindowOf(s);
  const windowId = focused && s.windows[focused] ? focused : undefined;
  const w = windowId ? s.windows[windowId] : undefined;
  const tab = windowId ? activeTab(s, windowId) : undefined;
  const peek = windowId ? peekTabId(s, windowId) : undefined;
  const page = peek ? s.tabs[peek] : tab;
  const live = page ? s.live[page.id] : undefined;
  const bookmarkProfile = bookmarkProfileId(s, w);
  const regularWindows = s.windowOrder.filter((id) => s.windows[id]!.kind !== "private" && s.windows[id]!.kind !== "small");

  const disabled: string[] = [];
  if (!tab || !splitOf(s, tab.id)) disabled.push("focusNextPane", "focusPreviousPane");
  if (w && tabLayoutOf(s, w.id) === "top") disabled.push("toggleAddressBar");
  if (!w) disabled.push(...WINDOW_COMMANDS);
  else {
    if (!page?.url) disabled.push(...PAGE_COMMANDS);
    else if (isInternalTab(page)) disabled.push(...PAGE_COMMANDS_OFF_INTERNAL_PAGES);
    if (!page || !canGoBack(page.id, live ?? IDLE_LIVE)) disabled.push("back");
    if (!page || !canGoForward(page.id, live ?? IDLE_LIVE)) disabled.push("forward");
    if (!live?.isLoading) disabled.push("stop");
    if (w.kind === "private") disabled.push("moveTabToProfile", "moveTabToWindow", "switchProfile", "nextProfile", "previousProfile");
    else if (tab) disabled.push(`moveTabToProfile:${tab.profileId}`);
    if (regularWindows.length < 2) disabled.push("mergeAllWindows");
  }
  if (!s.closedTabs.length && !s.closedWindows.length && !s.closedGroups.length) disabled.push("reopenClosedTab");
  if (!s.closedWindows.length) disabled.push("reopenClosedWindow");

  const checked = settingChecks(s.settings);
  if (s.settings.addressBar === "sidebar") checked.push("toggleAddressBar");
  if (tabLayoutOf(s, windowId) === "sidebar") checked.push("toggleTabLayout");
  if (w && !w.sidebarOpen) checked.push("toggleSidebar");

  const titles: Record<string, string> = {};
  if (tab?.pin) titles.togglePin = togglePinTitle(tab);
  if (isPinnedRow(tab)) titles["togglePin:tile"] = "Move to Top Apps";
  else disabled.push("togglePin:tile");
  if (page) titles.toggleMute = muteTitle(muteState(s, page));
  if (page && tabEngine(s, page.id) === "webkit") titles.togglePageEngine = "Open Page in Chromium";
  if (!canSwitchEngine(page?.url)) disabled.push("togglePageEngine");
  if (page?.url && isBookmarked(s, bookmarkProfile, page.url)) {
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
    windows: w?.kind === "private" ? [] : regularWindows.filter((id) => id !== windowId).map((id) => ({ id, title: windowTitle(s, id) })),
    ...bookmarkMenus(s.bookmarks, engineProfile(s, bookmarkProfile)),
    recentlyClosed: closed,
    recentlyClosedGroups: sidebar.recentlyClosedGroups,
    warnBeforeQuitting: s.settings.warnBeforeQuitting,
    warnBeforeClosingWindow: s.settings.warnBeforeClosingWindow,
    undoReopensClosedTab: s.settings.undoReopensClosedTab,
    downloadsInProgress: s.downloads.filter((d) => d.state === "downloading").length,
    shortcuts: menuBarBindings(s),
    extensions: extensionMenu(s, windowId) };
}
