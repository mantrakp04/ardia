import { engineCall } from "./engine";
import { Cef } from "./native";
import { WebKit, isWebKitDownload, isWebKitPermission, webKitListener } from "./webkit";

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
export const prepareTabTransfer = (transferKey: string) => {
  Cef.prepareTransfer(transferKey);
  WebKit?.prepareTransfer(transferKey);
};
export const releaseTabTransfer = (transferKey: string) => {
  Cef.releaseTransfer(transferKey);
  WebKit?.releaseTransfer(transferKey);
};
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
export const setSplitLinkModifier = (modifier: "alt" | "altShift") => Cef.setSplitLinkModifier?.(modifier) ?? Promise.resolve();
export const setSelectionPopover = (enabled: boolean) => Cef.setSelectionPopover?.(enabled) ?? Promise.resolve();
export const setSearchEngineName = (name: string) => Cef.setSearchEngineName(name);
export const getDisplayMediaSources = () => Cef.displayMediaSources();

export const onDownload = (listener: (d: Download) => void) => {
  const chromium = Cef.addListener("onDownload", (event) => { if (!isWebKitDownload(event.id)) listener(event); });
  const webkit = webKitListener("onDownload", (event: Parameters<typeof listener>[0]) => { if (isWebKitDownload(event.id)) listener(event); });
  return { remove: () => (chromium.remove(), webkit.remove()) };
};
const downloadCommand = (action: "cancel" | "pause" | "resume", id: string) =>
  isWebKitDownload(id)
    ? (WebKit?.downloadCommand(action, id) ?? Promise.resolve())
    : action === "cancel"
      ? Cef.cancelDownload(id)
      : action === "pause"
        ? Cef.pauseDownload(id)
        : Cef.resumeDownload(id);
export const cancelDownload = (id: string) => downloadCommand("cancel", id);
export const pauseDownload = (id: string) => downloadCommand("pause", id);
export const resumeDownload = (id: string) => downloadCommand("resume", id);

export type DownloadSettings = { folder: string; askWhereToSave: boolean; managed: boolean };
export const getDownloadSettings = (profile = "") => engineCall<DownloadSettings>("ac_downloads_settings", profile);
export const setDownloadSettings = (patch: Partial<Pick<DownloadSettings, "folder" | "askWhereToSave">>, profile = "") =>
  engineCall<DownloadSettings>("ac_downloads_set_settings", profile, patch);

export const onPermission = (listener: (p: PermissionRequest) => void) => {
  const chromium = Cef.addListener("onPermission", (event) => { if (!isWebKitPermission(event.id)) listener(event); });
  const webkit = webKitListener("onPermission", (event: Parameters<typeof listener>[0]) => { if (isWebKitPermission(event.id)) listener(event); });
  return { remove: () => (chromium.remove(), webkit.remove()) };
};
export const onPermissionDismissed = (listener: (p: { id: string }) => void) => {
  const chromium = Cef.addListener("onPermissionDismissed", (event) => { if (!isWebKitPermission(event.id)) listener(event); });
  const webkit = webKitListener("onPermissionDismissed", (event: Parameters<typeof listener>[0]) => { if (isWebKitPermission(event.id)) listener(event); });
  return { remove: () => (chromium.remove(), webkit.remove()) };
};
export const resolvePermission = (id: string, result: PermissionResult, remember = false) =>
  isWebKitPermission(id) ? (WebKit?.resolvePermission(id, result, remember) ?? Promise.resolve()) : Cef.resolvePermission(id, result, remember);

export type BrowsingDataType = "history" | "siteData" | "cache" | "downloads";
export const clearBrowsingData = (profile: string, types: BrowsingDataType[], since?: number) =>
  Promise.all([Cef.clearBrowsingData(profile, types, since ?? null), WebKit?.clearBrowsingData(profile, types, since ?? null).catch(() => {})]).then(() => {});
export const releaseProfile = (profile: string) => Cef.releaseProfile(profile);
export const deleteProfileData = async (profile: string): Promise<string[]> => {
  const [chromium, webkit] = await Promise.all([Cef.deleteProfileData(profile), WebKit?.deleteProfileData(profile).catch(() => false) ?? true]);
  return [...(chromium?.remaining ?? ["data"]), ...(webkit ? [] : ["WebKit data"])];
};
