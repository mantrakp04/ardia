export {
  setThinScrollBars,
  isLiquidGlass,
  backgroundInstance,
  isDefaultBrowser,
  setAsDefaultBrowser,
  launchAtLoginStatus,
  setLaunchAtLogin,
  type SystemInfo,
  type UpdaterState,
  type UpdateChannel,
  type AppIcon,
} from "@ardia/shell";
import { call } from "@ardia/ardiacore";
import { nativeModule, type AppEvent, type AppearanceMode, type UpdateChannel } from "@ardia/shell";

export { replyToTerminate } from "./windows";

export { WIDEVINE_COMPONENT_ID } from "@ardia/ardiacore";

export const engineInfo = () => call("engine.info");
export const listComponents = () => call("engine.components");

const Shell = nativeModule("ArdiaShell");
const App = nativeModule("ArdiaApp");
const Updater = nativeModule("ArdiaUpdater");

export const setAppearance = (mode: AppearanceMode) => Shell.setAppearance(mode);
export const isDarkAppearance = () => Shell.isDarkAppearance();
export const onAppEvent = (listener: (e: AppEvent) => void) => Shell.addListener("onAppEvent", listener);
export const onOpenURLs = (listener: (urls: string[], pointer?: [number, number]) => void) =>
  Shell.addListener("onOpenURLs", ({ urls, pointer }) => listener(urls, pointer));

export const systemInfo = () => App.systemInfo();
export const crashReports = (since: number) => App.crashReports(since);
export const openExternalURL = (url: string) => App.openExternalURL(url);
export const appIcons = (size = 64) => App.appIcons(size);
export const currentAppIcon = () => App.appIcon();
export const setAppIcon = (id: string) => App.setAppIcon(id);
export const isInDock = () => App.isInDock();
export const addToDock = () => App.addToDock();

export const updaterState = () => Updater.updaterState();
export const checkForUpdates = () => Updater.checkForUpdates();
export const setAutomaticUpdateChecks = (on: boolean) => Updater.setAutomaticUpdateChecks(on);
export const setAutomaticUpdateDownloads = (on: boolean) => Updater.setAutomaticUpdateDownloads(on);
export const setUpdateChannel = (channel: UpdateChannel) => Updater.setUpdateChannel(channel);
