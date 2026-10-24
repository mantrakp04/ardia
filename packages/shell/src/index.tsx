import { requireNativeModule, requireNativeViewManager, type EventSubscription } from "expo-modules-core";
import type { ViewProps } from "react-native";

export * from "./system";
export * from "./app";
export * from "./live";
export * from "./cli";
export * from "./userScripts";

export type BrowserCommand =
  | "newTab"
  | "newWindow"
  | "newIncognitoWindow"
  | "newLittleArdia"
  | "toggleOpenLinksInLittleArdia"
  | "reopenClosedTab"
  | "reopenClosedWindow"
  | "restoreClosed"
  | "focusCommandBar"
  | "closeTab"
  | "closeAllTabs"
  | "print"
  | "copyUrl"
  | "copyUrlAsMarkdown"
  | "findInPage"
  | "findNext"
  | "findPrevious"
  | "setAppearance"
  | "reload"
  | "forceReload"
  | "toggleTabLayout"
  | "toggleSidebar"
  | "openSplitPane"
  | "useSelectionForFind"
  | "findAndReplace"
  | "jumpToSelection"
  | "focusNextPane"
  | "focusPreviousPane"
  | "toggleFullUrl"
  | "toggleJavaScriptFromAppleEvents"
  | "toggleAddressBar"
  | "cast"
  | "zoomReset"
  | "zoomIn"
  | "zoomOut"
  | "devTools"
  | "toggleDevTools"
  | "javaScriptConsole"
  | "inspectElements"
  | "viewSource"
  | "back"
  | "forward"
  | "nextTab"
  | "previousTab"
  | "selectTab"
  | "selectLastTab"
  | "togglePin"
  | "togglePinnedRow"
  | "duplicateTab"
  | "moveTabToProfile"
  | "moveTabToWindow"
  | "bookmarkPage"
  | "addBookmarkToFolder"
  | "openBookmark"
  | "addFolderToSidebar"
  | "restoreArcFolders"
  | "toggleMute"
  | "downloads"
  | "mergeAllWindows"
  | "switchProfile"
  | "nextProfile"
  | "previousProfile"
  | "newProfile"
  | "openSettings"
  | "importBrowserData"
  | "showHistory"
  | "clearBrowsingData"
  | "manageBookmarks"
  | "bookmarkAllTabs"
  | "setBookmarksBar"
  | "toggleBookmarksBar"
  | "newTabInGroup"
  | "newGroupWithTabs"
  | "cleanUpTabs"
  | "tidyPins"
  | "searchTabs"
  | "renameTab"
  | "changeTabIcon"
  | "returnToPinnedUrl"
  | "tabSwitcher"
  | "share"
  | "sendFeedback"
  | "keyboardShortcuts"
  | "copyDiagnostics"
  | "recordPerformanceIssue"
  | "toolTour"
  | "videoTour"
  | "releaseNotes"
  | "showOnboarding"
  | "taskManager"
  | "openExtension"
  | "addExtension"
  | "manageExtensions"
  | "pinExtensions"
  | "autofill"
  | "openFile"
  | "savePage"
  | "emailPageLocation"
  | "printWithSystemDialog"
  | "stop"
  | "caretBrowsing"
  | "moveTabDown"
  | "moveTabUp"
  | "closeTabGroup"
  | "openProfileMenu";

export type CommandEvent = {
  command: BrowserCommand;
  arg: string | null;
  windowId: string | null;
  focusGeneration?: number | null;
};

export type WindowEvent =
  | { type: "focus"; id: string }
  | { type: "close"; id: string }
  | { type: "frame"; id: string; frame: [number, number, number, number] }
  | { type: "leftEdge"; id: string; over: boolean; point: [number, number] }
  | { type: "closeRequest"; id: string };

export type AppEvent =
  | { type: "reopen" }
  | { type: "willQuit" }
  | { type: "quitCancelled" }
  | { type: "appearance"; dark: boolean }
  | { type: "quitWarningSuppressed" }
  | { type: "resignActive" }
  | { type: "screenLocked" }
  | { type: "switcherReleased" }
  | { type: "switcherKey"; key: "escape" | "next" | "previous" }
  | { type: "switcherMouseUp" }
  | { type: "dragEscape" };

type ShellEvents = {
  onCommand: (e: CommandEvent) => void;
  onOpenURLs: (e: { urls: string[]; pointer?: [number, number] }) => void;
  onWindowEvent: (e: WindowEvent) => void;
  onAppEvent: (e: AppEvent) => void;
};

export type MenuItem =
  | { separator: true }
  | {
      id: string;
      title: string;
      symbol?: string;
      swatch?: string;
      swatchDark?: string;
      key?: string;
      modifiers?: ("command" | "shift" | "option" | "control")[];
      enabled?: boolean;
      checked?: boolean;
      children?: MenuItem[];
      share?: boolean;
    };

export type OpenWindowOptions = {
  frame?: [number, number, number, number] | null;
  incognito?: boolean;
  title?: string;
  focus?: boolean;
  kind?: "browser" | "small" | "settings" | "import";
  profile?: string;
  size?: [number, number];
  behind?: string;
  chromeWindow?: string;
  pointer?: [number, number];
};

export type MenuEntry = { id: string; title: string; current?: boolean };
export type MenuBookmark = { id: string; title: string; url?: string; children?: MenuBookmark[] };

export type MenuState = {
  checked: string[];
  disabled: string[];
  titles: Record<string, string>;
  profiles: MenuEntry[];
  windows: MenuEntry[];
  bookmarkFolders: MenuEntry[];
  recentBookmarks: MenuBookmark[];
  bookmarksBar: MenuBookmark[];
  otherBookmarks: MenuBookmark[];
  recentlyClosed: MenuEntry[];
  recentlyClosedGroups?: MenuEntry[];
  warnBeforeQuitting: boolean;
  warnBeforeClosingWindow?: boolean;
  undoReopensClosedTab?: boolean;
  downloadsInProgress?: number;
  extensions?: { id: string; title: string; icon?: string | null; enabled: boolean }[];
  shortcuts?: Record<string, string[]>;
};

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmTitle?: string;
  cancelTitle?: string;
  destructive?: boolean;
  suppression?: string;
  windowId?: string;
};

export type PromptOptions = {
  title: string;
  message?: string;
  value?: string;
  placeholder?: string;
  confirmTitle?: string;
  windowId?: string;
};

const Shell = requireNativeModule<{
  addListener<K extends keyof ShellEvents>(name: K, listener: ShellEvents[K]): EventSubscription;
  showMenu(items: MenuItem[]): Promise<string | null>;
  copyText(text: string): void;
  setSwitcherCapture(active: boolean): Promise<void>;
  setDragEscapeCapture?(active: boolean): Promise<void>;
  cancelFocusMove(generation: number, restoringSource: boolean): Promise<void>;
  claimFocus(generation: number, tag: number): Promise<void>;
  switcherPointerMoved?(): boolean;
  startDictation(): void;
  pickFiles(): Promise<string[]>;
  pickFolder?(current: string | null, prompt: string | null): Promise<string | null>;
  readDocument(name: string): string | null;
  writeDocument(name: string, contents: string): void;
  saveDocument(name: string, contents: string): Promise<void>;
  removeDocument(name: string): void;
  fetchBangList?(etag: string | null): Promise<BangListReply>;
  openWindow(id: string, options: OpenWindowOptions): Promise<void>;
  closeWindow(id: string): Promise<void>;
  focusWindow(id: string): Promise<void>;
  setTrafficLightsCenter(id: string, center: [number, number] | null): Promise<void>;
  watchLeftEdge?(id: string, on: boolean, hold: number): Promise<void>;
  dragPreviewBegin?(windowId: string, chip: Rect4, grab: [number, number]): Promise<void>;
  dragPreviewPage?(base64: string, frame: Rect4): Promise<void>;
  dragPreviewUpdate?(shape: DragPreviewShape, point: [number, number]): Promise<void>;
  dragPreviewCancel?(): Promise<void>;
  raiseView?(tag: number, levels: number, raised: boolean): Promise<void>;
  dragPreviewPlaceholder?(title: string, favicon: string | null): Promise<void>;
  windowFrame?(id: string): Promise<Rect4 | null>;
  dragPreviewEnd?(windowId: string | null, frame: Rect4 | null): Promise<void>;
  setWindowTitle(id: string, title: string): Promise<void>;
  windowIds(): Promise<string[]>;
  setAppearance(mode: "auto" | "light" | "dark"): Promise<void>;
  isDarkAppearance(): Promise<boolean>;
  setMenuState(state: Omit<MenuState, MenuBookmarkKey>): Promise<void>;
  setMenuBookmarks(bookmarks: Pick<MenuState, MenuBookmarkKey>): Promise<void>;
  replyToTerminate(ok: boolean): Promise<void>;
  confirm(options: ConfirmOptions): Promise<{ confirmed: boolean; suppressed: boolean }>;
  prompt(options: PromptOptions): Promise<string | null>;
}>("ArdiaShell");

export const readDocument = (name: string) => Shell.readDocument(name);
export const writeDocument = (name: string, contents: string) => Shell.writeDocument(name, contents);
export const saveDocument = (name: string, contents: string) => Shell.saveDocument(name, contents);
export const removeDocument = (name: string) => Shell.removeDocument(name);

export type BangListReply = { status: number; etag: string | null; contentType: string | null; body: string | null; bytes: number };
export const fetchBangList = (etag: string | null): Promise<BangListReply> | null => Shell.fetchBangList?.(etag) ?? null;

export const startDictation = () => Shell.startDictation();
export const setSwitcherCapture = (active: boolean) => void Shell.setSwitcherCapture(active);
export const setDragEscapeCapture = (active: boolean) => void Shell.setDragEscapeCapture?.(active);
export const cancelFocusMove = (generation: number, restoringSource: boolean) =>
  void Shell.cancelFocusMove(generation, restoringSource);
export const claimFocus = (generation: number, tag: number) => void Shell.claimFocus(generation, tag);
export const restartSwitcherPointer = () => Shell.setSwitcherCapture(true);
export const switcherPointerMoved = () => Shell.switcherPointerMoved?.() ?? true;
export const pickFiles = () => Shell.pickFiles();
export const pickFolder = (current: string | null, prompt: string | null = null) => Shell.pickFolder?.(current, prompt) ?? Promise.resolve(null);

export function copyText(text: string) {
  Shell.copyText(text);
}

let menusShown = 0;
const menuWatchers = new Set<() => void>();
const menusChanged = (by: number) => {
  menusShown += by;
  for (const watcher of menuWatchers) watcher();
};
export const menuShown = () => menusShown > 0;
export function watchMenus(watcher: () => void): () => void {
  menuWatchers.add(watcher);
  return () => void menuWatchers.delete(watcher);
}

export function showMenu(items: MenuItem[]): Promise<string | null> {
  menusChanged(1);
  return Promise.resolve(Shell.showMenu(items)).finally(() => menusChanged(-1));
}

export const openWindow = (id: string, options: OpenWindowOptions = {}) => Shell.openWindow(id, options);

export type WindowProfileProps = ViewProps & {
  profile: string;
  selection?: string;
  neighbours: string[];
};
export const WindowProfile = requireNativeViewManager<WindowProfileProps>("ArdiaWindowProfile");

export const closeWindow = (id: string) => Shell.closeWindow(id);
export const focusWindow = (id: string) => Shell.focusWindow(id);
export const setWindowTitle = (id: string, title: string) => Shell.setWindowTitle(id, title);
export const setTrafficLightsCenter = (id: string, center: [number, number] | null) =>
  Shell.setTrafficLightsCenter(id, center);
export const watchLeftEdge = (id: string, on: boolean, hold = 0) => void Shell.watchLeftEdge?.(id, on, hold);
type Rect4 = [number, number, number, number];
export type DragPreviewShape = "hidden" | "pill" | "card";
export const dragPreview = {
  begin: (windowId: string, chip: Rect4, grab: [number, number]) => void Shell.dragPreviewBegin?.(windowId, chip, grab),
  page: (base64: string, frame: Rect4) => void Shell.dragPreviewPage?.(base64, frame),
  update: (shape: DragPreviewShape, point: [number, number]) => void Shell.dragPreviewUpdate?.(shape, point),
  end: (windowId: string | null = null, frame: Rect4 | null = null) => void Shell.dragPreviewEnd?.(windowId, frame),
  cancel: () => void Shell.dragPreviewCancel?.(),
  placeholder: (title: string, favicon: string | null) => void Shell.dragPreviewPlaceholder?.(title, favicon),
};
export const raiseView = (tag: number | null, levels: number, raised: boolean) => {
  if (tag != null) void Shell.raiseView?.(tag, levels, raised);
};
export const windowFrame = (id: string): Promise<Rect4 | null> => Shell.windowFrame?.(id) ?? Promise.resolve(null);
export const windowIds = () => Shell.windowIds();

export const setAppearance = (mode: "auto" | "light" | "dark") => Shell.setAppearance(mode);
export const isDarkAppearance = () => Shell.isDarkAppearance();

type MenuBookmarkKey = "bookmarkFolders" | "recentBookmarks" | "bookmarksBar" | "otherBookmarks";
export function setMenuStateParts(state: MenuState, bookmarksChanged: boolean) {
  const { bookmarkFolders, recentBookmarks, bookmarksBar, otherBookmarks, ...rest } = state;
  if (bookmarksChanged) void Shell.setMenuBookmarks({ bookmarkFolders, recentBookmarks, bookmarksBar, otherBookmarks });
  return Shell.setMenuState(rest);
}
export const replyToTerminate = (ok: boolean) => Shell.replyToTerminate(ok);

export const confirm = (options: ConfirmOptions) => Shell.confirm(options);
export const prompt = (options: PromptOptions) => Shell.prompt(options);

export const onCommand = (listener: (e: CommandEvent) => void) => Shell.addListener("onCommand", listener);
export const onWindowEvent = (listener: (e: WindowEvent) => void) => Shell.addListener("onWindowEvent", listener);
export const onAppEvent = (listener: (e: AppEvent) => void) => Shell.addListener("onAppEvent", listener);
export const onOpenURLs = (listener: (urls: string[], pointer?: [number, number]) => void) =>
  Shell.addListener("onOpenURLs", ({ urls, pointer }) => listener(urls, pointer));

export const WindowDragRegion = requireNativeViewManager<ViewProps & { titleBarDoubleClick?: boolean; onRegionDoubleClick?: () => void }>("ArdiaShell");

export const OutsidePressArea = requireNativeViewManager<ViewProps & { onOutsidePress?: (event: { nativeEvent: { timestamp?: number } }) => void }>("ArdiaOutsidePressArea");

export type SymbolProps = ViewProps & {
  name: string;
  size?: number;
  weight?: "light" | "regular" | "medium" | "semibold" | "bold";
  color?: string;
};

export const Symbol = requireNativeViewManager<SymbolProps>("ArdiaSymbol");

export type FadeLabelProps = ViewProps & {
  text: string;
  fontSize?: number;
  weight?: "light" | "regular" | "medium" | "semibold" | "bold";
  color?: string;
  fadeWidth?: number;
};

export const FadeLabel = requireNativeViewManager<FadeLabelProps>("ArdiaFadeLabel");

export const ActivitySpinner = requireNativeViewManager<ViewProps>("ArdiaActivitySpinner");

export type ContextMenuAreaProps = ViewProps & {
  onContextMenu?: () => void;
  captureDescendants?: boolean;
};

const NativeContextMenuArea = requireNativeViewManager<Omit<ContextMenuAreaProps, "onContextMenu"> & { onContextMenu?: () => void }>(
  "ArdiaContextMenuArea",
);

export function ContextMenuArea(props: ContextMenuAreaProps) {
  return <NativeContextMenuArea {...props} />;
}

export type SurfaceProps = ViewProps & {
  fill?: string;
  cornerRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  borderColors?: string[];
  shadowColor?: string;
  shadowOpacity?: number;
  shadowRadius?: number;
  shadowOffset?: [number, number];
};

type NativeSurfaceProps = Omit<SurfaceProps, "shadowColor" | "shadowOpacity" | "shadowRadius" | "shadowOffset"> & {
  surfaceShadowColor?: string;
  surfaceShadowOpacity?: number;
  surfaceShadowRadius?: number;
  surfaceShadowOffset?: [number, number];
};

const NativeSurface = requireNativeViewManager<NativeSurfaceProps>("ArdiaSurface");

export function Surface({ shadowColor, shadowOpacity, shadowRadius, shadowOffset, ...props }: SurfaceProps) {
  return (
    <NativeSurface
      {...props}
      surfaceShadowColor={shadowColor}
      surfaceShadowOpacity={shadowOpacity}
      surfaceShadowRadius={shadowRadius}
      surfaceShadowOffset={shadowOffset}
    />
  );
}

export type VisualEffectProps = ViewProps & {
  material?: string;
  blendingMode?: "withinWindow" | "behindWindow";
  cornerRadius?: number;
};

export const VisualEffect = requireNativeViewManager<VisualEffectProps>("ArdiaVisualEffect");

export type GlassEffectProps = ViewProps & {
  cornerRadius?: number;
  tint?: string;
  glassStyle?: "regular" | "clear";
  dark?: boolean;
};

const GlassEffectModule = requireNativeModule<{ isLiquidGlass(): boolean }>("ArdiaGlassEffect");

export const isLiquidGlass = (): boolean => GlassEffectModule.isLiquidGlass();

export const GlassEffect = requireNativeViewManager<GlassEffectProps>("ArdiaGlassEffect");

export type IconTheme = { kind: "blur" } | { kind: "template"; fill: string; stroke?: string };

const DockSelectionModule = requireNativeModule<{
  iconTheme(uri: string | null, emoji: string | null): Promise<IconTheme | null>;
}>("ArdiaDockSelection");

export const iconTheme = (source: { uri: string } | { emoji: string }): Promise<IconTheme | null> =>
  DockSelectionModule.iconTheme("uri" in source ? source.uri : null, "emoji" in source ? source.emoji : null);

export type DockSelectionProps = ViewProps & {
  image?: string;
  emoji?: string;
  theme?: IconTheme["kind"];
  fill?: string;
  stroke?: string;
  cornerRadius?: number;
  strokeWidth?: number;
  iconSize?: number;
  dark: boolean;
  glass?: boolean;
};

export const DockSelection = requireNativeViewManager<DockSelectionProps>("ArdiaDockSelection");

const InlineCompletionModule = requireNativeModule<{
  complete(tag: number, typed: string, completion: string): Promise<InlineWrite>;
}>("ArdiaInlineCompletion");

export type InlineWrite = 0 | 1 | 2;

export const completeInline = (tag: number, typed: string, completion: string) =>
  InlineCompletionModule.complete(tag, typed, completion);

type TranslationModule = {
  readonly available: boolean;
  userLanguages(): string[];
  languageName(identifier: string): string;
  detect(text: string): Promise<string | null>;
  status(source: string, target: string): Promise<"installed" | "supported" | "unsupported">;
  supportedLanguages(): Promise<string[]>;
  prepare(source: string, target: string): Promise<void>;
  translate(source: string, target: string, texts: string[]): Promise<string[]>;
  translateBlocks(source: string, target: string, blocks: string[][]): Promise<(string[] | null)[]>;
};
const TranslationNative = requireNativeModule<TranslationModule>("ArdiaTranslate");

export const translation: Omit<TranslationModule, "available"> | null = TranslationNative.available ? TranslationNative : null;
