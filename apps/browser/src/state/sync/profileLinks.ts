import { emptyScope, SyncNative, visible, type ScopeState } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import { isIncognitoProfile } from "../browser/model";
import { DEFAULT_PROFILE_ID } from "../settings/settings";
import type { ShareRecord } from "./adapters";
import { legacyThemeOf, type ProfileRecord } from "./profileAdapters";
import { APP_SCOPE, type SyncDoc } from "./syncDoc";
import { pairTheme } from "./syncThemes";

export const remoteProfileRecord = (doc: SyncDoc, syncId: string) => (doc.scopes[APP_SCOPE]?.records[`prof:${syncId}`]?.v ?? undefined) as ProfileRecord | undefined;

const sharedDataOwner = (doc: SyncDoc, syncId: string): string | null => {
  const owner = (doc.scopes[APP_SCOPE]?.records[`share:${syncId}`]?.v as ShareRecord | null | undefined)?.o;
  return owner && owner !== syncId ? owner : null;
};

export const linkedProfileId = (doc: SyncDoc, syncId: string): string | null => {
  const profiles = useBrowser.getState().profiles;
  return Object.entries(doc.profiles).find(([id, link]) => link.syncId === syncId && !link.retire && profiles[id])?.[0] ?? null;
};

export function sharedDataChain(doc: SyncDoc, syncId: string): { adds: string[]; sharesWith: string | null; waitingFor?: string } {
  const adds = [syncId];
  for (let at = syncId; ; ) {
    const owner = sharedDataOwner(doc, at);
    if (!owner) return { adds, sharesWith: null };
    const here = linkedProfileId(doc, owner);
    if (here) return { adds, sharesWith: here };
    if (!remoteProfileRecord(doc, owner)) return { adds, sharesWith: null, waitingFor: owner };
    if (adds.includes(owner)) {
      const lowest = adds.slice(adds.indexOf(owner)).sort()[0]!;
      return { adds: adds.slice(0, adds.indexOf(lowest) + 1), sharesWith: null };
    }
    adds.push(owner);
    at = owner;
  }
}

export function linkProfiles(doc: SyncDoc, app: ScopeState) {
  const s = useBrowser.getState();
  const remote = [...visible(app, "prof:")].map(([k, v]) => [k.slice(5), v as ProfileRecord] as const);
  const taken = new Set(Object.values(doc.profiles).map((l) => l.syncId));
  for (const id of s.profileOrder) {
    const profile = s.profiles[id];
    if (!profile || isIncognitoProfile(id) || doc.profiles[id]) continue;
    const match = doc.joining
      ? remote.find(([syncId, r]) => !taken.has(syncId) && (id === DEFAULT_PROFILE_ID ? r.d : r.n === profile.name))?.[0]
      : undefined;
    const syncId = match ?? SyncNative!.newDeviceId();
    doc.profiles[id] = { syncId, enabled: true };
    taken.add(syncId);
    if (match) {
      doc.scopes[`p:${syncId}`] = { ...emptyScope(), awaitRemote: true };
      pairTheme(app, id, doc.profiles[id]!);
    }
  }
  for (const [id, link] of Object.entries(doc.profiles)) if (!s.profiles[id] && !link.retire) link.retire = true;
}

export function addLinkedProfile(doc: SyncDoc, syncId: string, record: ProfileRecord, shareWith: string | null): string {
  const id = useBrowser.getState().createProfile({ name: record.n, color: record.c, icon: record.i, shareWith });
  const app = doc.scopes[APP_SCOPE];
  doc.profiles[id] = { syncId, enabled: true };
  if (app) pairTheme(app, id, doc.profiles[id]!);
  else {
    const theme = legacyThemeOf(record);
    if (theme) useBrowser.getState().updateProfile(id, theme);
    doc.profiles[id]!.themeAdopting = true;
  }
  doc.scopes[`p:${syncId}`] = { ...emptyScope(), awaitRemote: true };
  return id;
}
