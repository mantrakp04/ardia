import type {
  AppEvent,
  BangListReply,
  CommandEvent,
  LaunchConfig,
  OpenWindowOptions,
  ShellNativeModules,
  ShellOptionalNativeModules,
  SystemInfo,
  UserScriptsFolder,
  WindowEvent,
} from "@ardia/shell";
import { nativeEvents, unfaked } from "./events";

type Modules = ShellNativeModules;
type OptionalModules = { [Name in keyof ShellOptionalNativeModules]: () => ShellOptionalNativeModules[Name] | null };

type UserScriptsHost = {
  watching: boolean[];
  writes: unknown[];
  status: string | null;
  change: (() => void) | null;
  read(): Promise<UserScriptsFolder>;
};

const testGlobals = globalThis as { acTestUserScripts?: UserScriptsHost };

export const docs = new Map<string, string>();
export const heldSaves = { on: false, queue: [] as (() => void)[] };
export const bangListServer: { reply: ((etag: string | null) => Promise<BangListReply>) | null } = { reply: null };
export const appInfo: Partial<SystemInfo> = { appVersion: "1.0" };
export const launch: LaunchConfig = {
  dataDirectory: null,
  background: false,
  isolated: false,
  testInstance: false,
  instance: {},
  switches: {},
  trace: [],
  test: {},
};

export type FakeWindow = OpenWindowOptions & { title?: string; trafficLightsCenter?: [number, number] | null };
const shellEvents = nativeEvents();
export const windows = {
  open: new Map<string, FakeWindow>(),
  closed: [] as string[],
  focused: null as string | null,
  emit: (event: WindowEvent) => shellEvents.emit("onWindowEvent", event),
};
export const emitAppEvent = (event: AppEvent) => shellEvents.emit("onAppEvent", event);
export const emitCommand = (event: CommandEvent) => shellEvents.emit("onCommand", event);
export const emitOpenURLs = (urls: string[], pointer?: [number, number]) => shellEvents.emit("onOpenURLs", { urls, pointer });

const shell: Modules["ArdiaShell"] = {
  addListener: shellEvents.addListener,
  showMenu: () => Promise.resolve(null),
  copyText: () => {},
  setSwitcherCapture: () => Promise.resolve(),
  setDragEscapeCapture: () => Promise.resolve(),
  saveKeyResponder: () => Promise.resolve(0),
  restoreKeyResponder: () => Promise.resolve(false),
  discardKeyResponder: () => Promise.resolve(),
  switcherPointerMoved: () => true,
  pickFolder: () => Promise.resolve(null),
  animateWindowClose: () => Promise.resolve(),
  restoreFullScreen: () => Promise.resolve(),
  watchLeftEdge: () => Promise.resolve(),
  dragPreviewBegin: () => Promise.resolve(),
  dragPreviewPage: () => Promise.resolve(),
  dragPreviewUpdate: () => Promise.resolve(),
  dragPreviewCancel: () => Promise.resolve(),
  dragPreviewPlaceholder: () => Promise.resolve(),
  dragPreviewEnd: () => Promise.resolve(),
  raiseView: () => Promise.resolve(),
  windowFrame: () => Promise.resolve(null),
  cancelFocusMove: () => Promise.resolve(),
  claimFocus: () => Promise.resolve(),
  startDictation: () => {},
  pickFiles: () => Promise.resolve([]),
  readDocument: (name) => docs.get(name) ?? null,
  writeDocument: (name, contents) => void docs.set(name, contents),
  saveDocument: (name, contents) =>
    new Promise((resolve) => {
      const land = () => (docs.set(name, contents), resolve());
      if (heldSaves.on) heldSaves.queue.push(land);
      else land();
    }),
  removeDocument: (name) => void docs.delete(name),
  fetchBangList: (etag) => (bangListServer.reply ? bangListServer.reply(etag) : unfaked("ArdiaShell", "fetchBangList")),
  openWindow: (id, options) => {
    windows.open.set(id, { ...options });
    if (options.focus !== false) windows.focused = id;
    return Promise.resolve();
  },
  closeWindow: (id) => {
    windows.open.delete(id);
    windows.closed.push(id);
    if (windows.focused === id) windows.focused = null;
    return Promise.resolve();
  },
  focusWindow: (id) => {
    windows.focused = id;
    return Promise.resolve();
  },
  setTrafficLightsCenter: (id, center) => {
    const window = windows.open.get(id);
    if (window) window.trafficLightsCenter = center;
    return Promise.resolve();
  },
  setWindowTitle: (id, title) => {
    const window = windows.open.get(id);
    if (window) window.title = title;
    return Promise.resolve();
  },
  windowIds: () => Promise.resolve([...windows.open.keys()]),
  setAppearance: () => Promise.resolve(),
  isDarkAppearance: () => Promise.resolve(false),
  setMenuState: () => Promise.resolve(),
  setMenuBookmarks: () => Promise.resolve(),
  replyToTerminate: () => Promise.resolve(),
  confirm: () => Promise.resolve({ confirmed: false, suppressed: false }),
  prompt: () => Promise.resolve(null),
};

const appEvents = nativeEvents();
const app: Modules["ArdiaApp"] = {
  addListener: appEvents.addListener,
  updaterState: () => Promise.resolve({ available: false }),
  checkForUpdates: () => Promise.resolve(),
  setAutomaticUpdateChecks: () => Promise.resolve(),
  setAutomaticUpdateDownloads: () => Promise.resolve(),
  setUpdateChannel: () => Promise.resolve(),
  setWindowActivity: () => Promise.resolve(),
  share: () => Promise.resolve(),
  shareVia: () => Promise.resolve(),
  isInDock: () => Promise.resolve(false),
  addToDock: () => Promise.resolve(false),
  appIcons: () => Promise.resolve([]),
  appIcon: () => Promise.resolve("default"),
  setAppIcon: () => Promise.resolve(),
  notificationPermission: () => Promise.resolve("notDetermined"),
  requestNotificationPermission: () => Promise.resolve(false),
  postNotification: () => Promise.resolve(null),
  removeNotifications: () => Promise.resolve(),
  openNotificationSettings: () => Promise.resolve(),
  setScriptState: () => Promise.resolve(),
  replyToScript: () => Promise.resolve(),
  systemInfo: () => ({ ...appInfo }) as SystemInfo,
  openExternalURL: () => Promise.resolve(false),
  launchConfig: () => structuredClone(launch),
  playIntroMusic: () => Promise.resolve(),
  setIntroMusicMuted: () => Promise.resolve(),
  stopIntroMusic: () => Promise.resolve(),
  devRenderIntroMusic: () => Promise.resolve(null),
  devRunAppleScript: () => Promise.resolve({ ok: false, error: "no AppleScript in tests" }),
  devSnapshotWindow: () => Promise.resolve(false),
  devSetPointer: () => Promise.resolve(false),
  devSetMouseButtons: () => Promise.resolve(false),
  devHoverStats: () => Promise.resolve({}),
  devMenuCommand: () => Promise.resolve(),
  devTypeKeys: () => Promise.resolve([]),
  devKeyEquivalent: () => Promise.resolve({ handledBy: "none" }),
  devClick: () => Promise.resolve({}),
  crashReports: () => Promise.resolve([]),
  devCrash: () => Promise.resolve(),
  devLeftEdgePointer: () => Promise.resolve(false),
  devLeftEdgeStats: () => Promise.resolve({}),
};

const system: Modules["ArdiaSystem"] = {
  isDefaultBrowser: () => Promise.resolve(false),
  setAsDefaultBrowser: () => Promise.resolve(false),
  launchAtLoginStatus: () => Promise.resolve("notRegistered"),
  setLaunchAtLogin: () => Promise.resolve(),
  fileExists: () => false,
  openFile: () => Promise.resolve(false),
  revealFile: () => Promise.resolve(false),
  moveToTrash: () => Promise.resolve(false),
  fileIcon: () => Promise.resolve(null),
  appIcon: () => Promise.resolve(null),
  hapticTick: () => {},
  menuShortcuts: () => Promise.resolve([]),
  recordShortcut: () => Promise.resolve(null),
  cancelRecording: () => Promise.resolve(),
  setThinScrollBars: () => Promise.resolve(),
};

const calendarEvents = nativeEvents();
const calendar: Modules["ArdiaCalendar"] = {
  addListener: calendarEvents.addListener,
  authorizationStatus: () => "notDetermined",
  requestAccess: () => Promise.resolve(false),
  calendars: () => Promise.resolve([]),
  events: () => Promise.resolve([]),
};

const keychain: Modules["ArdiaKeychain"] = {
  get: () => Promise.resolve(null),
  set: () => Promise.resolve(true),
  delete: () => Promise.resolve(true),
};

const translate: Modules["ArdiaTranslate"] = {
  available: false,
  userLanguages: () => ["en"],
  languageName: (identifier) => identifier,
  detect: () => Promise.resolve(null),
  status: () => Promise.resolve("unsupported"),
  supportedLanguages: () => Promise.resolve([]),
  prepare: () => Promise.resolve(),
  translate: (_source, _target, texts) => Promise.resolve(texts),
  translateBlocks: (_source, _target, blocks) => Promise.resolve(blocks),
};

const magnifyArea: Modules["ArdiaMagnifyArea"] = { devMagnify: () => unfaked("ArdiaMagnifyArea", "devMagnify") };
const fileDrop: Modules["ArdiaFileDrop"] = {
  devDrag: () => unfaked("ArdiaFileDrop", "devDrag"),
  devLastFileDrag: () => Promise.resolve([]),
};

export const shellNativeModules: Modules = {
  ArdiaShell: shell,
  ArdiaApp: app,
  ArdiaSystem: system,
  ArdiaCalendar: calendar,
  ArdiaKeychain: keychain,
  ArdiaGlassEffect: { isLiquidGlass: () => false },
  ArdiaDockSelection: { iconTheme: () => Promise.resolve(null) },
  ArdiaInlineCompletion: { complete: () => Promise.resolve(0) },
  ArdiaTranslate: translate,
  ArdiaMagnifyArea: magnifyArea,
  ArdiaFileDrop: fileDrop,
};

const cliEvents = nativeEvents();
const cli: ShellOptionalNativeModules["ArdiaCli"] = {
  installedVersion: () => null,
  install: () => Promise.resolve({ ok: false, appVersion: appInfo.appVersion ?? "", error: "no installs in tests", lines: [] }),
  addListener: cliEvents.addListener,
};

const userScriptsHost = () => testGlobals.acTestUserScripts!;
const userScripts: ShellOptionalNativeModules["ArdiaUserScripts"] = {
  watch: (on) => void userScriptsHost().watching.push(on),
  read: () => userScriptsHost().read(),
  readStatus: async () => userScriptsHost().status,
  writeStatus: async (json) => {
    userScriptsHost().status = json;
    userScriptsHost().writes.push(JSON.parse(json));
  },
  addListener: (_name, listener) => {
    userScriptsHost().change = listener;
    return { remove() {} };
  },
};

export const shellOptionalNativeModules: OptionalModules = {
  ArdiaCli: () => cli,
  ArdiaUserScripts: () => (testGlobals.acTestUserScripts ? userScripts : null),
};
