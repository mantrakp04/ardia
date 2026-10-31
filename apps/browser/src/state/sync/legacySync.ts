import { readDocument } from "../../platform/documents";
import { canonical, Clock, emptyScope, folderTransport, pull, restoreJournal, SyncNative, type ScopeState, type SyncRecord } from "../../platform/sync";
import { APP_SCOPE, LEGACY_SETTINGS_SCOPE, profileScope, spaceScope, type SyncDoc } from "./syncDoc";
import { profileRecord } from "./records";
import { profileKey } from "./identityAdapters";
import type { SpaceRecord } from "./spaceAdapters";
import { markedTile, PIN_ROW, ROW, type PinValue } from "./pinRecords";
import { useBrowser } from "../browser/store";
import type { TopApp } from "../browser/types";

type SavedState = { covers: number; scopes: Record<string, ScopeState> };
type Part = { id?: number; device?: string; journal?: Record<string, Parameters<typeof restoreJournal>[1]>; changes?: Record<string, { records: Record<string, SyncRecord | null>; base: Record<string, string | null>; rest: Partial<ScopeState> }> };

async function opened<T>(name: string, fallback: T): Promise<T> {
  const sealed = readDocument(name);
  if (!sealed) return fallback;
  const json = await SyncNative!.openLocal(sealed);
  if (!json) throw new Error("The previous sync state could not be opened. Its encrypted files were kept.");
  return JSON.parse(json) as T;
}

export async function importLegacySync(doc: SyncDoc): Promise<void> {
  if (!doc.folder || !doc.deviceId) return;
  const clock = new Clock(doc.deviceId, doc.clock);
  const seed = (scope: ScopeState, key: string, record: SyncRecord, base: string | null = canonical(record.v)) => {
    if (scope.records[key] && scope.records[key]!.h >= record.h) return;
    clock.observe(record.h);
    scope.records[key] = { ...record, o: [doc.deviceId!, scope.seq + 1] };
    if (base === null) delete scope.base[key];
    else scope.base[key] = base;
    scope.outbox.push({ k: key, v: record.v, h: record.h });
    scope.unapplied = [...new Set([...scope.unapplied, key])];
  };
  const deferred = doc.scopes[LEGACY_SETTINGS_SCOPE];
  if (doc.types.settings && deferred) {
    const app = doc.scopes[APP_SCOPE] ??= emptyScope();
    for (const [key, record] of Object.entries(deferred.records)) seed(app, key, record);
    delete doc.scopes[LEGACY_SETTINGS_SCOPE];
    doc.clock = clock.last;
  }
  if (!doc.legacyPending) return;
  const saved = await opened<SavedState | Record<string, ScopeState>>("sync-state.nns", {});
  const checkpoint = "covers" in saved && typeof saved.covers === "number" ? saved as SavedState : { covers: -1, scopes: saved as Record<string, ScopeState> };
  const scopes = checkpoint.scopes;
  const parts = [await opened<Part>("sync-journal.nns", {})];
  for (let n = 1; n <= 10000; n++) {
    if (!readDocument(`sync-journal-${n}.nns`)) break;
    parts.push(await opened<Part>(`sync-journal-${n}.nns`, {}));
    if (n === 10000) throw new Error("The previous sync journal is too large to upgrade safely.");
  }
  for (const part of parts) {
    if ((part.id ?? 0) <= checkpoint.covers) continue;
    if (part.device === doc.deviceId) for (const [scope, change] of Object.entries(part.changes ?? {})) {
      const state = scopes[scope] ??= emptyScope();
      for (const [key, record] of Object.entries(change.records)) { if (record) state.records[key] = record; else delete state.records[key]; }
      for (const [key, value] of Object.entries(change.base)) { if (value !== null) state.base[key] = value; else delete state.base[key]; }
      Object.assign(state, change.rest);
    }
    for (const [scope, files] of Object.entries(part.journal ?? {})) restoreJournal(scopes[scope] ??= emptyScope(), files.filter((file) => file.device === doc.deviceId), clock);
  }
  const transport = folderTransport(SyncNative!, doc.folder);
  const readScope = async (scope: string) => {
    const state = scopes[scope] ??= emptyScope();
    await pull(state, transport, scope, clock, Date.now());
    if (state.pending || Object.keys(state.damaged).length) throw new Error("Wait for the previous sync files to finish downloading, then upgrade sync again.");
    return state;
  };
  const app = await readScope("app");
  const converted = doc.scopes[APP_SCOPE] ??= emptyScope();
  const owner = (id: string): string => {
    const path: string[] = [];
    let at = id;
    while (!path.includes(at)) {
      path.push(at);
      const next = (app.records[`share:${at}`]?.v as { o?: string } | null)?.o;
      if (!next) return at;
      at = next;
    }
    return path.slice(path.indexOf(at)).sort()[0]!;
  };
  for (const [key, record] of Object.entries(app.records)) {
    if (key.startsWith("share:")) continue;
    if (key.startsWith("set:") && !doc.types.settings) {
      const deferred = doc.scopes[LEGACY_SETTINGS_SCOPE] ??= emptyScope();
      if (!deferred.records[key] || deferred.records[key]!.h < record.h) deferred.records[key] = record;
      continue;
    }
    const workspace = key.startsWith("prof:") ? key.slice(5) : key.startsWith("pth:") ? key.slice(4).split(":")[0] : null;
    const consent = workspace && Object.values(doc.spaces).find((link) => link.syncId === workspace);
    if (consent && (!consent.enabled || consent.retire)) continue;
    if (key.startsWith("prof:") && record.v) {
      const syncId = key.slice(5);
      const assignment = owner(syncId);
      const ownerRecord = app.records[`prof:${assignment}`];
      const identity = profileRecord(ownerRecord?.v) ? ownerRecord! : record;
      const meta = profileRecord(identity.v);
      if (!meta) continue;
      seed(converted, profileKey(assignment), { ...identity, v: { n: meta.n, i: meta.i } });
      seed(converted, key, { ...record, v: { ...(record.v as SpaceRecord), p: assignment } });
    } else seed(converted, key, record);
  }
  const dataPrefixes = (enabled: boolean) => enabled ? [doc.types.bookmarks && "bm:", doc.types.history && "h:", doc.types.passwords && "pws:", doc.types.extensions && "ext:"].filter((x): x is string => !!x) : [];
  for (const link of Object.values(doc.profiles)) {
    if (!link.enabled || link.retire) continue;
    const previous = await readScope(`p:${link.syncId}`);
    const next = doc.scopes[profileScope(link.syncId)] ??= emptyScope();
    for (const [key, record] of Object.entries(previous.records)) if (dataPrefixes(link.enabled).some((prefix) => key.startsWith(prefix))) seed(next, key, record, previous.base[key] ?? null);
  }
  for (const [spaceId, link] of Object.entries(doc.spaces)) {
    if (!link.enabled || link.retire) continue;
    const previous = await readScope(`p:${link.syncId}`);
    const next = doc.scopes[spaceScope(link.syncId)] ??= emptyScope();
    const tiles = new Set(Object.entries(previous.records).filter(([key, record]) => key.startsWith("pin:t:") && record.v && !(record.v as { g?: string }).g && previous.records[`${PIN_ROW}${key.slice(6)}`]?.v !== ROW).map(([key]) => key.slice(6)));
    const tileKeys = new Set([...tiles].flatMap((tile) => [`pin:t:${tile}`, `${PIN_ROW}${tile}`]));
    const profileId = useBrowser.getState().spaces[spaceId]?.profileId;
    const profile = profileId ? doc.profiles[profileId] : undefined;
    if (doc.types.pinned && profile?.topAppsEnabled && profileId) {
      const data = doc.scopes[profileScope(profile.syncId)] ??= emptyScope();
      for (const [key, record] of Object.entries(previous.records)) {
        if (!key.startsWith("pin:t:")) continue;
        const pin = key.slice(6);
        const appKey = `${link.syncId}::${pin}`;
        const local = useBrowser.getState().topApps[profileId]?.some((item) => item.key === appKey);
        if (record.v === null && local) seed(data, `app:${appKey}`, record);
        else if (tiles.has(pin)) {
          const value = record.v as PinValue;
          seed(data, `app:${appKey}`, { ...record, v: { key: appKey, url: value.u, title: value.ti, favicon: null, customTitle: value.t, customIcon: value.i, ...(() => { const mark = markedTile((name) => previous.records[name]?.v, pin); return mark.as === "tile" && mark.folder ? { tileFolder: mark.folder } : {}; })(), pos: `${String(useBrowser.getState().spaceOrder.indexOf(spaceId)).padStart(8, "0")}:${value.pos}` } });
        }
      }
      const imported = Object.entries(data.records).filter(([key, record]) => key.startsWith("app:") && record.v).map(([, record]) => record.v as TopApp & { pos: string });
      const known = new Set(Object.keys(data.records).filter((key) => key.startsWith("app:")).map((key) => key.slice(4)));
      imported.sort((a, b) => a.pos.localeCompare(b.pos) || a.key.localeCompare(b.key));
      useBrowser.setState((s) => ({ topApps: { ...s.topApps, [profileId]: [...(s.topApps[profileId] ?? []).filter((item) => !known.has(item.key)), ...imported.map(({ pos: _pos, ...item }) => item)] } }));
    }
    for (const [key, record] of Object.entries(previous.records)) {
      if (key.startsWith("tabs:") && doc.types.tabs || doc.types.pinned && /^(pin|pgh:|pord:|pgc:)/.test(key) && !tileKeys.has(key)) seed(next, key, record, previous.base[key] ?? null);
    }
  }
  doc.clock = clock.last;
  delete doc.legacyPending;
}
