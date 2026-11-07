import { create } from "zustand";
import * as engine from "../../browser/src/state/sync/engine";
import type { DataType, SyncUi } from "../../browser/src/state/sync/syncDoc";
import type { FolderInfo, PhraseResult } from "../../browser/src/platform/sync";
import { SyncNative } from "../../browser/src/platform/sync";
import { ardiaHost, type ArdiaHost } from "./host";
import {
  claimSyncAuthority,
  configureHeldLogins,
  createHeldLogins,
  HeldLoginsResetError,
  enterPhraseBegins,
  heldLoginsStatus,
  whileResettingHeldLogins,
  KEYRING_RETRY_MS,
  keyringMessage,
  keyringResumer,
  watchLockedSync,
  loadSyncDeviceName,
  presentSyncState,
  refreshSyncDocuments,
  releaseSyncAuthority,
  syncDeviceName,
  syncKeyStoreStatus,
  withChosenSyncFolder,
  type SyncKeyStoreStatus,
} from "./hostSync.ts";
import { deleteDocument, readDocument, refreshDocument, saveDocument } from "./shims/shellBase";
import { useBrowser } from "../../browser/src/state/browser/store";
import { engineProfile } from "../../browser/src/state/browser/model";
import {
  INTERACTIVE_CALL_TIMEOUT_MS,
  SYNC_CHANNEL,
  startSyncAuthority,
  type LocksLike,
  type RemoteMethod,
  type SyncAuthority,
  type SyncRemote,
} from "./syncAuthority.ts";

const KEYCHAIN_ERROR = "Couldn’t save the sync key in your Keychain.";

export const useSync = create<SyncUi>()(() => ({ ...engine.useSync.getState(), status: SyncNative ? "starting" : "unavailable" }));

let authority: SyncAuthority | null = null;
let keyStore: SyncKeyStoreStatus | null = null;
let heldLogins: ReturnType<typeof createHeldLogins> | null = null;

function adoptHeldLogins() {
  heldLogins = createHeldLogins({
    read: readDocument,
    save: saveDocument,
    remove: deleteDocument,
    seal: async (text) => SyncNative?.sealLocal(text),
    open: async (sealed) => SyncNative?.openLocal(sealed),
  });
  configureHeldLogins(heldLogins);
}

let watchingProfiles = false;
let keyringWatch: (() => void) | null = null;

function stopKeyringWatch() {
  keyringWatch?.();
  keyringWatch = null;
}

function resumeWhenKeyringOpens(host: ArdiaHost) {
  stopKeyringWatch();
  const tick = keyringResumer({
    locked: () => {
      const state = engine.useSync.getState();
      return !!authority?.isAuthority() && state.enabled && state.status === "locked";
    },
    status: () => syncKeyStoreStatus(host),
    seen: (status) => {
      const shown = keyringMessage(keyStore, false);
      keyStore = status;
      if (keyringMessage(status, false) !== shown) engine.useSync.setState({});
    },
    resume: () => engine.enterRecoveryPhrase(engine.useSync.getState().folder ?? "", ""),
  });
  keyringWatch = watchLockedSync(engine.useSync, tick, KEYRING_RETRY_MS);
}

function dropDeletedProfiles() {
  if (watchingProfiles) return;
  watchingProfiles = true;
  let last = useBrowser.getState().profiles;
  let seen = new Set(Object.keys(last).map((id) => engineProfile({ profiles: last }, id)));
  useBrowser.subscribe((state) => {
    if (state.profiles === last) return;
    last = state.profiles;
    const live = new Set(Object.keys(last).map((id) => engineProfile({ profiles: last }, id)));
    if (live.size) {
      void heldLogins?.dropProfiles([...seen].filter((profile) => !live.has(profile))).catch((error: unknown) =>
        console.warn("[ardia linux] sync", error instanceof Error ? error.message : error),
      );
    }
    seen = live;
  });
}

function dropHeldLogins() {
  heldLogins = null;
  configureHeldLogins(null);
}

function remoteFor(host: ArdiaHost): SyncRemote {
  return {
    syncNow: () => engine.syncNow(),
    turnOnSync: async (folder: string) => {
      let result: Awaited<ReturnType<typeof engine.turnOnSync>>;
      try {
        result = await whileResettingHeldLogins(
          () => engine.turnOnSync(folder),
          (result) => !("error" in result),
          () => engine.stopSync({ deleteData: true }),
        );
      } catch (error) {
        if (error instanceof HeldLoginsResetError) return { error: error.message };
        throw error;
      }
      if ("error" in result && result.error === KEYCHAIN_ERROR) {
        keyStore = await syncKeyStoreStatus(host).catch(() => keyStore);
        return { error: keyringMessage(keyStore, true) ?? "Couldn’t save the sync key in your keyring." };
      }
      return result;
    },
    enterRecoveryPhrase: (folder: string, text: string) => {
      const begins = enterPhraseBegins(engine.useSync.getState());
      return whileResettingHeldLogins(
        () => engine.enterRecoveryPhrase(folder, text),
        (result) => begins && "ok" in result,
        () => engine.stopSync(),
      ).catch((error: unknown) => {
        if (error instanceof HeldLoginsResetError) return { error: "unavailable" as const };
        throw error;
      });
    },
    stopSync: (options?: { deleteData?: boolean }) => engine.stopSync(options),
    setTypeSynced: (type: DataType, enabled: boolean) => engine.setTypeSynced(type, enabled),
    setProfileSynced: (profileId: string, enabled: boolean) => engine.setProfileSynced(profileId, enabled),
    addRemoteProfile: (syncId: string) => engine.addRemoteProfile(syncId),
    adoptProfileTheme: (profileId: string) => engine.adoptProfileTheme(profileId),
    useFolder: (path: string) => withChosenSyncFolder(path, () => engine.chooseSyncFolder()),
  };
}

async function becomeAuthority(host: ArdiaHost) {
  try {
    await refreshSyncDocuments({ refresh: refreshDocument, remove: deleteDocument });
  } catch (error) {
    useSync.setState({ status: "stalled", error: "Ardia couldn’t read this device’s sync files, so sync is paused to keep them." });
    throw error;
  }
  await loadSyncDeviceName(host);
  keyStore = await syncKeyStoreStatus(host).catch(() => null);
  adoptHeldLogins();
  dropDeletedProfiles();
  engine.startSync();
  resumeWhenKeyringOpens(host);
  return { store: engine.useSync, remote: remoteFor(host) };
}

export function startLinuxSync(options: { host?: ArdiaHost; candidate: boolean; locks?: LocksLike; channel?: () => BroadcastChannel | null }) {
  const host = options.host ?? ardiaHost;
  if (authority || !SyncNative || !host) return authority;
  const channel = (options.channel ?? (() => (typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(SYNC_CHANNEL))))();
  const id = `${host.bootstrap.windowId}:${Math.random().toString(36).slice(2)}`;
  const started = startSyncAuthority<SyncUi>({
    id,
    candidate: options.candidate && !host.bootstrap.privateWindow,
    locks: options.locks,
    channel,
    mirror: useSync,
    claim: async () => {
      const claim = await claimSyncAuthority(host);
      if (!claim.granted) dropHeldLogins();
      else if (!heldLogins && authority?.isAuthority()) adoptHeldLogins();
      return claim;
    },
    onRole: (role) => {
      if (role !== "authority") {
        dropHeldLogins();
        stopKeyringWatch();
      }
    },
    release: () => releaseSyncAuthority(host),
    become: () => becomeAuthority(host),
    present: (state) => presentSyncState(state, keyStore),
  });
  authority = started;
  if (typeof addEventListener === "function")
    addEventListener("pagehide", () => {
      stopKeyringWatch();
      started.stop();
    }, { once: true });
  return started;
}

export const linuxSyncHooks = {
  state: () => useSync.getState(),
  role: () => authority?.role() ?? "unavailable",
  heldLogins: () => heldLoginsStatus(),
  turnOnSync: (folder: string) => turnOnSync(folder),
  enterRecoveryPhrase: (folder: string, text: string) => enterRecoveryPhrase(folder, text),
  stopSync: (options?: { deleteData?: boolean }) => stopSync(options),
  syncNow: () => syncNow(),
  setTypeSynced: (type: DataType, enabled: boolean) => setTypeSynced(type, enabled),
};

export const startSync = () => void startLinuxSync({ candidate: true, locks: typeof navigator === "undefined" ? undefined : navigator.locks });

const leading = () => !!authority?.isAuthority();

function forward<T>(method: RemoteMethod, args: unknown[], timeoutMs?: number): Promise<T> {
  if (!authority) return Promise.reject(new Error("Sync isn’t running in this window."));
  return authority.call(method, args, timeoutMs) as Promise<T>;
}

const quietly = (promise: Promise<unknown>) => void promise.catch((error: unknown) => console.warn("[ardia linux] sync", error));

export const currentSyncFolder = () => useSync.getState().folder;
export const deviceName = () => syncDeviceName();
export const appScopeRecords = () => (leading() ? engine.appScopeRecords() : {});

export async function folderInfo(path?: string | null): Promise<FolderInfo | null> {
  return (await SyncNative?.folderInfo(path ?? useSync.getState().folder ?? null)) ?? null;
}

export async function chooseSyncFolder(): Promise<string | null> {
  if (!SyncNative) return null;
  if (leading()) return engine.chooseSyncFolder();
  const picked = await SyncNative.chooseFolder(useSync.getState().folder);
  if (!picked) return null;
  await forward("useFolder", [picked]);
  return picked;
}

export async function syncNow() {
  await forward("syncNow", [], INTERACTIVE_CALL_TIMEOUT_MS);
}

export async function turnOnSync(folder: string): Promise<{ ok: true } | { error: string }> {
  if (!SyncNative) return { error: "Sync isn’t available in this build." };
  try {
    return await forward("turnOnSync", [folder], INTERACTIVE_CALL_TIMEOUT_MS);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function enterRecoveryPhrase(folder: string, text: string): Promise<PhraseResult | { error: "unavailable" }> {
  if (!SyncNative) return { error: "unavailable" };
  try {
    return await forward("enterRecoveryPhrase", [folder, text], INTERACTIVE_CALL_TIMEOUT_MS);
  } catch (error) {
    console.warn("[ardia linux] sync", error instanceof Error ? error.message : error);
    return { error: "unavailable" };
  }
}

export async function stopSync(options: { deleteData?: boolean } = {}) {
  await forward("stopSync", [options], INTERACTIVE_CALL_TIMEOUT_MS);
}

export function setTypeSynced(type: DataType, enabled: boolean) {
  quietly(forward("setTypeSynced", [type, enabled]));
}

export function setProfileSynced(profileId: string, enabled: boolean) {
  quietly(forward("setProfileSynced", [profileId, enabled]));
}

export function addRemoteProfile(syncId: string): string | null {
  if (leading()) return engine.addRemoteProfile(syncId);
  quietly(forward("addRemoteProfile", [syncId]));
  return null;
}

export function adoptProfileTheme(profileId: string) {
  if (leading()) return engine.adoptProfileTheme(profileId);
  quietly(forward("adoptProfileTheme", [profileId]));
}
