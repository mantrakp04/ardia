import { hostSupports, type ArdiaHost } from "./host.ts";
import { unavailableError } from "./hostCapabilities.ts";

type Fallback = (...args: unknown[]) => unknown;

const answer = (value: unknown): Fallback => () => Promise.resolve(value);
const refuse = (feature: string): Fallback => () => Promise.reject(unavailableError(feature));

const APP_FALLBACKS: Record<string, Fallback> = {
  updaterState: answer({ available: false }),
  checkForUpdates: refuse("Checking for updates"),
  setAutomaticUpdateChecks: refuse("Automatic update checks"),
  setAutomaticUpdateDownloads: refuse("Automatic update downloads"),
  setUpdateChannel: refuse("The update channel"),
  setWindowActivity: refuse("Handoff"),
  share: refuse("The share sheet"),
  shareVia: refuse("The share sheet"),
  shareText: refuse("The share sheet"),
  isInDock: refuse("The Dock"),
  addToDock: refuse("The Dock"),
  appIcons: answer([]),
  appIcon: refuse("Alternate app icons"),
  setAppIcon: refuse("Alternate app icons"),
  notificationPermission: refuse("Desktop notifications"),
  requestNotificationPermission: refuse("Desktop notifications"),
  openNotificationSettings: refuse("Desktop notifications"),
  postNotification: answer(null),
  removeNotifications: answer(undefined),
  setScriptState: refuse("AppleScript"),
  replyToScript: refuse("AppleScript"),
  crashReports: answer([]),
};

const MODULE_FALLBACKS: Record<string, Record<string, Fallback>> = {
  ArdiaApp: APP_FALLBACKS,
  ArdiaKeychain: { get: refuse("The keychain"), set: refuse("The keychain"), delete: refuse("The keychain") },
  ArdiaTranslate: {
    userLanguages: () => [],
    languageName: (identifier) => identifier,
    ...Object.fromEntries(["detect", "status", "supportedLanguages", "prepare", "translate", "translateBlocks"].map((method) => [method, refuse("Translation")])),
  },
  ArdiaInlineCompletion: { complete: refuse("Inline completion") },
  ArdiaDockSelection: { iconTheme: refuse("Icon themes") },
  ArdiaSystem: { runningAppIcon: answer(null) },
  ArdiaCli: { install: refuse("The ardia command") },
  ArdiaConfig: { watch: answer(undefined), writeSchemas: answer([]) },
  ArdiaAutomation: { start: answer({ state: "off", generation: 0, path: "", reason: "the control socket is unavailable on Linux" }), stop: answer(undefined) },
  ArdiaSystemSignals: {
    watchIdle: () => undefined,
    holdsIncomingLinks: () => false,
    setHoldIncomingLinks: () => undefined,
    setApprovedDownloadFolders: () => undefined,
    moveCompletedDownload: refuse("Moving a finished download"),
    devPost: refuse("The developer hook ArdiaSystemSignals.devPost"),
  },
};

const DEVELOPER_MODULES = new Set(["ArdiaApp", "ArdiaMagnifyArea", "ArdiaFileDrop"]);

export function appModuleFallback(host: ArdiaHost, name: string, method: string): Fallback | undefined {
  if (hostSupports(`${name}.${method}`, host)) return undefined;
  const fallback = MODULE_FALLBACKS[name]?.[method];
  if (fallback && Object.hasOwn(MODULE_FALLBACKS[name]!, method)) return fallback;
  if (DEVELOPER_MODULES.has(name) && /^dev[A-Z]/.test(method)) return refuse(`The developer hook ${name}.${method}`);
  return undefined;
}
