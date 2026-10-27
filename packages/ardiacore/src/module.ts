import { call, on } from "./engine/call";
import { nativeModule } from "./nativeModules";

export type DownloadState = "downloading" | "finished" | "failed" | "cancelled";

export type Download = {
  id: string;
  url: string;
  filename: string;
  path: string;
  state: DownloadState;
  paused: boolean;
  dangerous?: boolean;
  received: number;
  total: number;
  speed: number;
  mimeType: string;
  profile?: string;
  offTheRecord?: boolean;
  staging?: string | null;
  stagingId?: string;
  destination?: string | null;
};

export type PermissionKind =
  | "camera" | "microphone" | "screen" | "location" | "notifications" | "clipboard" | "midi"
  | "multipleDownloads" | "localFonts" | "idleDetection" | "storageAccess" | "windowManagement" | "fileSystem"
  | "keyboardLock" | "pointerLock" | "protectedMedia" | "protocolHandler" | "sensors" | "localNetwork"
  | "vr" | "ar" | "handTracking" | "identityProvider" | "webAppInstallation" | "capturedSurfaceControl"
  | "diskQuota" | "cameraPanTiltZoom";

export type PermissionRequest = { id: string; tabId: string | null; origin: string; permissions: PermissionKind[] };
export type PermissionResult = "accept" | "deny" | "dismiss";

export type EngineInfo = {
  pid: number;
  dataDirectory: string;
  engine: string;
  chromiumVersion: string;
  liveBrowsers: number;
  popupWindows: number;
  chromeWindows: number;
};

export type EngineComponent = {
  id: string;
  name: string;
  version: string;
  state:
    | "new" | "checking" | "canUpdate" | "downloading" | "decompressing" | "patching" | "updating" | "updated"
    | "upToDate" | "updateError" | "run" | "unknown";
};

export type EngineTask = {
  id: number;
  type:
    | "browser" | "gpu" | "zygote" | "utility" | "renderer" | "extension" | "guest" | "plugin" | "sandboxHelper"
    | "dedicatedWorker" | "sharedWorker" | "serviceWorker" | "unknown";
  title: string;
  killable: boolean;
  cpu: number;
  processors: number;
  memory: number;
  gpuMemory: number;
  tabIds: (string | null)[];
};

export const WIDEVINE_COMPONENT_ID = "oimompecagnajdejgnnjijobebaeigek";

const Tabs = nativeModule("ArdiaTabs");

export const engineInfo = () => call("engine.info");

export type ChromeWindowState = {
  profile: string;
  window: number;
  frame: string;
  alpha: number;
  key: boolean;
  canBecomeKey: boolean;
  visible: boolean;
  parentWindow: number;
  chromeWindows: number;
  anchorBrowserId: number;
  anyTabBrowserId: number;
  ready: boolean;
  active: boolean;
  pageInsets: [number, number, number, number];
  hosting: boolean;
  group: string;
  hasRoot: boolean;
  translucent: boolean;
};
export const chromeWindows = () => call("windows.list");
export const devWindowAction = (windowNumber: number, action: string) => call("windows.dev", { window: windowNumber, action });
export const prepareTabTransfer = (tabId: string) => Tabs.prepareTransfer(tabId);
export const releaseTabTransfer = (tabId: string) => Tabs.releaseTransfer(tabId);
export const claimLaunchTab = (tabId: string, url: string, profile: string) => Tabs.claimLaunchTab(tabId, url, profile);
export const revealTab = (tabId: string) => Tabs.revealTab(tabId);
export const dropTabReveals = (tabId: string) => Tabs.dropTabReveals(tabId);
export const revealOffered = (adoptId: string, overTabId: string) => Tabs.revealOffered(adoptId, overTabId);
export type LinkRoute = { profile?: string; adoptIds?: (string | null)[]; dismissed?: number[] };
export const routeLinkTabs = (urls: string[]): Promise<LinkRoute> => call("tabs.routeLinkTabs", { urls });
export const listComponents = () => call("engine.components");

export const beginTracing = () => call("engine.beginTracing");
export const endTracing = (keep: boolean) => call("engine.endTracing", { keep });
export const isTracing = () => call("engine.isTracing");
export const listTasks = () => call("engine.tasks");

export type SystemState = {
  onBattery: boolean;
  batteryLevel: number | null;
  lowPowerMode: boolean;
  memoryPressure: "normal" | "warning" | "critical";
  physicalMemory: number;
};
export const systemState = () => call("engine.systemState");
export const onSystemState = (listener: (state: SystemState) => void) => on("engine.systemState", listener);

export const setDisplayMediaPicker = (enabled: boolean) => call("webView.setDisplayMediaPicker", { enabled });
export const setAutoPictureInPicture = (enabled: boolean) => call("webView.setAutoPictureInPicture", { enabled });
export const setVideoUpscaling = (enabled: boolean) => call("webView.setVideoUpscaling", { enabled });
export const setPeekModifier = (modifier: "alt" | "shift" | "off") => call("webView.setPeekModifier", { modifier });
export const setSplitLinkModifier = (modifier: "alt" | "altShift") => call("webView.setSplitLinkModifier", { modifier });
export const setSelectionPopover = (enabled: boolean) => call("webView.setSelectionPopover", { enabled });
export const setSearchEngineName = (name: string) => call("search.setEngineName", { name });
export const getDisplayMediaSources = () => call("media.displayMediaSources");

export const onDownload = (listener: (d: Download) => void) => on("downloads.changed", listener);
export const cancelDownload = (id: string) => call("downloads.cancel", { id });
export const pauseDownload = (id: string) => call("downloads.pause", { id });
export const resumeDownload = (id: string) => call("downloads.resume", { id });
export const keepDownload = (id: string) => call("downloads.keep", { id });

export type DownloadSettings = { folder: string; askWhereToSave: boolean; managed: boolean };
export const getDownloadSettings = (profile = "") => call("downloads.settings", { profile });
export const setDownloadSettings = (patch: Partial<Pick<DownloadSettings, "folder" | "askWhereToSave">>, profile = "") =>
  call("downloads.setSettings", { ...patch, profile });

export const onPermission = (listener: (p: PermissionRequest) => void) => on("permissions.requested", listener);
export const onPermissionDismissed = (listener: (p: { id: string }) => void) => on("permissions.dismissed", listener);
export const resolvePermission = (id: string, result: PermissionResult, remember = false) => call("permissions.resolve", { id, result, remember });

export type BrowsingDataType = "history" | "siteData" | "cache" | "downloads";
export const clearBrowsingData = (profile: string, types: BrowsingDataType[], since?: number) =>
  call("profiles.clearBrowsingData", { profile, types, since: since ?? null }).then(() => {});
export const releaseProfile = (profile: string) => call("profiles.release", { profile });
export const deleteProfileData = async (profile: string): Promise<string[]> => (await call("profiles.deleteData", { profile })).remaining;
