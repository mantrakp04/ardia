import { engineCall } from "./engine";
import { Cef } from "./native";

export type DownloadState = "downloading" | "finished" | "failed" | "cancelled";

export type Download = {
  id: string;
  url: string;
  filename: string;
  path: string;
  state: DownloadState;
  paused: boolean;
  received: number;
  total: number;
  speed: number;
  mimeType: string;
  profile?: string;
  offTheRecord?: boolean;
};

export type PermissionKind =
  | "camera" | "microphone" | "screen" | "location" | "notifications" | "clipboard" | "midi"
  | "multipleDownloads" | "localFonts" | "idleDetection" | "storageAccess" | "windowManagement" | "fileSystem"
  | "keyboardLock" | "pointerLock" | "protectedMedia" | "protocolHandler" | "sensors" | "localNetwork"
  | "vr" | "ar" | "handTracking" | "identityProvider" | "webAppInstallation" | "capturedSurfaceControl"
  | "diskQuota" | "cameraPanTiltZoom";

export type PermissionRequest = { id: string; browserId: number; origin: string; permissions: PermissionKind[] };
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
  browserIds: number[];
};

export const WIDEVINE_COMPONENT_ID = "oimompecagnajdejgnnjijobebaeigek";

export const engineInfo = () => Cef.engineInfo();

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
export const chromeWindows = () => Cef.chromeWindows();
export const devWindowAction = (windowNumber: number, action: string) => Cef.devWindow(windowNumber, action);
export const prepareTabTransfer = (transferKey: string) => Cef.prepareTransfer(transferKey);
export const releaseTabTransfer = (transferKey: string) => Cef.releaseTransfer(transferKey);
export const claimLaunchTab = (transferKey: string, url: string, profile: string) => Cef.claimLaunchTab?.(transferKey, url, profile);
export const revealTab = (transferKey: string) => Cef.revealTab?.(transferKey);
export const dropTabReveals = (transferKey: string) => Cef.dropTabReveals?.(transferKey);
export const revealOffered = (adoptId: string, overTransferKey: string) => Cef.revealOffered?.(adoptId, overTransferKey);
export type LinkRoute = { profile?: string; adoptIds?: (string | null)[]; dismissed?: number[] };
export const routeLinkTabs = (urls: string[]): Promise<LinkRoute> => Cef.routeLinkTabs?.(urls) ?? Promise.resolve({});
export const listComponents = () => Cef.components();

export const beginTracing = () => Cef.beginTracing();
export const endTracing = (keep: boolean) => Cef.endTracing(keep);
export const isTracing = () => Cef.isTracing();
export const listTasks = () => Cef.listTasks();

export type SystemState = {
  onBattery: boolean;
  batteryLevel: number | null;
  lowPowerMode: boolean;
  memoryPressure: "normal" | "warning" | "critical";
  physicalMemory: number;
};
export const systemState = () => Cef.systemState();
export const onSystemState = (listener: (state: SystemState) => void) => Cef.addListener("onSystemState", listener);

export const setDisplayMediaPicker = (enabled: boolean) => Cef.setDisplayMediaPicker(enabled);
export const setAutoPictureInPicture = (enabled: boolean) => Cef.setAutoPictureInPicture?.(enabled) ?? Promise.resolve();
export const setVideoUpscaling = (enabled: boolean) => Cef.setVideoUpscaling?.(enabled) ?? Promise.resolve();
export const setPeekModifier = (modifier: "alt" | "shift" | "off") => Cef.setPeekModifier?.(modifier) ?? Promise.resolve();
export const setSearchEngineName = (name: string) => Cef.setSearchEngineName(name);
export const getDisplayMediaSources = () => Cef.displayMediaSources();

export const onDownload = (listener: (d: Download) => void) => Cef.addListener("onDownload", listener);
export const cancelDownload = (id: string) => Cef.cancelDownload(id);
export const pauseDownload = (id: string) => Cef.pauseDownload(id);
export const resumeDownload = (id: string) => Cef.resumeDownload(id);

export type DownloadSettings = { folder: string; askWhereToSave: boolean; managed: boolean };
export const getDownloadSettings = (profile = "") => engineCall<DownloadSettings>("ac_downloads_settings", profile);
export const setDownloadSettings = (patch: Partial<Pick<DownloadSettings, "folder" | "askWhereToSave">>, profile = "") =>
  engineCall<DownloadSettings>("ac_downloads_set_settings", profile, patch);

export const onPermission = (listener: (p: PermissionRequest) => void) => Cef.addListener("onPermission", listener);
export const onPermissionDismissed = (listener: (p: { id: string }) => void) =>
  Cef.addListener("onPermissionDismissed", listener);
export const resolvePermission = (id: string, result: PermissionResult, remember = false) =>
  Cef.resolvePermission(id, result, remember);

export type BrowsingDataType = "history" | "siteData" | "cache" | "downloads";
export const clearBrowsingData = (profile: string, types: BrowsingDataType[], since?: number) =>
  Cef.clearBrowsingData(profile, types, since ?? null);
export const releaseProfile = (profile: string) => Cef.releaseProfile(profile);
export const deleteProfileData = async (profile: string): Promise<string[]> => (await Cef.deleteProfileData(profile))?.remaining ?? ["data"];
