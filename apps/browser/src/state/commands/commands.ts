import { closeWindow as closeNativeWindow } from "../../platform/windows";
import { copyText } from "../../platform/clipboard";
import { openExternalURL, setAppearance } from "../../platform/app";
import { pickFiles, prompt } from "../../platform/dialogs";
import type { CommandEvent } from "../../platform/commands";
import { markdownLink } from "@ardia/core";
import { useBrowser } from "../browser/store";
import { activeTabId, bookmarkProfileId, isPinnedRow, resolveWindowId } from "../browser/model";
import {
  closeGroup,
  closeTab,
  createProfile,
  cycleProfile,
  focus,
  moveTabToProfile,
  moveTabToWindow,
  openProfileMenu,
  openWindow,
  switchProfile,
  toggleMute,
} from "../browser/actions";
import { bookmarkAllTabs, bookmarkTab } from "../bookmarks/actions";
import { exportBookmarksFromWindow } from "../bookmarks/exportHtml";
import { requestClearData } from "../profiles/clearDataRequest";
import { openInternalPage } from "../pages/urls";
import { isUtilityWindowId, openImport, openSettings, SETTINGS_WINDOW_ID } from "../settings/settingsWindows";
import { focusSettingsSearch } from "../settings/searchState";
import { closePanelToHeroBar, focusHeroBar } from "../omnibox/barState";
import { closeNewTabBar, isEmptyCardTab, showNewTabBar, toggleNewTabBar } from "../omnibox/newTabBar";
import { NEW_TAB_BAR_POLICY } from "../omnibox/newTabBarPolicy";
import { addressBarInSidebar, commandBarCentred } from "../windows/layout";
import { addFolderToSidebar, restoreArcFolders } from "../bookmarks/bookmarkGroups";
import { withLivePage } from "../tabs/livePage";
import { webviews } from "../../platform/webviews";
import { togglePageEngine } from "../engines/actions";
import { goBack, goForward } from "../tabs/navigation";
import { openSplitPane } from "../splits/actions";
import { LITTLE_ARDIA_PAGE_COMMANDS } from "./commandCatalog";
import { runSidebarCommand } from "../sidebar/commands";
import { numberedTabs } from "../sidebar/entries";
import { openExtensionFromMenu } from "../extensions/bridge";
import { toggleCastPicker } from "../media/cast";
import { openManageExtensions, openPinDialog, openWebStore } from "../extensions/actions";
import { requestAutofill } from "../site/autofill";
import { copyPageUrl, jumpToSelection } from "../site/selection";
import { shareTab } from "../site/share";
import { groupOf } from "../pins/organize";
import { isSmall, mainWindowFor, originalProfile } from "../windows/small";
import {
  closeLittleArdia,
  cycleLittleArdiaProfile,
  moveLittleArdiaToProfile,
  openInMainWindow,
  openLittleArdia,
  openLittleArdiaProfileMenu,
} from "../littleArdia/actions";
import { runPeekCommand } from "../peek/actions";
import { peekTabId } from "../peek/peek";
import { expectFocus, findFocus } from "../focus/focusClaims";

export function runCommand({ command, arg, windowId: requested }: CommandEvent) {
  const s = useBrowser.getState();

  if (isUtilityWindowId(requested)) {
    if (command === "closeTab") return void closeNativeWindow(requested!);
    if (command === "findInPage" && requested === SETTINGS_WINDOW_ID) return focusSettingsSearch();
    requested = null;
  }
  if (isSmall(s, requested) && runLittleArdiaCommand(command, arg, requested!)) return;
  if (runPeekCommand(command, resolveWindowId(s, requested) ?? "")) return;

  switch (command) {
    case "newWindow":
      return void openWindow({ profileId: arg ?? undefined });
    case "newIncognitoWindow":
      return void openWindow({ incognito: true, profileId: originalProfile(s, s.windows[requested ?? ""]) });
    case "newLittleArdia":
      return void openLittleArdia(undefined, arg ?? undefined);
    case "toggleOpenLinksInLittleArdia":
      return s.updateSettings({ openLinksInLittleArdia: !s.settings.openLinksInLittleArdia });
    case "reopenClosedWindow":
      return s.reopenClosedWindow();
    case "setAppearance":
      if (arg === "auto" || arg === "light" || arg === "dark") {
        s.updateSettings({ appearance: arg });
        void setAppearance(arg);
      }
      return;
    case "toggleFullUrl":
      return s.updateSettings({ showFullUrl: !s.settings.showFullUrl });
    case "toggleJavaScriptFromAppleEvents":
      return s.updateSettings({ allowJavaScriptFromAppleEvents: !s.settings.allowJavaScriptFromAppleEvents });
    case "toggleAddressBar":
      return s.updateSettings({ addressBar: s.settings.addressBar === "sidebar" ? "toolbar" : "sidebar" });
    case "openSettings":
      return openSettings();
    case "keyboardShortcuts":
      return openSettings("shortcuts");
    case "importBrowserData":
      return openImport();
    case "openFile":
      return void openFiles(requested);
    case "manageExtensions":
      return openManageExtensions(requested);
    case "setBookmarksBar":
      if (arg === "always" || arg === "newTab" || arg === "never") s.updateSettings({ bookmarksBar: arg });
      return;
    case "toggleBookmarksBar": {
      const mode = s.settings.bookmarksBar;
      const target = resolveWindowId(s, requested);
      const active = target ? activeTabId(s, target) : undefined;
      const shown = mode === "always" || (mode === "newTab" && !(active && s.tabs[active]?.url));
      return s.updateSettings({ bookmarksBar: shown ? "never" : "always" });
    }
  }

  const invokedFrom = requested;
  if (isSmall(s, requested) && !LITTLE_ARDIA_PAGE_COMMANDS.has(command)) {
    requested = mainWindowFor(s, s.windows[requested!]!.profileId) ?? null;
    if (requested) focus(requested);
  }

  if (command === "addFolderToSidebar" || command === "restoreArcFolders") {
    const target = resolveWindowId(s, invokedFrom) ?? null;
    if (arg && command === "addFolderToSidebar") addFolderToSidebar(arg, target);
    else if (arg) restoreArcFolders(arg, target);
    return;
  }

  const windowId = resolveWindowId(s, requested);
  if (!windowId) {
    if (command === "newTab") openWindow();
    if (command === "reopenClosedTab" || command === "restoreClosed") {
      if (arg) s.restoreClosed(arg);
      else s.reopenClosed();
    }
    return;
  }
  const tabId = (LITTLE_ARDIA_PAGE_COMMANDS.has(command) && peekTabId(s, windowId)) || activeTabId(s, windowId);
  const tab = tabId ? s.tabs[tabId] : undefined;
  const page = tab?.url ? tab : undefined;
  const web = tabId ? webviews.get(tabId) : undefined;
  const ui = s.windowUi[windowId];
  const find = tabId ? s.find[tabId] : undefined;
  if (runSidebarCommand(command, arg, windowId)) return;

  switch (command) {
    case "newTab":
      if (toggleNewTabBar(windowId)) return;
      return void s.newTab(windowId, { newTabCommand: true });
    case "reopenClosedTab":
      return s.reopenClosed(windowId);
    case "restoreClosed":
      return arg ? s.restoreClosed(arg, windowId) : undefined;
    case "focusCommandBar":
      if (page) return s.openPanel(windowId, page.url);
      if (isEmptyCardTab(s, tab) && showNewTabBar(windowId)) return;
      if (tab && addressBarInSidebar(s, windowId) && !commandBarCentred(s, windowId)) return s.openPanel(windowId, "");
      if (!focusHeroBar(windowId, tabId)) return tab ? s.openPanel(windowId, "") : undefined;
      return ui?.panel.open ? s.closePanel(windowId) : undefined;
    case "closeTab":
      if (ui?.panel.newTab) {
        closeNewTabBar(windowId);
        if (NEW_TAB_BAR_POLICY.closeTabKeyOnlyDismissesBar || !tabId) return;
        return void closeTab(tabId);
      }
      if (ui?.panel.open) return tabId ? closePanelToHeroBar(windowId, tabId, "closeKey") : s.closePanel(windowId);
      return tabId ? void closeTab(tabId) : undefined;
    case "print":
      return void web?.print();
    case "printWithSystemDialog":
      return void web?.runPageCommand("systemPrint");
    case "savePage":
      return void web?.runPageCommand("savePage");
    case "caretBrowsing":
      return void web?.runPageCommand("caretBrowsing");
    case "emailPageLocation":
      if (!page || !/^https?:/i.test(page.url)) return;
      return void openExternalURL(
        `mailto:?subject=${encodeURIComponent(page.customTitle || page.title || page.url)}&body=${encodeURIComponent(page.url)}`,
      );
    case "stop":
      return void web?.stopLoading();
    case "share":
      return void shareTab(page, windowId, arg?.startsWith("via:") ? arg.slice(4) : null);
    case "copyUrl":
      return page ? void copyPageUrl(page.id) : undefined;
    case "copyUrlAsMarkdown":
      return page ? copyText(markdownLink(page.customTitle || page.title, page.url)) : undefined;
    case "findInPage":
      if (page) expectFocus(windowId, findFocus(page.id));
      return page ? s.setFind(page.id, { open: true, replace: false, focusRequest: Date.now() }) : undefined;
    case "findAndReplace":
      return page ? s.setFind(page.id, { open: true, replace: true, focusRequest: Date.now() }) : undefined;
    case "jumpToSelection":
      return page ? void jumpToSelection(page.id) : undefined;
    case "useSelectionForFind":
      if (!page || !web) return;
      return void web.evaluate<string>("post('result', JSON.stringify(String(getSelection() || '').trim().slice(0, 500)))").then((query) => {
        if (query) useBrowser.getState().setFind(page.id, { open: true, query, focusRequest: Date.now() });
      });
    case "findNext":
    case "findPrevious":
      if (!page) return;
      if (!find?.query) return s.setFind(page.id, { open: true });
      return void web?.find(find.query, command === "findNext", true);
    case "reload":
      return void (tabId && withLivePage(tabId, (page) => page.reload()));
    case "forceReload":
      return void (tabId && withLivePage(tabId, (page) => page.forceReload()));
    case "toggleTabLayout":
      return s.toggleTabLayout(windowId);
    case "openSplitPane":
      return void openSplitPane(windowId);
    case "focusNextPane":
      return s.focusPane(windowId, 1);
    case "focusPreviousPane":
      return s.focusPane(windowId, -1);
    case "toggleSidebar":
      return s.toggleSidebar(windowId);
    case "zoomIn":
      return page ? void web?.zoomStep(1) : undefined;
    case "zoomOut":
      return page ? void web?.zoomStep(-1) : undefined;
    case "zoomReset":
      return page ? void web?.zoomStep(0) : undefined;
    case "devTools":
      return void web?.showDevTools();
    case "toggleDevTools":
      return void web?.showDevTools("toggle");
    case "inspectElements":
      return void web?.showDevTools("inspect");
    case "javaScriptConsole":
      return void web?.showDevTools("console");
    case "viewSource":
      if (!page || !web || !/^(https?|file):/.test(page.url)) return;
      return void s.newTab(windowId, { url: `view-source:${page.url}`, openerId: page.id, profileId: page.profileId });
    case "back":
      return tabId ? goBack(tabId) : undefined;
    case "forward":
      return tabId ? goForward(tabId) : undefined;
    case "nextTab":
      return s.cycle(windowId, 1);
    case "previousTab":
      return s.cycle(windowId, -1);
    case "selectTab":
    case "selectLastTab": {
      const rows = numberedTabs(s, windowId);
      const id = command === "selectLastTab" ? rows.at(-1) : rows[Number(arg) - 1];
      return id ? s.activate(id) : undefined;
    }
    case "togglePin":
      if (!tab) return;
      if (arg === "row") return s.pinTabs([tab.id], true, !isPinnedRow(tab));
      if (arg === "tile") return isPinnedRow(tab) ? s.pinTabs([tab.id], true, false) : undefined;
      return s.togglePin(tab.id);
    case "moveTabDown":
    case "moveTabUp":
      return tab ? s.moveTabBy(tab.id, command === "moveTabDown" ? 1 : -1) : undefined;
    case "closeTabGroup": {
      const group = groupOf(s, tabId);
      return group ? void closeGroup(group.id) : undefined;
    }
    case "openProfileMenu":
      return s.windows[windowId]?.incognito ? undefined : void openProfileMenu(windowId);
    case "duplicateTab":
      return tab ? void s.duplicateTab(tab.id) : undefined;
    case "moveTabToProfile":
      return tab && arg ? void moveTabToProfile(tab.id, arg) : undefined;
    case "moveTabToWindow":
      return tab && arg ? moveTabToWindow(tab.id, arg) : undefined;
    case "bookmarkPage":
      return page ? bookmarkTab(windowId, page.id) : undefined;
    case "addBookmarkToFolder":
      return page && arg ? void addBookmarkToFolder(windowId, page.id, arg) : undefined;
    case "openBookmark": {
      const node = arg ? s.bookmarks.nodes[arg] : undefined;
      return node?.kind === "url" && tab ? s.navigate(tab.id, node.url) : undefined;
    }
    case "togglePageEngine":
      return void (tabId && togglePageEngine(tabId));
    case "toggleMute":
      return page ? toggleMute(page.id) : undefined;
    case "downloads":
      return s.setDownloadsOpen(windowId, !ui?.downloadsOpen);
    case "cast":
      return void toggleCastPicker(windowId, tabId);
    case "showHistory":
      return openInternalPage("history", windowId);
    case "clearBrowsingData":
      openInternalPage("history", windowId);
      return requestClearData(windowId);
    case "manageBookmarks":
      return openInternalPage("bookmarks", windowId);
    case "exportBookmarks":
      return void exportBookmarksFromWindow(windowId);
    case "bookmarkAllTabs":
      return bookmarkAllTabs(windowId);
    case "mergeAllWindows":
      return s.mergeAllWindows(windowId);
    case "switchProfile":
      return arg ? switchProfile(windowId, arg, true) : undefined;
    case "nextProfile":
      return cycleProfile(windowId, 1);
    case "previousProfile":
      return cycleProfile(windowId, -1);
    case "openExtension":
      return arg ? openExtensionFromMenu(windowId, arg, tabId) : undefined;
    case "addExtension":
      return void openWebStore(windowId);
    case "pinExtensions":
      return openPinDialog(windowId);
    case "autofill":
      return void requestAutofill(windowId, arg, tabId);
    case "newProfile":
      return void createProfile(windowId).then((id) => id && switchProfile(windowId, id));
  }
}

function runLittleArdiaCommand(command: string, arg: string | null | undefined, windowId: string): boolean {
  const s = useBrowser.getState();
  const tabId = activeTabId(s, windowId);
  const tab = tabId ? s.tabs[tabId] : undefined;
  switch (command) {
    case "closeTab":
      if (s.windowUi[windowId]?.panel.open && tab?.url) s.closePanel(windowId);
      else closeLittleArdia(windowId);
      return true;
    case "focusCommandBar":
      s.openPanel(windowId, tab?.url ?? "");
      return true;
    case "openFile":
      openInMainWindow(windowId);
      return true;
    case "switchProfile":
      if (arg) moveLittleArdiaToProfile(windowId, arg);
      return true;
    case "nextProfile":
      cycleLittleArdiaProfile(windowId, 1);
      return true;
    case "previousProfile":
      cycleLittleArdiaProfile(windowId, -1);
      return true;
    case "openProfileMenu":
      void openLittleArdiaProfileMenu(windowId);
      return true;
  }
  return false;
}

async function addBookmarkToFolder(windowId: string, tabId: string, folder: string) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  if (!tab?.url) return;
  const profileId = bookmarkProfileId(s, s.windows[windowId]);
  let parentId = folder;
  if (folder === "new") {
    const title = await prompt({ title: "New Folder", placeholder: "Folder name", confirmTitle: "Create", windowId });
    if (!title) return;
    parentId = useBrowser.getState().addBookmarkFolder({ profileId, title });
  }
  useBrowser.getState().addBookmark({ profileId, url: tab.url, title: tab.title, favicon: tab.favicon, parentId });
}

async function openFiles(windowId: string | null) {
  const urls = await pickFiles();
  if (!urls.length) return;
  const s = useBrowser.getState();
  const target = resolveWindowId(s, windowId);
  if (!target) return void openWindow({ url: urls[0] });
  let last: string | undefined;
  for (const url of urls) last = useBrowser.getState().newTab(target, { url });
  if (last) useBrowser.getState().activate(last);
}
