import { emptyScope, SyncNative, visible, type ScopeState } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import { isIncognitoSpace } from "../browser/model";
import { DEFAULT_SPACE_ID } from "../settings/settings";
import { legacyThemeOf, type SpaceRecord } from "./spaceAdapters";
import { APP_SCOPE, profileScope, spaceScope, type SyncDoc } from "./syncDoc";
import { profileRecord } from "./records";
import { pairTheme } from "./syncThemes";
import { identityRecord, profileKey } from "./identityAdapters";

export const remoteSpaceRecord = (doc: SyncDoc, syncId: string) => (doc.scopes[APP_SCOPE]?.records[`prof:${syncId}`]?.v ?? undefined) as SpaceRecord | undefined;
export const linkedSpaceId = (doc: SyncDoc, syncId: string): string | null => Object.entries(doc.spaces).find(([id, link]) => link.syncId === syncId && !link.retire && useBrowser.getState().spaces[id])?.[0] ?? null;
export const linkedProfileId = (doc: SyncDoc, syncId: string): string | null => Object.entries(doc.profiles).find(([id, link]) => link.syncId === syncId && useBrowser.getState().profiles[id])?.[0] ?? null;

export function sharedDataChain(doc: SyncDoc, syncId: string): { adds: string[]; sharesWith: string | null; waitingFor?: string } {
  const record = remoteSpaceRecord(doc, syncId);
  if (!record?.p || !identityRecord(doc.scopes[APP_SCOPE]?.records[profileKey(record.p)]?.v)) return { adds: [syncId], sharesWith: null, waitingFor: record?.p ?? syncId };
  return { adds: [syncId], sharesWith: linkedProfileId(doc, record.p) };
}

export function linkSpaces(doc: SyncDoc, app: ScopeState) {
  const s = useBrowser.getState();
  const remoteSpaces = [...visible(app, "prof:")].flatMap(([key, value]) => {
    const record = profileRecord(value);
    return record ? [[key.slice(5), record] as const] : [];
  });
  const defaultSpace = remoteSpaces.find(([, record]) => record.d && typeof record.p === "string" && record.p.trim());
  for (const p of Object.values(s.profiles)) {
    if (doc.profiles[p.id]) continue;
    const hint = defaultSpace?.[1].p;
    const remote = doc.joining && p.id === "default" ? [...visible(app, "identity:")].find(([, value]) => identityRecord(value)?.seed)?.[0].slice(9) ?? hint : undefined;
    if (doc.joining && !pairingOverdue(doc, Date.now()) && p.id === "default" && !remote && (app.pending || Object.keys(app.damaged).length)) continue;
    const syncId = remote ?? SyncNative!.newDeviceId();
    doc.profiles[p.id] = { syncId, enabled: true, topAppsEnabled: true, ...(remote && !app.records[profileKey(remote)]?.v ? { adopting: true as const } : {}) };
    if (remote) doc.scopes[profileScope(syncId)] = { ...emptyScope(), awaitRemote: true };
  }
  for (const id of s.spaceOrder) {
    const space = s.spaces[id];
    if (!space || isIncognitoSpace(id) || doc.spaces[id]) continue;
    if (!doc.profiles[space.profileId]) continue;
    const match = doc.joining && id === DEFAULT_SPACE_ID ? defaultSpace?.[0] : undefined;
    if (doc.joining && id === DEFAULT_SPACE_ID && !match && !pairingOverdue(doc, Date.now())) continue;
    const syncId = match ?? SyncNative!.newDeviceId();
    doc.spaces[id] = { syncId, enabled: true, ...(match ? { adopting: true as const } : {}) };
    if (match) { doc.scopes[spaceScope(syncId)] = { ...emptyScope(), awaitRemote: true }; pairTheme(app, id, doc.spaces[id]!); }
  }
  for (const [id, link] of Object.entries(doc.spaces)) {
    const assignment = (app.records[`prof:${link.syncId}`]?.v as SpaceRecord | undefined)?.p;
    if (s.spaces[id] && assignment && !linkedProfileId(doc, assignment)) ensureLinkedProfile(doc, assignment, false);
  }
  for (const [id, link] of Object.entries(doc.spaces)) if (!s.spaces[id] && !link.retire) link.retire = true;
}

export function ensureLinkedProfile(doc: SyncDoc, syncId: string, consented = false): string | null {
  const known = linkedProfileId(doc, syncId);
  if (known) return known;
  const record = identityRecord(doc.scopes[APP_SCOPE]?.records[profileKey(syncId)]?.v);
  if (!record) return null;
  const id = useBrowser.getState().createProfile({ name: record.n, icon: record.i });
  doc.profiles[id] = { syncId, enabled: consented, topAppsEnabled: consented };
  doc.scopes[profileScope(syncId)] = { ...emptyScope(), awaitRemote: true };
  return id;
}

export function addLinkedSpace(doc: SyncDoc, syncId: string, record: SpaceRecord, profileId: string | null): string {
  const assigned = profileId ?? (record.p ? ensureLinkedProfile(doc, record.p) : null);
  if (!assigned) throw new Error("Waiting for this space’s browsing profile to sync.");
  const id = useBrowser.getState().createSpace({ name: record.n, color: record.c, icon: record.i, profileId: assigned });
  const app = doc.scopes[APP_SCOPE];
  doc.spaces[id] = { syncId, enabled: true };
  if (app) pairTheme(app, id, doc.spaces[id]!);
  else { const theme = legacyThemeOf(record); if (theme) useBrowser.getState().updateSpace(id, theme); doc.spaces[id]!.themeAdopting = true; }
  doc.scopes[spaceScope(syncId)] = { ...emptyScope(), awaitRemote: true };
  return id;
}

const PAIRING_WAIT_MS = 86_400_000;

const pairingOverdue = (doc: SyncDoc, now: number) => doc.setupAt !== null && now - doc.setupAt > PAIRING_WAIT_MS;

export function appScopeOf(doc: SyncDoc, now = Date.now()): ScopeState {
  const app = (doc.scopes[APP_SCOPE] ??= { ...emptyScope(), awaitRemote: doc.joining });
  if (doc.joining && pairingOverdue(doc, now)) delete app.awaitRemote;
  return app;
}

export function readyToPair(doc: SyncDoc, app: ScopeState, now = Date.now()): boolean {
  if (!doc.joining || pairingOverdue(doc, now)) return true;
  const synced = [...visible(app, "prof:").values()].flatMap((v) => profileRecord(v) ?? []);
  return synced.some((r) => r.d && typeof r.p === "string" && r.p.trim());
}
