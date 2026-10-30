import type { BrowserCommand, MenuBookmark, MenuItem, MenuState, ShortcutModifier } from "@ardia-real/shell";
import { commandSpec } from "./commandCatalog";

type MenuModifier = "command" | "shift" | "option" | "control";
export type AppMenuShortcuts = ReadonlyMap<string, { key: string; modifiers: readonly ShortcutModifier[] }>;
export type AppMenuChoice =
  | { kind: "window"; action: "minimize" | "maximize" | "close" }
  | { kind: "command"; command: BrowserCommand; arg: string | null };

const WINDOW_ACTION_PREFIX = "window:";
const separator: MenuItem = { separator: true };

const commandTitle = (command: string, arg?: string) => {
  const spec = commandSpec(command);
  return (arg && spec?.variants?.[arg]?.title) || spec?.title || command;
};

const hasGroupLinks = (nodes: readonly MenuBookmark[]): boolean => nodes.some((node) => {
  if (node.children) return hasGroupLinks(node.children);
  const url = (node.url ?? "").toLowerCase();
  return url.startsWith("http:") || url.startsWith("https:") || url.startsWith("file:");
});

export function appMenuItems(state: MenuState, shortcuts: AppMenuShortcuts = new Map()): MenuItem[] {
  const disabled = new Set(state.disabled);
  const checked = new Set(state.checked);
  const cmd = (command: BrowserCommand, arg?: string, title?: string): MenuItem => {
    const id = arg ? `${command}:${arg}` : command;
    const shortcut = shortcuts.get(id);
    const modifiers = shortcut?.modifiers.filter((modifier): modifier is MenuModifier => modifier !== "function") ?? [];
    return {
      id,
      title: state.titles[id] ?? title ?? commandTitle(command, arg),
      enabled: !disabled.has(id) && !disabled.has(command),
      checked: checked.has(id),
      ...(shortcut?.key ? { key: shortcut.key, modifiers } : {}),
    };
  };
  const windowAction = (action: string, title: string): MenuItem => ({ id: `${WINDOW_ACTION_PREFIX}${action}`, title });
  const sub = (title: string, children: MenuItem[]): MenuItem => ({ id: `menu:${title}`, title, children });
  const header = (title: string): MenuItem => ({ id: `header:${title}`, title, enabled: false });
  const empty: MenuItem = { id: "empty", title: "Empty", enabled: false };
  const entry = (command: BrowserCommand, current?: boolean) => (e: { id: string; title: string; current?: boolean }): MenuItem => ({
    ...cmd(command, e.id, e.title),
    checked: current ? !!e.current : false,
  });
  const multipleProfiles = state.profiles.length > 1;

  const bookmark = (node: MenuBookmark, holdsArcHolders = false): MenuItem => node.children
    ? folder(node.title, node.children, node.id, false, holdsArcHolders && node.title.endsWith(" (Arc)"))
    : cmd("openBookmark", node.id, node.title || node.url || "");
  const folder = (title: string, children: readonly MenuBookmark[], id?: string, holdsArcHolders = false, arcHolder = false): MenuItem => {
    const items = children.length ? children.map((child) => bookmark(child, holdsArcHolders)) : [empty];
    if (id && hasGroupLinks(children)) {
      items.push(separator, cmd("addFolderToSidebar", id, "Add to Sidebar as Group"));
      if (arcHolder && children.some((child) => child.children && hasGroupLinks(child.children)))
        items.push(cmd("restoreArcFolders", id, "Restore Arc Folders as Groups"));
    }
    return { id: `folder:${id ?? title}`, title, symbol: "folder", children: items };
  };

  const closedGroups = state.recentlyClosedGroups ?? [];
  const extensions = state.extensions ?? [];

  return [
    sub("Ardia", [
      cmd("openSettings"),
      cmd("importBrowserData"),
    ]),
    sub("File", [
      cmd("newTab"),
      cmd("newTabInGroup"),
      cmd("newWindow"),
      cmd("newLittleArdia"),
      ...(multipleProfiles ? [sub("New Little Ardia Window in Profile", state.profiles.map(entry("newLittleArdia")))] : []),
      cmd("toggleOpenLinksInLittleArdia"),
      cmd("reopenClosedTab"),
      cmd("reopenClosedWindow"),
      cmd("openFile"),
      separator,
      cmd("focusCommandBar"),
      separator,
      windowAction("close", "Close Window"),
      cmd("closeTab"),
      cmd("closeAllTabs"),
      cmd("cleanUpTabs"),
      separator,
      cmd("savePage"),
      cmd("emailPageLocation"),
      cmd("print"),
      cmd("printWithSystemDialog"),
    ]),
    sub("Edit", [
      cmd("copyUrl"),
      cmd("copyUrlAsMarkdown"),
      separator,
      sub("Find", [
        cmd("findInPage"),
        cmd("findAndReplace"),
        cmd("findNext"),
        cmd("findPrevious"),
        cmd("useSelectionForFind"),
        cmd("jumpToSelection"),
      ]),
      sub("AutoFill", [
        cmd("autofill", "contact"),
        cmd("autofill", "passwords"),
        cmd("autofill", "creditCard"),
      ]),
    ]),
    sub("View", [
      sub("Appearance", [cmd("setAppearance", "auto"), cmd("setAppearance", "light"), cmd("setAppearance", "dark")]),
      cmd("stop"),
      cmd("reload"),
      cmd("forceReload"),
      separator,
      cmd("toggleTabLayout"),
      cmd("toggleSidebar"),
      separator,
      cmd("openSplitPane"),
      cmd("focusNextPane"),
      cmd("focusPreviousPane"),
      separator,
      sub("Show Bookmarks Bar", [
        cmd("setBookmarksBar", "always"),
        cmd("setBookmarksBar", "newTab"),
        cmd("setBookmarksBar", "never"),
        separator,
        cmd("toggleBookmarksBar"),
      ]),
      separator,
      cmd("toggleFullUrl"),
      cmd("toggleAddressBar"),
      cmd("cast"),
      separator,
      cmd("zoomReset"),
      cmd("zoomIn"),
      cmd("zoomOut"),
      separator,
      sub("Developer", [
        cmd("viewSource"),
        cmd("devTools"),
        cmd("inspectElements"),
        cmd("javaScriptConsole"),
      ]),
    ]),
    sub("Tabs", [
      cmd("back"),
      cmd("forward"),
      separator,
      cmd("nextTab"),
      cmd("previousTab"),
      cmd("searchTabs"),
      separator,
      cmd("togglePin"),
      ...(disabled.has("togglePin:tile") ? [] : [cmd("togglePin", "tile")]),
      cmd("togglePinnedRow"),
      cmd("duplicateTab"),
      cmd("newGroupWithTabs"),
      separator,
      sub("Move to Profile", [...state.profiles.map(entry("moveTabToProfile", true)), separator, cmd("moveTabToProfile", "new", "New Profile…")]),
      sub("Move to Window", [...state.windows.map(entry("moveTabToWindow")), ...(state.windows.length ? [separator] : []), cmd("moveTabToWindow", "new", "New Window")]),
      separator,
      cmd("bookmarkPage"),
      sub("Add Bookmark to Folder", [...state.bookmarkFolders.map(entry("addBookmarkToFolder")), separator, cmd("addBookmarkToFolder", "new", "New Folder…")]),
      separator,
      cmd("renameTab"),
      cmd("changeTabIcon"),
      cmd("toggleMute"),
    ]),
    sub("Bookmarks", [
      cmd("bookmarkPage", undefined, state.titles.bookmarkPage ?? "Bookmark This Page"),
      cmd("bookmarkAllTabs"),
      cmd("manageBookmarks"),
      separator,
      ...(state.recentBookmarks.length ? [header("Recent Bookmarks"), ...state.recentBookmarks.map((node) => bookmark(node)), separator] : []),
      folder("Bookmarks Bar", state.bookmarksBar, undefined, true),
      folder("Other Bookmarks", state.otherBookmarks),
    ]),
    sub("History", [
      cmd("showHistory"),
      cmd("clearBrowsingData"),
      separator,
      header("Recently Closed"),
      ...(state.recentlyClosed.length ? state.recentlyClosed.map(entry("restoreClosed")) : [empty]),
      ...(closedGroups.length ? [separator, header("Recently Closed Groups"), ...closedGroups.map(entry("restoreClosed"))] : []),
    ]),
    sub("Extensions", [
      ...extensions.map((extension) => cmd("openExtension", extension.id, extension.title)),
      ...(extensions.length ? [separator] : []),
      cmd("addExtension"),
      cmd("manageExtensions"),
      cmd("pinExtensions"),
    ]),
    sub("Window", [
      windowAction("minimize", "Minimize"),
      windowAction("maximize", "Maximize"),
      separator,
      cmd("downloads"),
      cmd("taskManager"),
      cmd("mergeAllWindows"),
      ...(multipleProfiles ? [separator, sub("Profiles", [
        ...state.profiles.map(entry("switchProfile", true)),
        separator,
        cmd("nextProfile"),
        cmd("previousProfile"),
        separator,
        cmd("newProfile"),
      ])] : []),
    ]),
    sub("Help", [
      cmd("sendFeedback"),
      cmd("keyboardShortcuts"),
      cmd("toolTour"),
      separator,
      cmd("copyDiagnostics"),
      cmd("recordPerformanceIssue"),
    ]),
  ];
}

export function appMenuChoice(id: string): AppMenuChoice | null {
  if (id.startsWith(WINDOW_ACTION_PREFIX)) {
    const action = id.slice(WINDOW_ACTION_PREFIX.length);
    return action === "minimize" || action === "maximize" || action === "close" ? { kind: "window", action } : null;
  }
  const colon = id.indexOf(":");
  const command = colon < 0 ? id : id.slice(0, colon);
  if (!commandSpec(command)) return null;
  return { kind: "command", command: command as BrowserCommand, arg: colon < 0 ? null : id.slice(colon + 1) };
}
