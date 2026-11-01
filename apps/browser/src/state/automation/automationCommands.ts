import type { BrowserCommand } from "../../platform/commands";
import { COMMANDS, commandBarTitle } from "../commands/commandCatalog";
import { isConfigSettingKey } from "../settings/configAllowlist";

export type AutomationDecision = "run" | "endsApp" | "changesEngine" | "leftOutSetting" | "control" | "needsArgument";

export const AUTOMATION: Readonly<Record<BrowserCommand, AutomationDecision>> = {
  newTab: "run",
  newWindow: "run",
  newIncognitoWindow: "run",
  newLittleArdia: "run",
  toggleOpenLinksInLittleArdia: "run",
  reopenClosedTab: "run",
  reopenClosedWindow: "run",
  restoreClosed: "needsArgument",
  focusCommandBar: "run",
  closeTab: "run",
  closeAllTabs: "run",
  print: "run",
  copyUrl: "run",
  copyUrlAsMarkdown: "run",
  findInPage: "run",
  findNext: "run",
  findPrevious: "run",
  setAppearance: "run",
  reload: "run",
  forceReload: "run",
  toggleTabLayout: "run",
  toggleSidebar: "run",
  openSplitPane: "run",
  useSelectionForFind: "run",
  findAndReplace: "run",
  jumpToSelection: "run",
  focusNextPane: "run",
  focusPreviousPane: "run",
  toggleFullUrl: "run",
  toggleJavaScriptFromAppleEvents: "leftOutSetting",
  toggleAddressBar: "run",
  cast: "run",
  zoomReset: "run",
  zoomIn: "run",
  zoomOut: "run",
  devTools: "run",
  toggleDevTools: "run",
  javaScriptConsole: "run",
  inspectElements: "run",
  viewSource: "run",
  back: "run",
  forward: "run",
  nextTab: "run",
  previousTab: "run",
  selectTab: "run",
  selectLastTab: "run",
  togglePin: "run",
  togglePinnedRow: "run",
  duplicateTab: "run",
  moveTabToProfile: "needsArgument",
  moveTabToWindow: "needsArgument",
  bookmarkPage: "run",
  addBookmarkToFolder: "needsArgument",
  openBookmark: "needsArgument",
  addFolderToSidebar: "needsArgument",
  restoreArcFolders: "needsArgument",
  toggleMute: "run",
  togglePageEngine: "changesEngine",
  downloads: "run",
  mergeAllWindows: "run",
  switchProfile: "needsArgument",
  nextProfile: "run",
  previousProfile: "run",
  newProfile: "run",
  openSettings: "run",
  importBrowserData: "run",
  showHistory: "run",
  clearBrowsingData: "run",
  manageBookmarks: "run",
  exportBookmarks: "run",
  bookmarkAllTabs: "run",
  setBookmarksBar: "run",
  toggleBookmarksBar: "run",
  newTabInGroup: "run",
  newGroupWithTabs: "run",
  cleanUpTabs: "run",
  tidyPins: "run",
  searchTabs: "run",
  renameTab: "run",
  changeTabIcon: "run",
  returnToPinnedUrl: "run",
  tabSwitcher: "run",
  share: "run",
  sendFeedback: "run",
  keyboardShortcuts: "run",
  copyDiagnostics: "run",
  recordPerformanceIssue: "run",
  toolTour: "run",
  videoTour: "run",
  releaseNotes: "run",
  showOnboarding: "run",
  taskManager: "run",
  openExtension: "needsArgument",
  addExtension: "run",
  manageExtensions: "run",
  pinExtensions: "run",
  autofill: "run",
  openFile: "run",
  savePage: "run",
  emailPageLocation: "run",
  printWithSystemDialog: "run",
  stop: "run",
  caretBrowsing: "run",
  moveTabDown: "run",
  moveTabUp: "run",
  closeTabGroup: "run",
  openProfileMenu: "run",
};

type SpecView = { title?: string; scope?: string; variants?: Readonly<Record<string, unknown>>; toggles?: string; chooses?: string };
const SPECS = COMMANDS as Readonly<Record<BrowserCommand, SpecView>>;

export const isCatalogCommand = (id: unknown): id is BrowserCommand => typeof id === "string" && Object.hasOwn(SPECS, id);

export const settingOf = (command: BrowserCommand): string | undefined => SPECS[command].toggles ?? SPECS[command].chooses;

export function automationDecision(command: BrowserCommand): AutomationDecision {
  const setting = settingOf(command);
  if (setting && !isConfigSettingKey(setting)) return AUTOMATION[command] === "run" ? "leftOutSetting" : AUTOMATION[command];
  return AUTOMATION[command] ?? "control";
}

export const isAutomatable = (command: BrowserCommand) => automationDecision(command) === "run";

export const variantsOf = (command: BrowserCommand): string[] | null => {
  const variants = SPECS[command].variants;
  return variants ? Object.keys(variants) : null;
};

export type AutomationCommand = { id: BrowserCommand; title: string; scope: string | null; variants: string[] | null };

export function automationCommands(): AutomationCommand[] {
  return (Object.keys(SPECS) as BrowserCommand[])
    .filter(isAutomatable)
    .map((id) => ({ id, title: SPECS[id].title ?? (commandBarTitle(id) || id), scope: SPECS[id].scope ?? null, variants: variantsOf(id) }));
}
