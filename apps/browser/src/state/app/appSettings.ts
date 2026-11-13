export {
  addToDock,
  appIcons,
  backgroundInstance,
  checkForUpdates,
  currentAppIcon,
  isDefaultBrowser,
  isInDock,
  launchAtLoginStatus,
  setAppIcon,
  setAutomaticUpdateChecks,
  setAutomaticUpdateDownloads,
  setLaunchAtLogin,
  setUpdateChannel,
  type AppIcon,
  type UpdateChannel,
  type UpdaterState,
} from "../../platform/app";
import { setAsDefaultBrowser as askToBeDefaultBrowser } from "../../platform/app";
import { noteDefaultBrowserPrompt } from "../telemetry/defaultBrowserCounts";

export function setAsDefaultBrowser() {
  noteDefaultBrowserPrompt();
  return askToBeDefaultBrowser();
}
