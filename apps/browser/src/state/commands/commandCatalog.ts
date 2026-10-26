import type { BrowserCommand } from "../../platform/commands";
import { parseShortcut, type ShortcutSource } from "./shortcuts";

type Keys = readonly string[];
type Scope = "page" | "window";
type InLittleArdia = "page" | "off";
type Variant = { title?: string; barTitle?: string; symbol?: string; keys?: Keys };
type CommandSpec = Variant & {
  scope?: Scope;
  onInternalPages?: true;
  littleArdia?: InLittleArdia;
  variants?: Readonly<Record<string, Variant>>;
};

const inWindow = { scope: "window" } as const;
const pageInLittleArdia = { scope: "page", littleArdia: "page" } as const;
const offInLittleArdia = { littleArdia: "off" } as const;
const windowOffInLittleArdia = { scope: "window", littleArdia: "off" } as const;

export const COMMANDS: Readonly<Record<BrowserCommand, CommandSpec>> = {
  newTab: { title: "New Tab", symbol: "plus", keys: ["⌘T"] },
  newWindow: { title: "New Window", symbol: "macwindow", keys: ["⌘N"] },
  newIncognitoWindow: { title: "New Incognito Window", symbol: "eyeglasses", keys: ["⇧⌘N"] },
  newLittleArdia: { title: "New Little Ardia Window", keys: ["⌥⌘N"] },
  toggleOpenLinksInLittleArdia: { title: "Open Links from Other Apps in Main Window" },
  reopenClosedTab: { title: "Reopen Closed Tab", symbol: "arrow.uturn.backward", keys: ["⇧⌘T"], littleArdia: "page" },
  reopenClosedWindow: { title: "Reopen Closed Window" },
  restoreClosed: { littleArdia: "page" },
  focusCommandBar: { title: "Open Command Bar", keys: ["⌘L", "⌃F5"], ...inWindow },
  closeTab: { title: "Close Tab", symbol: "xmark", keys: ["⌘W"], ...inWindow },
  closeAllTabs: { title: "Close All Tabs", symbol: "xmark.square", keys: ["⇧⌘K"], ...windowOffInLittleArdia },
  print: { title: "Print…", symbol: "printer", keys: ["⌘P"], ...pageInLittleArdia },
  copyUrl: { title: "Copy URL", symbol: "link", keys: ["⇧⌘C"], ...pageInLittleArdia, onInternalPages: true },
  copyUrlAsMarkdown: { title: "Copy URL as Markdown", symbol: "link", keys: ["⌥⇧⌘C"], ...pageInLittleArdia, onInternalPages: true },
  findInPage: { title: "Find…", barTitle: "Find in Page", symbol: "text.magnifyingglass", keys: ["⌘F"], ...pageInLittleArdia },
  findNext: { title: "Find Next", keys: ["⌘G"], ...pageInLittleArdia },
  findPrevious: { title: "Find Previous", keys: ["⇧⌘G"], ...pageInLittleArdia },
  setAppearance: {
    variants: {
      auto: { title: "Automatic", barTitle: "Use System Appearance", symbol: "circle.lefthalf.filled" },
      light: { title: "Light", barTitle: "Light Appearance", symbol: "sun.max" },
      dark: { title: "Dark", barTitle: "Dark Appearance", symbol: "moon" },
    },
  },
  reload: { title: "Refresh", barTitle: "Reload Page", symbol: "arrow.clockwise", keys: ["⌘R"], ...pageInLittleArdia },
  forceReload: { title: "Force Refresh the Page", barTitle: "Force Reload Page", symbol: "arrow.clockwise", keys: ["⇧⌘R"], ...pageInLittleArdia },
  toggleTabLayout: { title: "Show Tabs in Sidebar", keys: ["⇧⌘S"], ...windowOffInLittleArdia },
  toggleSidebar: { title: "Auto-Hide Tabs", symbol: "sidebar.left", keys: ["⌘S", "⇧⌘L", "⇧⌘F"], ...windowOffInLittleArdia },
  openSplitPane: { title: "Open Split Pane", keys: ["⌃⇧=", "⌃+"], ...windowOffInLittleArdia },
  useSelectionForFind: { title: "Use Selection for Find", keys: ["⌘E"], ...pageInLittleArdia },
  findAndReplace: { title: "Find and Replace…", keys: ["⌥⌘F"], ...pageInLittleArdia },
  jumpToSelection: { title: "Jump to Selection", keys: ["⌘J"], ...pageInLittleArdia },
  focusNextPane: { title: "Focus Next Split Pane", keys: ["⌃⇧]", "⌃}"], ...offInLittleArdia },
  focusPreviousPane: { title: "Focus Previous Split Pane", keys: ["⌃⇧[", "⌃{"], ...offInLittleArdia },
  toggleFullUrl: { title: "Show Full URL", symbol: "text.alignleft" },
  toggleJavaScriptFromAppleEvents: { title: "Allow JavaScript from Apple Events" },
  toggleAddressBar: { title: "Show Address Bar in Sidebar", ...offInLittleArdia },
  cast: { title: "Cast…", littleArdia: "page" },
  zoomReset: { title: "Zoom to Actual Size", barTitle: "Actual Size", symbol: "1.magnifyingglass", keys: ["⌘0"], ...pageInLittleArdia },
  zoomIn: { title: "Zoom In", symbol: "plus.magnifyingglass", keys: ["⌘+", "⌘="], ...pageInLittleArdia },
  zoomOut: { title: "Zoom Out", symbol: "minus.magnifyingglass", keys: ["⌘-"], ...pageInLittleArdia },
  devTools: { title: "Developer Tools", symbol: "hammer", keys: ["⌥⌘I"], ...pageInLittleArdia },
  toggleDevTools: { title: "Toggle Developer Tools", keys: ["F12"], ...pageInLittleArdia },
  javaScriptConsole: { title: "JavaScript Console", keys: ["⌥⌘J"], ...pageInLittleArdia },
  inspectElements: { title: "Inspect Elements", keys: ["⌥⌘C"], ...pageInLittleArdia },
  viewSource: { title: "View Source", keys: ["⌥⌘U"], ...pageInLittleArdia },
  back: { title: "Go Back", keys: ["⌘[", "⌘←"], scope: "window", littleArdia: "page" },
  forward: { title: "Go Forward", keys: ["⌘]", "⌘→"], scope: "window", littleArdia: "page" },
  nextTab: { title: "Next Tab", keys: ["⇧⌘]", "⌘}", "⌥⌘→", "⌃⇟", "⌥⌘↓"], ...windowOffInLittleArdia },
  previousTab: { title: "Previous Tab", keys: ["⇧⌘[", "⌘{", "⌥⌘←", "⌃⇞", "⌥⌘↑"], ...windowOffInLittleArdia },
  selectTab: {
    ...windowOffInLittleArdia,
    variants: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), { title: `Select Tab ${n}`, keys: [`⌘${n}`] }])),
  },
  selectLastTab: { title: "Select Last Tab", keys: ["⌘9"], ...windowOffInLittleArdia },
  togglePin: {
    title: "Move to Top Apps",
    symbol: "pin",
    ...windowOffInLittleArdia,
    variants: { tile: { title: "Move Pinned Tab to Top Apps" } },
  },
  togglePinnedRow: { title: "Move to Pinned", keys: ["⌥⇧⌘D"], ...windowOffInLittleArdia },
  duplicateTab: { title: "Duplicate", barTitle: "Duplicate Tab", symbol: "plus.square.on.square", ...windowOffInLittleArdia },
  moveTabToProfile: windowOffInLittleArdia,
  moveTabToWindow: windowOffInLittleArdia,
  bookmarkPage: { title: "Add to Bookmarks…", symbol: "bookmark", keys: ["⌘D"], ...pageInLittleArdia, onInternalPages: true },
  addBookmarkToFolder: { ...pageInLittleArdia, onInternalPages: true },
  openBookmark: { scope: "window", littleArdia: "page" },
  addFolderToSidebar: {},
  restoreArcFolders: {},
  toggleMute: { title: "Mute Site", symbol: "speaker.slash", ...pageInLittleArdia },
  togglePageEngine: { title: "Open Page in WebKit" },
  downloads: { title: "Downloads", symbol: "arrow.down.circle", keys: ["⇧⌘J", "⌥⌘L"], scope: "window", littleArdia: "page" },
  mergeAllWindows: { title: "Merge All Windows", symbol: "rectangle.stack", ...windowOffInLittleArdia },
  switchProfile: inWindow,
  nextProfile: { title: "Next Profile", ...inWindow },
  previousProfile: { title: "Previous Profile", ...inWindow },
  newProfile: { title: "New Profile…", symbol: "person.crop.circle.badge.plus" },
  openSettings: { title: "Settings…", symbol: "gearshape", keys: ["⌘,"] },
  importBrowserData: { title: "Import from Another Browser…", barTitle: "Import Browser Data", symbol: "square.and.arrow.down" },
  showHistory: { title: "Show History…", barTitle: "History", symbol: "clock", keys: ["⌘Y"] },
  clearBrowsingData: { title: "Clear Browsing Data…", symbol: "trash", keys: ["⇧⌘⌫"] },
  manageBookmarks: { title: "Manage Bookmarks", barTitle: "Bookmarks", symbol: "book", keys: ["⌥⌘B"] },
  bookmarkAllTabs: { title: "Bookmark All Tabs…", keys: ["⇧⌘D"], ...offInLittleArdia },
  setBookmarksBar: { variants: { always: { title: "Always" }, newTab: { title: "On New Tab Only" }, never: { title: "Never" } } },
  toggleBookmarksBar: { title: "Toggle Bookmarks Bar", symbol: "menubar.rectangle", keys: ["⇧⌘B"] },
  newTabInGroup: { title: "New Tab in Group", keys: ["⌥⌘T", "⌃⌘C"], ...windowOffInLittleArdia },
  newGroupWithTabs: { title: "New Group with Tab", symbol: "folder.badge.plus", keys: ["⌃⌘N", "⌃⌘P"], ...windowOffInLittleArdia },
  cleanUpTabs: { title: "Clean Up Tabs", symbol: "sparkles", keys: ["⌥⌘K"], ...windowOffInLittleArdia },
  tidyPins: { title: "Tidy Pins", symbol: "sparkles" },
  searchTabs: { title: "Search Tabs…", symbol: "magnifyingglass", keys: ["⇧⌘A"], ...windowOffInLittleArdia },
  renameTab: { title: "Rename…", barTitle: "Rename Tab", symbol: "pencil", ...windowOffInLittleArdia },
  changeTabIcon: { title: "Change Icon…", ...windowOffInLittleArdia },
  returnToPinnedUrl: { title: "Back to Pinned URL", keys: ["⌘↩"], ...windowOffInLittleArdia },
  tabSwitcher: {
    ...windowOffInLittleArdia,
    variants: {
      forward: { title: "Tab Switcher (forward)", keys: ["⌃⇥"] },
      backward: { title: "Tab Switcher (backward)", keys: ["⌃⇧⇥"] },
    },
  },
  share: { title: "Share", symbol: "square.and.arrow.up", ...pageInLittleArdia },
  sendFeedback: { title: "Send Feedback…", keys: ["⌥⇧⌘I"] },
  keyboardShortcuts: { title: "Keyboard Shortcuts", symbol: "keyboard" },
  copyDiagnostics: { title: "Copy Diagnostics" },
  recordPerformanceIssue: { title: "Record Performance Issue…" },
  toolTour: { title: "Tool Tour" },
  videoTour: { title: "Video Tour" },
  releaseNotes: { title: "Release Notes" },
  showOnboarding: { title: "Show Onboarding" },
  taskManager: { title: "Task Manager" },
  openExtension: { littleArdia: "page" },
  addExtension: { title: "Add Extension…", littleArdia: "page" },
  manageExtensions: { title: "Manage Extensions…" },
  pinExtensions: { title: "Pin Extensions…" },
  autofill: {
    littleArdia: "page",
    variants: { contact: { title: "Contact…" }, passwords: { title: "Passwords…" }, creditCard: { title: "Credit Card…" } },
  },
  openFile: { title: "Open File…", keys: ["⌘O"] },
  savePage: { title: "Save Page As…", ...pageInLittleArdia },
  emailPageLocation: { title: "Email Page Location", keys: ["⇧⌘I"], ...pageInLittleArdia },
  printWithSystemDialog: { title: "Print Using System Dialog…", keys: ["⌥⌘P"], ...pageInLittleArdia },
  stop: { title: "Stop", keys: ["⌘."], ...pageInLittleArdia },
  caretBrowsing: { title: "Caret Browsing", keys: ["F7"], ...pageInLittleArdia },
  moveTabDown: { title: "Move Tab Down", keys: ["⌃⇧⇟"], ...windowOffInLittleArdia },
  moveTabUp: { title: "Move Tab Up", keys: ["⌃⇧⇞"], ...windowOffInLittleArdia },
  closeTabGroup: { title: "Close Group", keys: ["⌃⌘W"], ...windowOffInLittleArdia },
  openProfileMenu: { title: "Show Profiles Menu", keys: ["⇧⌘M"], ...inWindow },
};

export const STANDARD_ITEMS: Readonly<Record<string, { keys?: Keys }>> = {
  "std:quit:": { keys: ["⌘Q"] },
  "std:hide:": { keys: ["⌘H"] },
  "std:hideOtherApplications:": { keys: ["⌥⌘H"] },
  "std:unhideAllApplications:": {},
  "std:closeWindow:": { keys: ["⇧⌘W"] },
  "std:undo:": { keys: ["⌘Z"] },
  "std:redo:": { keys: ["⇧⌘Z"] },
  "std:cut:": { keys: ["⌘X"] },
  "std:copy:": { keys: ["⌘C"] },
  "std:paste:": { keys: ["⌘V"] },
  "std:pasteAndMatchStyle:": { keys: ["⇧⌘V"] },
  "std:delete:": {},
  "std:selectAll:": { keys: ["⌘A"] },
  "std:showGuessPanel:": { keys: ["⌘:"] },
  "std:checkSpelling:": { keys: ["⌘;"] },
  "std:toggleContinuousSpellChecking:": {},
  "std:toggleGrammarChecking:": {},
  "std:toggleAutomaticSpellingCorrection:": {},
  "std:orderFrontSubstitutionsPanel:": {},
  "std:toggleSmartInsertDelete:": {},
  "std:toggleAutomaticQuoteSubstitution:": {},
  "std:toggleAutomaticDashSubstitution:": {},
  "std:toggleAutomaticLinkDetection:": {},
  "std:toggleAutomaticDataDetection:": {},
  "std:toggleAutomaticTextReplacement:": {},
  "std:uppercaseWord:": {},
  "std:lowercaseWord:": {},
  "std:capitalizeWord:": {},
  "std:startSpeaking:": {},
  "std:stopSpeaking:": {},
  "std:toggleFullScreen:": { keys: ["🌐F", "⌃⌘F"] },
  "std:performMiniaturize:": { keys: ["⌘M"] },
  "std:miniaturizeAll:": { keys: ["⌥⌘M"] },
  "std:performZoom:": {},
  "std:arrangeWindowsInFront:": {},
  "std:toggleKeepOnTop:": {},
};

const ALL_COMMANDS = Object.keys(COMMANDS) as BrowserCommand[];
const commandsWhere = (test: (spec: CommandSpec) => boolean) => ALL_COMMANDS.filter((command) => test(COMMANDS[command]));

export const PAGE_COMMANDS = commandsWhere((c) => c.scope === "page");
export const PAGE_COMMANDS_OFF_INTERNAL_PAGES = commandsWhere((c) => c.scope === "page" && !c.onInternalPages);
export const WINDOW_COMMANDS = commandsWhere((c) => c.scope !== undefined);
export const LITTLE_ARDIA_DISABLED_COMMANDS = commandsWhere((c) => c.littleArdia === "off");
export const LITTLE_ARDIA_PAGE_COMMANDS: ReadonlySet<string> = new Set(commandsWhere((c) => c.littleArdia === "page"));

const variantOf = (command: BrowserCommand, arg: string | undefined): Variant => {
  const spec = COMMANDS[command];
  return (arg && spec.variants?.[arg]) || spec;
};

export function commandBarTitle(command: BrowserCommand, arg?: string): string {
  const { barTitle, title = "" } = variantOf(command, arg);
  return barTitle ?? title.replace(/…$/, "");
}

export const commandSymbol = (command: BrowserCommand, arg?: string): string | undefined => variantOf(command, arg).symbol ?? COMMANDS[command].symbol;

const PROFILE_SHORTCUT_COUNT = 9;
const OVERRIDABLE_PER_ITEM_COMMANDS: readonly BrowserCommand[] = ["openExtension"];

const source = (id: string, keys: Keys = []): ShortcutSource => ({ id, keys: keys.map(parseShortcut) });

export function staticShortcutSources(): ShortcutSource[] {
  const sources: ShortcutSource[] = [];
  for (const command of ALL_COMMANDS) {
    const spec = COMMANDS[command];
    sources.push(source(command, spec.keys));
    for (const [arg, variant] of Object.entries(spec.variants ?? {})) sources.push(source(`${command}:${arg}`, variant.keys));
  }
  for (const [id, item] of Object.entries(STANDARD_ITEMS)) sources.push(source(id, item.keys));
  return sources;
}

const STATIC_SOURCES = staticShortcutSources();

export function shortcutSources(profileIds: readonly string[], overriddenIds: readonly string[]): ShortcutSource[] {
  const perItem = overriddenIds.filter((id) => OVERRIDABLE_PER_ITEM_COMMANDS.some((command) => id.startsWith(`${command}:`)));
  return [
    ...STATIC_SOURCES,
    ...profileIds.flatMap((id, i) => [
      source(`switchProfile:${id}`, i < PROFILE_SHORTCUT_COUNT ? [`⌃${i + 1}`] : []),
      source(`newLittleArdia:${id}`),
    ]),
    ...perItem.map((id) => source(id)),
  ];
}
