import { SyncNative, type Adapter, type ExtensionsAdapter } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import { bookmarksAdapter, deviceAdapter, deviceTabsAdapter, historyAdapter, inTodaysNames, passwordsAdapter, sharedDataAdapter } from "./adapters";
import { profilesAdapter, profileThemesAdapter } from "./profileAdapters";
import { settingsAdapter } from "./settingsAdapter";
import { pinnedAreaAdapters } from "./pinned";
import { extensionsAdapterFor } from "./extensions";
import { APP_SCOPE, typeSyncedFor, type DataType, type SyncDoc } from "./syncDoc";

export const deviceName = () => SyncNative?.deviceName() ?? "This Mac";

const passwordAdapters = new Map<string, (forced: boolean) => Adapter>();
const extensionAdapters = new Map<string, ExtensionsAdapter>();

export function forgetScopeAdapters() {
  passwordAdapters.clear();
  extensionAdapters.clear();
}

export const typeSynced = (doc: SyncDoc, type: DataType, profileId: string) =>
  typeSyncedFor(doc.types, type, !useBrowser.getState().profiles[profileId]?.dataId);

export function extensionsOf(profileId: string): ExtensionsAdapter {
  let adapter = extensionAdapters.get(profileId);
  if (!adapter) extensionAdapters.set(profileId, (adapter = extensionsAdapterFor(profileId)));
  return adapter;
}

export function appAdapters(doc: SyncDoc, retiring: boolean): Adapter[] {
  const id = doc.deviceId!;
  if (retiring) return [deviceAdapter(id, deviceName, true)];
  const enabledLinks = () => Object.fromEntries(Object.entries(doc.profiles).filter(([, l]) => l.enabled));
  return [
    ...(doc.types.settings ? [inTodaysNames(settingsAdapter)] : []),
    sharedDataAdapter(() => doc.profiles),
    profilesAdapter(enabledLinks),
    profileThemesAdapter(enabledLinks, () => doc.scopes[APP_SCOPE]?.records),
    deviceAdapter(id, deviceName),
  ];
}

export function profileAdapters(doc: SyncDoc, profileId: string, retiring: boolean, forcePasswords: boolean): Adapter[] {
  const id = doc.deviceId!;
  if (retiring) return [deviceTabsAdapter(profileId, id, deviceName, true)];
  const synced = (type: DataType) => typeSynced(doc, type, profileId);
  let passwords = passwordAdapters.get(profileId);
  if (!passwords) passwordAdapters.set(profileId, (passwords = passwordsAdapter(profileId)));
  return [
    ...(synced("pinned") ? pinnedAreaAdapters(profileId) : []),
    ...(synced("bookmarks") ? [inTodaysNames(bookmarksAdapter(profileId))] : []),
    ...(synced("history") ? [inTodaysNames(historyAdapter(profileId))] : []),
    inTodaysNames(deviceTabsAdapter(profileId, id, deviceName, !synced("tabs"))),
    ...(synced("passwords") ? [passwords(forcePasswords)] : []),
    ...(synced("extensions") ? [extensionsOf(profileId)] : []),
  ];
}
