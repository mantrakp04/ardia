import { visible } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import { DEVICE, DEVICE_TABS, PROFILE, deviceRecord, deviceTabs, profileRecord, profileScope, recordId, type DeviceTabs } from "./records";
import { remoteSpaceRecord, sharedDataChain } from "./spaceLinks";
import { APP_SCOPE, spaceScope, type RemoteSpace, type RemoteTabs, type SyncDoc, type SyncedDevice, type SyncUi } from "./syncDoc";

export function summarize(doc: SyncDoc): Pick<SyncUi, "devices" | "remoteTabs" | "remoteSpaces"> {
  const app = doc.scopes[APP_SCOPE];
  if (!app) return { devices: [], remoteTabs: {}, remoteSpaces: [] };
  const lastSeen = new Map<string, number>();
  for (const scope of Object.values(doc.scopes)) {
    for (const [device, at] of Object.entries(scope.seen)) lastSeen.set(device, Math.max(at, lastSeen.get(device) ?? 0));
  }
  const names = new Map([...visible(app, DEVICE)].flatMap(([k, v]) => {
    const record = deviceRecord(v);
    return record ? [[recordId(DEVICE, k), record.n] as const] : [];
  }));
  const devices: SyncedDevice[] = [...names].map(([id, name]) => ({ id, name, lastSeen: lastSeen.get(id) ?? null, current: id === doc.deviceId }));
  devices.sort((a, b) => Number(b.current) - Number(a.current) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  const remoteTabs: Record<string, RemoteTabs[]> = {};
  for (const [spaceId, link] of Object.entries(doc.spaces)) {
    const scope = doc.scopes[spaceScope(link.syncId)];
    if (!scope || !link.enabled) continue;
    remoteTabs[spaceId] = [...visible(scope, DEVICE_TABS)]
      .flatMap(([k, v]): { deviceId: string; value: DeviceTabs }[] => {
        const value = deviceTabs(v);
        return value ? [{ deviceId: recordId(DEVICE_TABS, k), value }] : [];
      })
      .filter(({ deviceId, value }) => deviceId !== doc.deviceId && names.has(deviceId) && value.tabs.length > 0)
      .map(({ deviceId, value }) => ({ deviceId, name: names.get(deviceId) || value.n || "Unknown Device", tabs: value.tabs.map((t) => ({ url: t.u, title: t.t })) }));
  }
  const linked = new Set(Object.values(doc.spaces).map((l) => l.syncId));
  const remoteSpaces = [...visible(app, PROFILE)]
    .filter(([k, v]) => !doc.joining && !linked.has(recordId(PROFILE, k)) && profileRecord(v))
    .map(([k, v]): RemoteSpace => {
      const syncId = recordId(PROFILE, k);
      const record = profileRecord(v)!;
      const { sharesWith, waitingFor } = sharedDataChain(doc, syncId);
      const ownerName = sharesWith ? useBrowser.getState().profiles[sharesWith]?.name : record.p ? (app.records[`identity:${record.p}`]?.v as { n?: string } | undefined)?.n : undefined;
      return {
        syncId,
        name: record.n,
        color: record.c,
        icon: record.i,
        ...(ownerName !== undefined ? { sharesWith: { name: ownerName, added: !!sharesWith } } : {}),
        ...(waitingFor ? { waiting: true as const } : {}),
      };
    });
  return { devices, remoteTabs, remoteSpaces };
}
