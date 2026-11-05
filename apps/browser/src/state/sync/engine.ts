import {
  emptyScope,
  EXTENSION_PREFIX,
  folderTransport,
  syncScope,
  SyncNative,
  visible,
  type FolderInfo,
  type PhraseResult,
} from "../../platform/sync";
import { create } from "zustand";
import { useBrowser } from "../browser/store";
import { engineProfile } from "../browser/model";
import { historyExpired } from "./adapters";
import { settingsToReapply } from "./settingsAdapter";
import { watchExtensionIntents } from "./extensions";
import { appAdapters, extensionsOf, forgetScopeAdapters, profileAdapters, typeSynced } from "./scopeAdapters";
import { APP_SCOPE, defaultTypes, emptyDoc, type DataType, type SyncDoc, type SyncUi } from "./syncDoc";
import { syncFiles } from "./syncFiles";
import { settleThemeAdoption, themeChosenHere } from "./syncThemes";
import { editClock, startEditClock } from "./editClock";
import { addLinkedProfile, appScopeOf, linkedProfileId, linkProfiles, readyToPair, remoteProfileRecord, sharedDataChain } from "./profileLinks";
import { summarize } from "./syncSummary";
import { profileScope } from "./records";
import { errorText } from "../../lib/errors";
import { isQuitting, saveBeforeQuit } from "../app/quit";

const CYCLE_MS = 15_000;
const AFTER_EDIT_MS = 3_000;

export const useSync = create<SyncUi>()(() => ({
  status: SyncNative ? "off" : "unavailable",
  enabled: false,
  joining: false,
  folder: null,
  types: defaultTypes(),
  profiles: {},
  lastSyncedAt: null,
  error: null,
  pending: 0,
  devices: [],
  remoteTabs: {},
  remoteProfiles: [],
}));

export const currentSyncFolder = () => useSync.getState().folder;

let doc: SyncDoc = emptyDoc();
let cycle: Promise<void> | null = null;
let again = false;
let forcePasswordsNext = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const { read, loadState, persistJournal, watchScope, save, startOver, checkpoint } = syncFiles(() => doc);

function load() {
  const loaded = read();
  if (loaded) doc = loaded;
}

function publishUi(patch: Partial<SyncUi> = {}) {
  useSync.setState({
    enabled: doc.enabled,
    joining: doc.enabled && doc.joining,
    folder: doc.folder,
    types: { ...doc.types },
    profiles: { ...doc.profiles },
    lastSyncedAt: doc.lastSyncedAt,
    ...(doc.enabled ? summarize(doc) : { devices: [], remoteTabs: {}, remoteProfiles: [], pending: 0 }),
    ...patch,
  });
}

function watchExtensions() {
  if (!doc.enabled) return;
  const s = useBrowser.getState();
  const watched = Object.entries(doc.profiles).filter(([id, l]) => l.enabled && s.profiles[id] && typeSynced(doc, "extensions", id));
  const profiles = [...new Set(watched.map(([id]) => engineProfile(s, id)))];
  if (profiles.length) watchExtensionIntents(profiles);
}

function scheduleSync(delay = AFTER_EDIT_MS) {
  if (!doc.enabled) return;
  clearTimeout(timer);
  timer = setTimeout(() => void runCycle(), delay);
}

export async function syncNow() {
  await runCycle({ forcePasswords: true });
}

type CycleOptions = { retiring?: boolean; forcePasswords?: boolean };

async function runCycle({ retiring = false, forcePasswords = false }: CycleOptions = {}) {
  if (!SyncNative || !doc.enabled || !doc.folder || !doc.deviceId) return;
  if (cycle) {
    again = true;
    forcePasswordsNext ||= forcePasswords;
    return;
  }
  const options = { retiring, forcePasswords: forcePasswords || forcePasswordsNext };
  forcePasswordsNext = false;
  cycle = cycleOnce(SyncNative, doc.folder, doc.deviceId, options);
  try {
    await cycle;
  } finally {
    cycle = null;
  }
}

async function cycleOnce(native: NonNullable<typeof SyncNative>, folder: string, device: string, { retiring, forcePasswords }: Required<CycleOptions>) {
  clearTimeout(timer);
  const slow = setTimeout(() => useSync.getState().status === "updated" && publishUi({ status: "updating" }), 1000);
  try {
    watchExtensions();
    const status = await native.chainStatus(folder);
    if (status === "unavailable") return publishUi({ status: "offline", error: null });
    if (status === "missing") return await resetFromElsewhere();
    const transport = folderTransport(native, folder);
    if (editClock().device !== device) startEditClock(device, doc.clock);
    const clock = editClock();
    const app = appScopeOf(doc);
    const appSettled = watchScope(APP_SCOPE, app, clock);
    try {
      await syncScope({
        scope: APP_SCOPE,
        state: app,
        transport,
        adapters: appAdapters(doc, retiring),
        clock,
        device,
        options: { persist: persistJournal(APP_SCOPE), holdApply: isQuitting },
      });
    } finally {
      await appSettled();
    }
    if (app.joined && readyToPair(doc, app) && !isQuitting()) linkProfiles(doc, app);
    settleThemeAdoption(doc.profiles, app, true);
    let pending = app.pending;
    const s = useBrowser.getState();
    for (const [profileId, link] of Object.entries(doc.profiles)) {
      const exists = !!s.profiles[profileId];
      const retire = retiring || !!link.retire || !exists;
      if (!retire && !link.enabled) continue;
      const scope = profileScope(link.syncId);
      const state = (doc.scopes[scope] ??= emptyScope());
      const settled = watchScope(scope, state, clock);
      try {
        await syncScope({
          scope,
          state,
          transport,
          adapters: profileAdapters(doc, profileId, retire, forcePasswords),
          clock,
          device,
          options: { expired: historyExpired, persist: persistJournal(scope), holdApply: isQuitting },
        });
      } finally {
        await settled();
      }
      pending += state.pending;
      if (!retire && !isQuitting() && typeSynced(doc, "extensions", profileId)) await extensionsOf(profileId).reconcile(visible(state, EXTENSION_PREFIX), Date.now(), isQuitting);
      if (retire) {
        delete link.retire;
        if (!exists) {
          delete doc.scopes[scope];
          delete doc.profiles[profileId];
        }
      }
    }
    doc.clock = clock.last;
    doc.lastSyncedAt = Date.now();
    publishUi({ status: "updated", error: null, pending });
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "ERR_SYNC_FOLDER_UNREADABLE") {
      publishUi({ status: "offline", error: "The sync folder can’t be read. Check that it’s still there and that Ardia can open it." });
    } else {
      console.warn("[sync] cycle failed", error);
      publishUi({ status: "stalled", error: errorText(error) });
    }
  } finally {
    clearTimeout(slow);
    save();
    if (doc.enabled) {
      if (again) {
        again = false;
        scheduleSync(0);
      } else {
        scheduleSync(CYCLE_MS);
      }
    }
  }
}

export function adoptProfileTheme(profileId: string) {
  if (!themeChosenHere(doc.profiles[profileId])) return;
  save();
  if (doc.enabled) scheduleSync(AFTER_EDIT_MS);
}

async function loadSavedState() {
  await loadState();
  startEditClock(doc.deviceId ?? "", doc.clock);
  const app = doc.scopes[APP_SCOPE];
  if (app) app.unapplied = [...new Set([...app.unapplied, ...settingsToReapply(app.records)])];
  settleThemeAdoption(doc.profiles, app, false);
}

async function resetFromElsewhere() {
  await SyncNative?.forget(doc.deviceId!);
  doc = { ...emptyDoc(), folder: doc.folder, types: doc.types };
  startOver();
  publishUi({ status: "reset", error: "This device is out of sync. Sync may have been reset from another device." });
}

export async function folderInfo(path?: string | null): Promise<FolderInfo | null> {
  return (await SyncNative?.folderInfo(path ?? doc.folder ?? null)) ?? null;
}

function setSyncFolder(path: string) {
  if (doc.enabled) return;
  doc.folder = path;
  save();
  publishUi();
}

export async function chooseSyncFolder(): Promise<string | null> {
  const picked = (await SyncNative?.chooseFolder(doc.folder)) ?? null;
  if (picked) setSyncFolder(picked);
  return picked;
}

function begin(folder: string, deviceId: string, joining: boolean) {
  doc = { ...emptyDoc(), types: doc.types, enabled: true, folder, deviceId, setupAt: Date.now(), joining };
  startOver();
  publishUi({ status: "starting", error: null });
  scheduleSync(0);
}

export async function turnOnSync(folder: string): Promise<{ ok: true } | { error: string }> {
  const native = SyncNative;
  if (!native) return { error: "Sync isn’t available in this build." };
  const deviceId = native.newDeviceId();
  try {
    if (!(await native.createPhrase(deviceId))) return { error: "Couldn’t save the sync key in your Keychain." };
    await native.createChain(folder);
  } catch (error) {
    await native.forget(deviceId);
    return { error: `Couldn’t use that folder: ${errorText(error)}` };
  }
  begin(folder, deviceId, false);
  return { ok: true };
}

export async function enterRecoveryPhrase(folder: string, text: string): Promise<PhraseResult | { error: "unavailable" }> {
  const native = SyncNative;
  if (!native) return { error: "unavailable" };
  if (doc.enabled && doc.deviceId && useSync.getState().status === "locked") {
    const result = await native.enterPhrase(doc.deviceId, text, doc.folder ?? folder);
    if ("ok" in result) {
      await loadSavedState();
      publishUi({ status: "starting", error: null });
      scheduleSync(0);
    }
    return result;
  }
  const deviceId = native.newDeviceId();
  const result = await native.enterPhrase(deviceId, text, folder);
  if ("ok" in result) begin(folder, deviceId, true);
  return result;
}

export async function stopSync({ deleteData = false } = {}) {
  const native = SyncNative;
  if (!native || !doc.enabled) return;
  clearTimeout(timer);
  const reportFailure = (error: unknown) => console.warn("[sync] the last cycle before stopping failed", error);
  while (cycle) await cycle.catch(reportFailure);
  if (useSync.getState().status !== "locked") await runCycle({ retiring: true }).catch(reportFailure);
  clearTimeout(timer);
  const folder = doc.folder;
  if (deleteData && folder) {
    try {
      await native.deleteChain(folder);
    } catch (error) {
      console.warn("[sync] deleting sync data failed", error);
    }
  }
  if (doc.deviceId) await native.forget(doc.deviceId);
  doc = { ...emptyDoc(), folder, types: doc.types };
  forgetScopeAdapters();
  startOver();
  publishUi({ status: "off", error: null });
}

export function setTypeSynced(type: DataType, enabled: boolean) {
  doc.types = { ...doc.types, [type]: enabled };
  save();
  publishUi();
  scheduleSync(0);
}

export function setProfileSynced(profileId: string, enabled: boolean) {
  const link = doc.profiles[profileId];
  if (!link) return;
  const { retire: _retire, ...kept } = link;
  doc.profiles[profileId] = enabled ? { ...kept, enabled } : { ...link, enabled, retire: true };
  save();
  publishUi();
  scheduleSync(0);
}

export const appScopeRecords = () => doc.scopes[APP_SCOPE]?.records ?? {};

export function addRemoteProfile(syncId: string): string | null {
  if (!remoteProfileRecord(doc, syncId) || linkedProfileId(doc, syncId)) return null;
  const { adds, sharesWith, waitingFor } = sharedDataChain(doc, syncId);
  if (waitingFor) return null;
  let shareWith = sharesWith;
  for (const add of adds.reverse()) shareWith = addLinkedProfile(doc, add, remoteProfileRecord(doc, add)!, shareWith);
  save();
  publishUi();
  scheduleSync(0);
  return shareWith;
}

export function startSync() {
  if (!SyncNative) return;
  load();
  publishUi({ status: doc.enabled ? "starting" : "off" });
  watchExtensions();
  if (doc.enabled && doc.deviceId) {
    void SyncNative.unlock(doc.deviceId).then(async (ok) => {
      if (!ok) return publishUi({ status: "locked", error: "Enter your recovery phrase to keep syncing on this Mac." });
      await loadSavedState();
      publishUi();
      scheduleSync(500);
    });
  }
  saveBeforeQuit(checkpoint);
  useBrowser.subscribe((s, prev) => {
    if (!doc.enabled || cycle) return;
    if (s.bookmarks !== prev.bookmarks || s.settings !== prev.settings || s.profiles !== prev.profiles || s.groups !== prev.groups) scheduleSync();
  });
  if (__DEV__) {
    (globalThis as { acSync?: object }).acSync = {
      useSync, syncNow, turnOnSync, enterRecoveryPhrase, stopSync, setTypeSynced, setProfileSynced, addRemoteProfile, setSyncFolder, folderInfo,
      doc: () => doc,
      native: SyncNative,
      get menu(): typeof import("./menu") {
        return require("./menu");
      },
    };
  }
}
