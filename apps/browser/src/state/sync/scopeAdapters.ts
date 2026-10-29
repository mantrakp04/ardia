import { SyncNative, type Adapter } from "../../platform/sync";
import { deviceAdapter, deviceTabsAdapter, inTodaysNames } from "./adapters";
import { profilesAdapter } from "./identityAdapters";
import { spacesAdapter, spaceThemesAdapter } from "./spaceAdapters";
import { settingsAdapter } from "./settingsAdapter";
import { pinnedAreaAdapters } from "./pinned";
import { APP_SCOPE, type SyncDoc } from "./syncDoc";

export const deviceName = () => SyncNative?.deviceName() ?? "This Mac";
export function appAdapters(doc: SyncDoc, retiring: boolean): Adapter[] {
  const id = doc.deviceId!;
  if (retiring) return [deviceAdapter(id, deviceName, true)];
  const enabledLinks = () => Object.fromEntries(Object.entries(doc.spaces).filter(([, l]) => l.enabled));
  return [
    ...(doc.types.settings ? [inTodaysNames(settingsAdapter)] : []),
    profilesAdapter(() => doc.profiles),
    spacesAdapter(enabledLinks, () => doc.profiles),
    spaceThemesAdapter(enabledLinks, () => doc.scopes[APP_SCOPE]?.records),
    deviceAdapter(id, deviceName),
  ];
}
export function spaceAdapters(doc: SyncDoc, spaceId: string, retiring: boolean): Adapter[] {
  const id = doc.deviceId!;
  if (retiring) return [deviceTabsAdapter(spaceId, id, deviceName, true)];
  return [
    ...(doc.types.pinned ? pinnedAreaAdapters(spaceId, true) : []),
    inTodaysNames(deviceTabsAdapter(spaceId, id, deviceName, !doc.types.tabs)),
  ];
}
