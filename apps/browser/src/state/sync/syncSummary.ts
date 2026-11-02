import { visible } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import { DEVICE_TABS, PROFILE, deviceTabs, profileRecord, profileScope, recordId, type DeviceTabs } from "./records";
import { deviceKindOf, deviceRecords, isCurrentDevice, offersTabs } from "./devices";
import { remoteProfileRecord, sharedDataChain } from "./profileLinks";
import { APP_SCOPE, type RemoteProfile, type RemoteTabs, type SyncDoc, type SyncedDevice, type SyncUi } from "./syncDoc";

export function summarize(doc: SyncDoc): Pick<SyncUi, "devices" | "remoteTabs" | "remoteProfiles"> {
  const app = doc.scopes[APP_SCOPE];
  if (!app) return { devices: [], remoteTabs: {}, remoteProfiles: [] };
  const lastSeen = new Map<string, number>();
  for (const scope of Object.values(doc.scopes)) {
    for (const [device, at] of Object.entries(scope.seen)) lastSeen.set(device, Math.max(at, lastSeen.get(device) ?? 0));
  }
  const now = Date.now();
  const records = new Map([...deviceRecords(app)].filter(([id, r]) => id === doc.deviceId || isCurrentDevice(r, lastSeen.get(id), now)));
  const names = new Map([...records].map(([id, r]) => [id, r.n]));
  const devices: SyncedDevice[] = [...records].map(([id, r]) => ({
    id,
    name: r.n,
    kind: deviceKindOf(r),
    receivesTabs: offersTabs(r, lastSeen.get(id), now),
    lastSeen: lastSeen.get(id) ?? null,
    current: id === doc.deviceId,
  }));
  devices.sort((a, b) => Number(b.current) - Number(a.current) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  const remoteTabs: Record<string, RemoteTabs[]> = {};
  for (const [profileId, link] of Object.entries(doc.profiles)) {
    const scope = doc.scopes[profileScope(link.syncId)];
    if (!scope || !link.enabled) continue;
    remoteTabs[profileId] = [...visible(scope, DEVICE_TABS)]
      .flatMap(([k, v]): { deviceId: string; value: DeviceTabs }[] => {
        const value = deviceTabs(v);
        return value ? [{ deviceId: recordId(DEVICE_TABS, k), value }] : [];
      })
      .filter(({ deviceId, value }) => deviceId !== doc.deviceId && names.has(deviceId) && value.tabs.length > 0)
      .map(({ deviceId, value }) => ({
        deviceId,
        name: names.get(deviceId) || value.n || "Unknown Device",
        kind: deviceKindOf(records.get(deviceId)?.k ? records.get(deviceId) : value),
        tabs: value.tabs.map((t) => ({ url: t.u, title: t.t })),
      }));
  }
  const linked = new Set(Object.values(doc.profiles).map((l) => l.syncId));
  const remoteProfiles = [...visible(app, PROFILE)]
    .filter(([k, v]) => !doc.joining && !linked.has(recordId(PROFILE, k)) && profileRecord(v))
    .map(([k, v]): RemoteProfile => {
      const syncId = recordId(PROFILE, k);
      const record = profileRecord(v)!;
      const { adds, sharesWith, waitingFor } = sharedDataChain(doc, syncId);
      const ownerName = adds[1] ? remoteProfileRecord(doc, adds[1])?.n : sharesWith ? useBrowser.getState().profiles[sharesWith]?.name : undefined;
      return {
        syncId,
        name: record.n,
        color: record.c,
        icon: record.i,
        ...(ownerName !== undefined ? { sharesWith: { name: ownerName, added: !!adds[1] } } : {}),
        ...(waitingFor ? { waiting: true as const } : {}),
      };
    });
  return { devices, remoteTabs, remoteProfiles };
}
