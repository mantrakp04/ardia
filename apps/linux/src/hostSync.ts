import type { ArdiaHost } from "./host";
import { hostProfile, invokeHost } from "./host.ts";

export const SYNC_CAPABILITIES = [
  "ArdiaSync.folderInfo",
  "ArdiaSync.chooseFolder",
  "ArdiaSync.deviceName",
  "ArdiaSync.status",
  "ArdiaSync.createPhrase",
  "ArdiaSync.enterPhrase",
  "ArdiaSync.unlock",
  "ArdiaSync.forget",
  "ArdiaSync.chainStatus",
  "ArdiaSync.createChain",
  "ArdiaSync.write",
  "ArdiaSync.read",
  "ArdiaSync.remove",
  "ArdiaSync.deleteChain",
  "ArdiaSync.sealLocal",
  "ArdiaSync.openLocal",
  "ArdiaSync.recoveryWords",
  "ArdiaSync.qrCode",
  "ArdiaSync.copyRecoveryPhrase",
  "ArdiaSync.saveRecoveryKit",
  "ArdiaSync.recoveryKitPreview",
  "ArdiaSync.copyRecoveryKit",
  "ArdiaSync.shareRecoveryKit",
  "ArdiaSync.revealFolder",
  "ArdiaSync.readPasswords",
  "ArdiaSync.savePassword",
  "ArdiaSync.claimAuthority",
  "ArdiaSync.releaseAuthority",
] as const;

export type SyncKeyStoreStatus = {
  keyStore: "secretService" | "file" | string;
  keyStoreStatus: "ok" | "notFound" | "locked" | "unavailable";
  lastKeyStatus: "ok" | "notFound" | "locked" | "unavailable";
  unlocked: boolean;
  unreadable: boolean;
  passwords: boolean;
};

export type AuthorityClaim = { granted: boolean; leaseMs: number };

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const FALLBACK_DEVICE_NAME = "Linux";
const SYNC_METHODS: ReadonlySet<string> = new Set(SYNC_CAPABILITIES);

export function base32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

export function newSyncDeviceId(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  return base32(random(new Uint8Array(16)));
}

let deviceName: string | null = null;
let chosenFolder: { path: string } | null = null;

export const syncDeviceName = () => deviceName ?? FALLBACK_DEVICE_NAME;

export async function loadSyncDeviceName(host: ArdiaHost): Promise<string> {
  try {
    const name = await invokeHost<unknown>("ArdiaSync.deviceName", { args: [] }, host);
    if (typeof name === "string" && name.trim()) deviceName = name.trim().slice(0, 128);
  } catch {}
  return syncDeviceName();
}

export async function withChosenSyncFolder<T>(path: string, run: () => Promise<T>): Promise<T> {
  chosenFolder = { path };
  try {
    return await run();
  } finally {
    chosenFolder = null;
  }
}

export function keyringMessage(status: SyncKeyStoreStatus | null, saving: boolean): string | null {
  const store = status?.keyStore;
  const state = saving ? status?.lastKeyStatus ?? status?.keyStoreStatus : status?.keyStoreStatus;
  if (store !== "secretService") return null;
  if (state === "unavailable")
    return saving
      ? "Couldn’t save the sync key: no keyring is running. Start a Secret Service keyring, like GNOME Keyring or KWallet, and try again."
      : "No keyring is running, so Ardia can’t read this device’s sync key. Start a Secret Service keyring, like GNOME Keyring or KWallet, or enter your recovery phrase.";
  if (state === "locked")
    return saving
      ? "Couldn’t save the sync key: your keyring is locked. Unlock it and try again."
      : "Your keyring is locked. Unlock it, or enter your recovery phrase to keep syncing.";
  return null;
}

export const KEYRING_RETRY_MS = 3000;
const KEYRING_CLOSED: ReadonlySet<string> = new Set(["locked", "unavailable"]);

export type KeyringResumerIo = {
  locked(): boolean;
  status(): Promise<SyncKeyStoreStatus>;
  seen(status: SyncKeyStoreStatus): void;
  resume(): Promise<unknown>;
};

export function keyringResumer(io: KeyringResumerIo): () => Promise<boolean> {
  let busy = false;
  let triedHeldKey = false;
  return async () => {
    if (busy || !io.locked()) return false;
    busy = true;
    try {
      const status = await io.status();
      io.seen(status);
      if (status.keyStore !== "secretService") return false;
      if (!status.unlocked) triedHeldKey = false;
      const opened = status.keyStoreStatus === "ok" && KEYRING_CLOSED.has(status.lastKeyStatus);
      const held = status.unlocked && !triedHeldKey;
      if (!opened && !held) return false;
      if (status.unlocked) triedHeldKey = true;
      await io.resume();
      return true;
    } catch {
      return false;
    } finally {
      busy = false;
    }
  };
}

type LockedSyncStore = {
  getState(): { enabled: boolean; status: string };
  subscribe(listener: (state: { enabled: boolean; status: string }) => void): () => void;
};
type IntervalClock = { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
const intervals: IntervalClock = {
  set: (run, ms) => setInterval(run, ms),
  clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export function watchLockedSync(store: LockedSyncStore, tick: () => void, ms: number, clock: IntervalClock = intervals): () => void {
  let timer: unknown = null;
  const follow = (state: { enabled: boolean; status: string }) => {
    const locked = state.enabled && state.status === "locked";
    if (locked && timer === null) timer = clock.set(tick, ms);
    if (!locked && timer !== null) {
      clock.clear(timer);
      timer = null;
    }
  };
  const unsubscribe = store.subscribe(follow);
  follow(store.getState());
  return () => {
    unsubscribe();
    if (timer !== null) clock.clear(timer);
    timer = null;
  };
}

export function presentSyncState<S extends { status: string; error: string | null }>(state: S, status: SyncKeyStoreStatus | null): S {
  if (state.status !== "locked") return state;
  const message = keyringMessage(status, false);
  return message ? { ...state, error: message } : state;
}

export const HELD_LOGINS_DOCUMENT = "sync-held-logins.nns";
export const SYNC_DOCUMENTS = ["sync.json", "sync-state.nns", "sync-journal.nns", HELD_LOGINS_DOCUMENT] as const;

export type SealedLoginEntry = { origin: string; username: string; sealed: string; created: number };
export type HeldLogin = { origin: string; username: string; sealed: string; replaced: string | null };
type HeldByProfile = Record<string, Record<string, HeldLogin>>;

export type HeldLoginsIo = {
  read(name: string): string | null;
  save(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
  seal(text: string): Promise<string | null | undefined>;
  open(sealed: string): Promise<string | null | undefined>;
};

export const HELD_LOGINS_LIMIT = 1000;
export const HELD_LOGINS_MAX_BYTES = 4 * 1024 * 1024;

const loginKey = (origin: string, username: string) => `${origin}\n${username}`;
const isText = (value: unknown): value is string => typeof value === "string";
const heldCount = (held: HeldByProfile) => Object.values(held).reduce((sum, logins) => sum + Object.keys(logins).length, 0);

function parseHeld(text: string): HeldByProfile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const held: HeldByProfile = {};
  for (const [profile, logins] of Object.entries(parsed)) {
    if (!logins || typeof logins !== "object" || Array.isArray(logins)) return null;
    held[profile] = {};
    for (const login of Object.values(logins)) {
      const { origin, username, sealed, replaced } = (login ?? {}) as Partial<HeldLogin>;
      if (!isText(origin) || !isText(username) || !isText(sealed) || !(replaced === null || isText(replaced))) return null;
      held[profile][loginKey(origin, username)] = { origin, username, sealed, replaced };
    }
  }
  return held;
}

export function createHeldLogins(io: HeldLoginsIo, limits: { maxLogins?: number; maxBytes?: number } = {}) {
  const maxLogins = limits.maxLogins ?? HELD_LOGINS_LIMIT;
  const maxBytes = limits.maxBytes ?? HELD_LOGINS_MAX_BYTES;
  let held: HeldByProfile | null = null;
  let suspended = 0;
  const refused = new Set<string>();
  const load = async (): Promise<HeldByProfile | null> => {
    if (held) return held;
    const stored = io.read(HELD_LOGINS_DOCUMENT);
    if (!stored) return (held = {});
    const text = await io.open(stored);
    held = isText(text) ? parseHeld(text) : null;
    return held;
  };
  const store = async (next: HeldByProfile) => {
    for (const profile of Object.keys(next)) if (!Object.keys(next[profile]!).length) delete next[profile];
    if (!Object.keys(next).length) {
      await io.remove(HELD_LOGINS_DOCUMENT);
    } else {
      const sealed = await io.seal(JSON.stringify(next));
      if (!sealed) throw new Error("Couldn’t seal the logins sync is holding");
      await io.save(HELD_LOGINS_DOCUMENT, sealed);
    }
    held = next;
  };
  const refusal = (profile: string, origin: string, username: string) => `${profile}\n${loginKey(origin, username)}`;
  const release = async (profile: string, origin: string, username: string) => {
    refused.delete(refusal(profile, origin, username));
    const current = await load();
    if (!current?.[profile]?.[loginKey(origin, username)]) return false;
    const next = structuredClone(current);
    delete next[profile]![loginKey(origin, username)];
    await store(next);
    return true;
  };
  return {
    async merge(profile: string, list: SealedLoginEntry[] | null | undefined): Promise<SealedLoginEntry[] | null> {
      if (!list || suspended) return null;
      const current = await load();
      if (!current) return null;
      const mine = current[profile] ?? {};
      const local = new Map(list.map((login) => [loginKey(login.origin, login.username), login]));
      const edited = Object.entries(mine).filter(([key, login]) => local.has(key) && local.get(key)!.sealed !== login.replaced);
      if (edited.length) {
        const next = structuredClone(current);
        for (const [key] of edited) delete next[profile]![key];
        await store(next);
      }
      const shown = Object.entries(held?.[profile] ?? {});
      const hidden = new Set(shown.map(([key]) => key));
      return [
        ...list.filter((login) => !hidden.has(loginKey(login.origin, login.username))),
        ...shown.map(([, login]) => ({ origin: login.origin, username: login.username, sealed: login.sealed, created: 0 })),
      ];
    },
    async hold(profile: string, login: HeldLogin): Promise<boolean> {
      if (suspended) return false;
      const current = await load();
      if (!current) return false;
      const next = structuredClone(current);
      next[profile] = { ...next[profile], [loginKey(login.origin, login.username)]: { ...login } };
      if (heldCount(next) > maxLogins || JSON.stringify(next).length > maxBytes) {
        refused.add(refusal(profile, login.origin, login.username));
        return false;
      }
      try {
        await store(next);
      } catch {
        return false;
      }
      refused.delete(refusal(profile, login.origin, login.username));
      return true;
    },
    release,
    async holds(profile: string, origin: string, username: string) {
      return !!(await load())?.[profile]?.[loginKey(origin, username)];
    },
    async dropProfiles(profiles: string[]) {
      if (!profiles.length) return;
      const gone = new Set(profiles);
      for (const key of [...refused]) if (gone.has(key.slice(0, key.indexOf("\n")))) refused.delete(key);
      const current = await load();
      if (!current || !Object.keys(current).some((profile) => gone.has(profile))) return;
      const next = structuredClone(current);
      for (const profile of gone) delete next[profile];
      await store(next);
    },
    async clear() {
      await io.remove(HELD_LOGINS_DOCUMENT);
      held = {};
    },
    suspend() {
      suspended++;
    },
    resume() {
      suspended = Math.max(0, suspended - 1);
    },
    status() {
      return { held: held ? heldCount(held) : 0, refused: refused.size };
    },
  };
}

export type HeldLogins = ReturnType<typeof createHeldLogins>;
let heldLogins: HeldLogins | null = null;

export function configureHeldLogins(store: HeldLogins | null) {
  heldLogins = store;
}

export const heldLoginsStatus = () => heldLogins?.status() ?? null;

export async function releaseHeldLogin(profile: string, origin: unknown, username: unknown): Promise<boolean> {
  return !!heldLogins && isText(origin) && isText(username) && (await heldLogins.release(profile, origin, username));
}

export async function releaseHeldLoginIfGone(host: ArdiaHost, profile: string, origin: unknown, username: unknown): Promise<boolean> {
  const store = heldLogins;
  if (!store || !isText(origin) || !isText(username) || !(await store.holds(profile, origin, username))) return false;
  const native = (await invoke(host, "readPasswords")(hostProfile(profile, host))) as SealedLoginEntry[] | null;
  if (!native || native.some((login) => login.origin === origin && login.username === username)) return false;
  return store.release(profile, origin, username);
}

export class HeldLoginsResetError extends Error {
  constructor() {
    super("Ardia couldn’t reset the passwords sync was holding, so it undid the change. Try again.");
  }
}

export const enterPhraseBegins = (ui: { enabled: boolean; status: string }) => !(ui.enabled && ui.status === "locked");

export async function whileResettingHeldLogins<T>(run: () => Promise<T>, began: (result: T) => boolean, rollback?: () => Promise<unknown>): Promise<T> {
  const store = heldLogins;
  store?.suspend();
  try {
    const result = await run();
    if (began(result)) {
      try {
        await store?.clear();
      } catch {
        await rollback?.().catch(() => {});
        throw new HeldLoginsResetError();
      }
    }
    return result;
  } finally {
    store?.resume();
  }
}

export const MAX_JOURNAL_PARTS = 1000;
export const journalPartName = (n: number) => `sync-journal-${n}.nns`;

export async function refreshSyncDocuments(io: {
  refresh(name: string): Promise<boolean>;
  remove(name: string): Promise<void>;
  maxParts?: number;
  batch?: number;
}): Promise<{ parts: number; removed: string[] }> {
  const maxParts = io.maxParts ?? MAX_JOURNAL_PARTS;
  const batch = io.batch ?? 50;
  for (const name of SYNC_DOCUMENTS) await io.refresh(name);
  const present: boolean[] = [];
  for (let start = 1; start <= maxParts; start += batch) {
    const numbers = Array.from({ length: Math.min(batch, maxParts - start + 1) }, (_, i) => start + i);
    present.push(...(await Promise.all(numbers.map((n) => io.refresh(journalPartName(n))))));
  }
  const gap = present.indexOf(false);
  const parts = gap === -1 ? present.length : gap;
  const removed: string[] = [];
  for (let n = parts + 2; n <= present.length; n++) {
    if (!present[n - 1]) continue;
    await io.remove(journalPartName(n));
    removed.push(journalPartName(n));
  }
  return { parts, removed };
}

export const syncKeyStoreStatus = (host: ArdiaHost) => invokeHost<SyncKeyStoreStatus>("ArdiaSync.status", { args: [] }, host);
export const claimSyncAuthority = (host: ArdiaHost) => invokeHost<AuthorityClaim>("ArdiaSync.claimAuthority", { args: [] }, host);
export const releaseSyncAuthority = (host: ArdiaHost) => invokeHost<void>("ArdiaSync.releaseAuthority", { args: [] }, host);

const invoke = (host: ArdiaHost, method: string) => (...args: unknown[]) =>
  invokeHost(`ArdiaSync.${method}`, { args: args.map((arg) => (arg === undefined ? null : arg)) }, host);

export function syncModuleMethod(host: ArdiaHost, name: string, method: string): unknown {
  if (name !== "ArdiaSync") return undefined;
  if (method === "newDeviceId") return () => newSyncDeviceId();
  if (method === "deviceName") return syncDeviceName;
  if (method === "chooseFolder") {
    return (current: string | null) => {
      const preset = chosenFolder;
      if (preset) {
        chosenFolder = null;
        return Promise.resolve(preset.path);
      }
      return invoke(host, method)(current ?? null);
    };
  }
  if (method === "readPasswords") {
    return async (profile: string) => {
      const store = heldLogins;
      if (!store) return null;
      const list = (await invoke(host, method)(hostProfile(profile, host))) as SealedLoginEntry[] | null;
      return store.merge(profile, list);
    };
  }
  if (method === "savePassword") {
    return async (profile: string, origin: string, username: string, sealed: string, replacing: boolean) => {
      const store = heldLogins;
      const owner = hostProfile(profile, host);
      const saved = await invoke(host, method)(owner, origin, username, sealed, replacing);
      if (saved === "skipped") {
        if (!store) return false;
        const local = (await invoke(host, "readPasswords")(owner)) as SealedLoginEntry[] | null;
        if (!local) return false;
        const replaced = local.find((login) => login.origin === origin && login.username === username)?.sealed ?? null;
        return store.hold(profile, { origin, username, sealed, replaced });
      }
      if (saved === true) await store?.release(profile, origin, username);
      return saved === true;
    };
  }
  if (SYNC_METHODS.has(`ArdiaSync.${method}`)) return invoke(host, method);
  return undefined;
}
