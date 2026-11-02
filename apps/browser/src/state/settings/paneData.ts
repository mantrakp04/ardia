import { useBrowser } from "../browser/store";
import {
  engineInfo,
  listComponents,
  WIDEVINE_COMPONENT_ID,
  appIcons,
  currentAppIcon,
  isDefaultBrowser,
  launchAtLoginStatus,
  setAppIcon,
  setAsDefaultBrowser,
  setAutomaticUpdateChecks,
  setAutomaticUpdateDownloads,
  setUpdateChannel,
  updaterState,
  type UpdateChannel,
  type UpdaterState,
} from "../../platform/app";
import { getAutofillSettings, listAddresses, listCards, setAutofillSettings, type SavedAddress, type SavedCard } from "../../platform/autofill";
import { getContentBlocker } from "../../platform/contentBlocker";
import { getDownloadSettings, setDownloadSettings, type DownloadSettings } from "../../platform/downloads";
import { getExternalAppAllowances, getSiteSettingsOrigins, getZoomLevels } from "../../platform/siteSettings";
import { getPasswordAutofill, setPasswordAutofill } from "../../platform/passwords";
import { orWarn } from "../../lib/fallback";
import { menuShortcuts } from "../../platform/commands";
import { setMenuBarShortcuts } from "../commands/commandShortcuts";
import { currentSettings } from "../browser/current";
import { engineProfile } from "../browser/model";
import { currentSyncFolder, folderInfo } from "../sync/engine";
import { extensionsProfileId, refreshExtensions } from "../extensions/actions";
import { cached, load, loadAll, need, resource, store, useAllLoaded, type Needed } from "./resources";
import type { SettingsPane } from "./settingsWindows";

export const APP_ICON_SIZE = 56;

export const loginItem = resource("loginItem", () => launchAtLoginStatus().catch(() => "notRegistered"));
export const defaultBrowser = resource("defaultBrowser", () => isDefaultBrowser().catch(() => false));
export const updater = resource("updater", (): Promise<UpdaterState> => updaterState().catch(() => ({ available: false })));
export const syncFolder = resource("syncFolder", (folder: string | null) => folderInfo(folder).catch(() => null));
export const appIconChoices = resource("appIcons", () =>
  Promise.all([appIcons(APP_ICON_SIZE), currentAppIcon()]).then(([icons, current]) => ({ icons, current }), () => ({ icons: [], current: null })),
);
export const contentBlocker = resource("contentBlocker", () => getContentBlocker().catch(() => null));
export const siteOrigins = resource("siteOrigins", (profile: string) => getSiteSettingsOrigins(profile).catch((): string[] => []));
export const appLinks = resource("appLinks", (profile: string) => getExternalAppAllowances(profile).catch(() => []));
export const zoomLevels = resource("zoomLevels", (profile: string) => getZoomLevels(profile).catch((): Record<string, number> => ({})));
export const passwordAutofill = resource("passwordAutofill", (profile: string) => getPasswordAutofill(profile).catch(() => true));
export const addresses = resource("addresses", (profile: string) => listAddresses(profile).catch(orWarn<SavedAddress[]>([])));
export const cards = resource("cards", (profile: string) => listCards(profile).catch(orWarn<SavedCard[]>([])));
export const autofillEnabled = resource("autofillEnabled", (profile: string) =>
  load(addresses, [profile]).then(() => getAutofillSettings(profile).catch(() => ({ addresses: true, cards: true }))),
);
export const downloadSettings = resource("downloadSettings", (profile: string) => getDownloadSettings(profile).catch(() => null));
export const extensionList = resource("extensions", (profile: string) => refreshExtensions(profile));
export const shortcutItems = resource("menuShortcuts", () =>
  menuShortcuts().then(
    (items) => (setMenuBarShortcuts(items), items),
    () => [],
  ),
);
export const engineVersion = resource("engineInfo", () => engineInfo().catch(() => null));
export const widevine = resource("widevine", () =>
  listComponents().then(
    (list) => list.find((c) => c.id === WIDEVINE_COMPONENT_ID) ?? null,
    () => null,
  ),
);

const defaultProfile = () => engineProfile(useBrowser.getState(), currentSettings().defaultProfileId);

export function paneNeeds(pane: SettingsPane, profileId: string | null): Needed[] {
  const profile = profileId ? engineProfile(useBrowser.getState(), profileId) : defaultProfile();
  switch (pane) {
    case "general":
      return [need(loginItem), need(defaultBrowser), need(updater), need(downloadSettings, profile)];
    case "sync":
      return [need(syncFolder, currentSyncFolder() ?? null)];
    case "appearance":
      return [need(appIconChoices)];
    case "privacy":
      return [need(contentBlocker), need(siteOrigins, profile), need(appLinks, profile), need(zoomLevels, profile)];
    case "passwords":
      return [need(passwordAutofill, profile)];
    case "autofill":
      return [need(addresses, profile), need(cards, profile), need(autofillEnabled, profile)];
    case "extensions":
      return [need(extensionList, engineProfile(useBrowser.getState(), extensionsProfileId(profileId)))];
    case "shortcuts":
      return [need(shortcutItems)];
    case "advanced":
      return [need(engineVersion), need(widevine)];
    default:
      return [];
  }
}

export const usePaneLoaded = (pane: SettingsPane, profileId: string | null) => useAllLoaded(paneNeeds(pane, profileId));

export const preparePane = (pane: SettingsPane, profileId: string | null) => loadAll(paneNeeds(pane, profileId));

export async function setPasswordAutofillFor(profile: string, on: boolean) {
  await setPasswordAutofill(on, profile);
  store(passwordAutofill, [profile], on);
}

export async function setAutofillFor(profile: string, kind: "addresses" | "cards", on: boolean) {
  await setAutofillSettings({ [kind]: on }, profile);
  const enabled = cached(autofillEnabled, [profile]);
  if (enabled) store(autofillEnabled, [profile], { ...enabled, [kind]: on });
}

export const setDownloadsFor = (patch: Partial<Pick<DownloadSettings, "folder" | "askWhereToSave">>, profiles: string[]) =>
  Promise.all(profiles.map((p) => setDownloadSettings(patch, p).then((next) => store(downloadSettings, [p], next), orWarn(undefined))));

export function setUpdaterPrefs(patch: { automaticChecks?: boolean; automaticDownloads?: boolean; channel?: UpdateChannel }) {
  const state = cached(updater, []);
  if (state) store(updater, [], { ...state, ...patch });
  const reload = () => void load(updater, [], { fresh: true }).catch(() => {});
  if (patch.automaticChecks !== undefined) void setAutomaticUpdateChecks(patch.automaticChecks).finally(reload);
  if (patch.automaticDownloads !== undefined) void setAutomaticUpdateDownloads(patch.automaticDownloads).finally(reload);
  if (patch.channel !== undefined) void setUpdateChannel(patch.channel).finally(reload);
}

export function chooseAppIcon(id: string) {
  const choices = cached(appIconChoices, []);
  if (choices) store(appIconChoices, [], { ...choices, current: id });
  void setAppIcon(id);
}

export const makeDefaultBrowser = () => setAsDefaultBrowser().then((isDefault) => store(defaultBrowser, [], isDefault));
