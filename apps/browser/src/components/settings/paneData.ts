import {
  engineInfo,
  getAutofillSettings,
  getContentBlocker,
  getDownloadSettings,
  getExternalAppAllowances,
  getPasswordAutofill,
  getSiteSettingsOrigins,
  getZoomLevels,
  listAddresses,
  listCards,
  listComponents,
  WIDEVINE_COMPONENT_ID,
} from "@ardia/ardiacore";
import { appIcons, currentAppIcon, isDefaultBrowser, launchAtLoginStatus, menuShortcuts, updaterState, type UpdaterState } from "@ardia/shell";
import { useBrowser } from "../../store/browser";
import { engineProfile } from "../../store/model";
import { folderInfo } from "../../sync/engine";
import { useSync } from "../../sync/engine";
import { extensionsProfileId, refreshExtensions } from "../extensions/state";
import { load, loadAll, need, resource, useAllLoaded, type Needed } from "./resources";
import type { SettingsPane } from "./windows";

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
export const addresses = resource("addresses", (profile: string) => listAddresses(profile).catch(() => []));
export const cards = resource("cards", (profile: string) => listCards(profile).catch(() => []));
export const autofillEnabled = resource("autofillEnabled", (profile: string) =>
  load(addresses, [profile]).then(() => getAutofillSettings(profile).catch(() => ({ addresses: true, cards: true }))),
);
export const downloadSettings = resource("downloadSettings", (profile: string) => getDownloadSettings(profile).catch(() => null));
export const extensionList = resource("extensions", (profile: string) => refreshExtensions(profile));
export const shortcutItems = resource("menuShortcuts", () => menuShortcuts().catch(() => []));
export const engineVersion = resource("engineInfo", () => engineInfo().catch(() => null));
export const widevine = resource("widevine", () =>
  listComponents().then(
    (list) => list.find((c) => c.id === WIDEVINE_COMPONENT_ID) ?? null,
    () => null,
  ),
);

const defaultProfile = () => engineProfile(useBrowser.getState().settings.defaultProfileId);

export function paneNeeds(pane: SettingsPane, profileId: string | null): Needed[] {
  const profile = profileId ? engineProfile(profileId) : defaultProfile();
  switch (pane) {
    case "general":
      return [need(loginItem), need(defaultBrowser), need(updater), need(downloadSettings, profile)];
    case "sync":
      return [need(syncFolder, useSync.getState().folder ?? null)];
    case "appearance":
      return [need(appIconChoices)];
    case "privacy":
      return [need(contentBlocker), need(siteOrigins, profile), need(appLinks, profile), need(zoomLevels, profile)];
    case "passwords":
      return [need(passwordAutofill, profile)];
    case "autofill":
      return [need(addresses, profile), need(cards, profile), need(autofillEnabled, profile)];
    case "extensions":
      return [need(extensionList, engineProfile(extensionsProfileId(profileId)))];
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
