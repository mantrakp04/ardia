import { canonical } from "./canon.ts";
import { hlcWall, type Clock } from "./hlc.ts";
import type { Adapter, LogFile, Origin, ScopeOptions, ScopeState, SnapshotFile, SyncFile, SyncRecord, Transport } from "./scopeState.ts";

const DEFAULTS: Required<Omit<ScopeOptions, "persist">> = {
  expired: () => false,
  tombstoneTTL: 45 * 86_400_000,
  compactAfterFiles: 40,
  compactInterval: 10 * 60_000,
  pruneGrace: 60 * 60_000,
  damagedGiveUp: 86_400_000,
};

export const covered = (vv: Record<string, number>, [device, seq]: Origin) => (vv[device] ?? 0) >= seq;

function markApplied(state: ScopeState, device: string, seq: number) {
  if (covered(state.vv, [device, seq])) return;
  const extra = new Set(state.extra[device] ?? []);
  extra.add(seq);
  let top = state.vv[device] ?? 0;
  while (extra.delete(top + 1)) top++;
  state.vv[device] = top;
  if (extra.size) state.extra[device] = [...extra].sort((a, b) => a - b);
  else delete state.extra[device];
}

const isApplied = (state: ScopeState, [device, seq]: Origin) =>
  covered(state.vv, [device, seq]) || (state.extra[device]?.includes(seq) ?? false);

function see(state: ScopeState, device: string, at: number) {
  if (!(device in state.seen) || at > state.seen[device]!) state.seen[device] = at;
}

function mergeRecord(state: ScopeState, key: string, record: SyncRecord, clock: Clock): boolean {
  clock.observe(record.h);
  const current = state.records[key];
  if (current && current.h >= record.h) return false;
  state.records[key] = record;
  return true;
}

function ingestLog(state: ScopeState, file: LogFile, clock: Clock, changed: Set<string>) {
  see(state, file.device, file.at);
  if (isApplied(state, [file.device, file.seq])) return;
  for (const op of file.ops) {
    if (mergeRecord(state, op.k, { h: op.h, v: op.v, o: [file.device, file.seq] }, clock)) changed.add(op.k);
  }
  markApplied(state, file.device, file.seq);
}

export function ingestSnapshot(state: ScopeState, file: SnapshotFile, clock: Clock, changed: Set<string>) {
  for (const [device, at] of Object.entries(file.seen)) see(state, device, at);
  see(state, file.device, file.at);
  for (const [key, record] of Object.entries(file.records)) {
    if (!(key in state.records) && isApplied(state, record.o)) continue;
    if (mergeRecord(state, key, record, clock)) changed.add(key);
  }
  for (const [key, record] of Object.entries(state.records)) {
    if (!(key in file.records) && covered(file.vv, record.o)) {
      delete state.records[key];
      changed.add(key);
    }
  }
  for (const [device, seq] of Object.entries(file.vv)) {
    if (seq > (state.vv[device] ?? 0)) {
      state.vv[device] = seq;
      const extra = (state.extra[device] ?? []).filter((s) => s > seq);
      for (let top = seq; extra[0] === top + 1; top++) state.vv[device] = extra.shift()!;
      if (extra.length) state.extra[device] = extra;
      else delete state.extra[device];
    }
  }
}

export function visible(state: ScopeState, prefix: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, record] of Object.entries(state.records)) {
    if (record.v !== null && key.startsWith(prefix)) out.set(key, record.v);
  }
  return out;
}

const parseBase = (json: string | undefined) => (json === undefined ? undefined : (JSON.parse(json) as unknown));

const settling = new WeakMap<ScopeState, (() => void)[]>();
const waitingAfterPull = new WeakMap<ScopeState, boolean>();

function settleWhenDurable(state: ScopeState, settle: () => void) {
  const queue = settling.get(state);
  if (queue) queue.push(settle);
  else settling.set(state, [settle]);
}

function settleDurable(state: ScopeState) {
  const queue = settling.get(state);
  if (!queue) return;
  settling.delete(state);
  for (const settle of queue) settle();
}

async function publishAdapter(state: ScopeState, adapter: Adapter, clock: Clock, device: string, now: number): Promise<Set<string>> {
  const published = new Set<string>();
  if (adapter.adoptRemoteOnJoin && !state.joined) return published;
  if (adapter.publishAfterPull && waitingAfterPull.get(state) !== false) return published;
  let pending: Set<string> | null = null;
  const queued = (key: string) => (pending ??= new Set([...state.outbox, ...(state.journal ?? []).flatMap((f) => f.ops)].map((op) => op.k))).has(key);
  const extraction = await adapter.extract((key) => parseBase(state.base[key]), queued, now, (key) => key in state.records, (key) => state.records[key]?.v, (key) => state.records[key]?.h);
  if (!extraction) return published;
  const put = (key: string, value: unknown) => {
    const known = state.records[key];
    const editedAt = !known && value !== null ? adapter.editedAt?.(value) : undefined;
    const h = editedAt !== undefined ? clock.at(editedAt) : clock.tick();
    if (known && known.h >= h) return;
    state.records[key] = { h, v: value, o: [device, state.seq + 1] };
    state.outbox.push({ k: key, h, v: value });
    published.add(key);
  };
  for (const [key, value] of extraction.values) {
    if (value === null || value === undefined) throw new Error(`[sync] ${key}: a live value can't be null`);
    const json = canonical(value);
    if (state.base[key] === json && !extraction.republish?.(key)) continue;
    state.base[key] = json;
    put(key, value);
  }
  for (const key of Object.keys(state.base)) {
    if (!key.startsWith(adapter.prefix) || extraction.values.has(key) || extraction.ignore?.(key)) continue;
    delete state.base[key];
    put(key, null);
  }
  const { published: settle } = extraction;
  if (settle && published.size) settleWhenDurable(state, () => settle(published));
  return published;
}

export async function publish(state: ScopeState, adapters: Adapter[], clock: Clock, device: string, now = Date.now()): Promise<Set<string>> {
  const published = new Set<string>();
  for (const adapter of adapters) for (const key of await publishAdapter(state, adapter, clock, device, now)) published.add(key);
  return published;
}

export async function flush(state: ScopeState, transport: Transport, scope: string, device: string, now: number, options: ScopeOptions = {}) {
  if (state.outbox.length) {
    state.seq++;
    (state.journal ??= []).push({ v: 1, kind: "log", device, seq: state.seq, at: now, ops: state.outbox });
    state.outbox = [];
  }
  if (!state.journal?.length) return;
  if (options.persist) {
    await options.persist(state.journal);
    settleDurable(state);
  }
  while (state.journal.length) {
    const file = state.journal[0]!;
    const id = await transport.write(scope, JSON.stringify(file));
    state.files[id] = { d: file.device, k: "log", s: file.seq, at: file.at };
    state.journal.shift();
    markApplied(state, file.device, file.seq);
    see(state, file.device, now);
  }
  delete state.journal;
  settleDurable(state);
}

export function restoreJournal(state: ScopeState, batches: LogFile[], clock: Clock, written = 0) {
  const saved = state.seq;
  for (const file of [...batches].sort((a, b) => a.seq - b.seq)) {
    if (file.seq <= state.seq) continue;
    if (file.seq === saved + 1) state.outbox = [];
    for (const op of file.ops) {
      mergeRecord(state, op.k, { h: op.h, v: op.v, o: [file.device, file.seq] }, clock);
      if (op.v === null) delete state.base[op.k];
      else state.base[op.k] = canonical(op.v);
    }
    state.seq = file.seq;
    if (file.seq <= written) markApplied(state, file.device, file.seq);
    else (state.journal ??= []).push(file);
  }
  state.seq = Math.max(state.seq, written);
}

export const writtenSeq = (state: ScopeState) => state.seq - (state.journal?.length ?? 0);

export async function pull(state: ScopeState, transport: Transport, scope: string, clock: Clock, now: number, options: ScopeOptions = {}) {
  const { damagedGiveUp } = { ...DEFAULTS, ...options };
  const listing = await transport.read(scope, Object.keys(state.files));
  const changed = new Set<string>();
  const parsed: { id: string; file: SyncFile }[] = [];
  const bad = (id: string) => {
    state.damaged[id] = Math.min(state.damaged[id] ?? now, now);
    if (now - state.damaged[id]! > damagedGiveUp) {
      state.files[id] = { d: "", k: "bad", at: now };
      delete state.damaged[id];
    }
  };
  for (const { id, payload } of listing.files) {
    try {
      const file = JSON.parse(payload) as SyncFile;
      if (file.v !== 1 || (file.kind !== "log" && file.kind !== "snapshot")) throw new Error("unknown file");
      parsed.push({ id, file });
    } catch {
      bad(id);
    }
  }
  for (const { id } of listing.damaged) bad(id);
  parsed.sort((a, b) => (a.file.kind === b.file.kind ? 0 : a.file.kind === "snapshot" ? -1 : 1));
  for (const { id, file } of parsed) {
    if (file.kind === "snapshot") {
      ingestSnapshot(state, file, clock, changed);
      state.files[id] = { d: file.device, k: "snapshot", vv: file.vv, at: file.at };
    } else {
      ingestLog(state, file, clock, changed);
      state.files[id] = { d: file.device, k: "log", s: file.seq, at: file.at };
    }
    delete state.damaged[id];
  }
  const present = new Set(listing.present);
  for (const id of Object.keys(state.files)) if (!present.has(id)) delete state.files[id];
  for (const id of Object.keys(state.damaged)) if (!present.has(id)) delete state.damaged[id];
  state.pending = listing.pending.length;
  const pendingSince: Record<string, number> = {};
  for (const id of listing.pending) pendingSince[id] = Math.min(state.pendingSince?.[id] ?? now, now);
  if (listing.pending.length) state.pendingSince = pendingSince;
  else delete state.pendingSince;
  const downloading = Object.values(pendingSince).some((at) => now - at <= damagedGiveUp);
  waitingAfterPull.set(state, downloading || Object.keys(state.damaged).length > 0);
  return changed;
}

async function applyAdapter(state: ScopeState, adapter: Adapter, keys: Set<string>, now: number, horizon: number): Promise<boolean> {
  const mine = new Set([...keys].filter((k) => k.startsWith(adapter.prefix)));
  if (!mine.size) return true;
  const view = visible(state, adapter.prefix);
  const applyAs = (state.applyAs ??= {});
  applyAs[adapter.prefix] ??= state.joined ? "joined" : "joining";
  let ok: boolean | void = false;
  try {
    ok = await adapter.apply(view, mine, (key) => parseBase(state.base[key]), { known: (key) => key in state.records, now, horizon, joined: applyAs[adapter.prefix] === "joined" });
  } catch (error) {
    console.warn(`[sync] applying ${adapter.prefix} failed`, error);
  }
  if (ok === false) return false;
  applyAs[adapter.prefix] = "joined";
  for (const key of mine) {
    if (view.has(key)) state.base[key] = canonical(view.get(key));
    else delete state.base[key];
  }
  return true;
}

export async function compact(state: ScopeState, transport: Transport, scope: string, device: string, now: number, options: ScopeOptions = {}, force = false) {
  const o = { ...DEFAULTS, ...options };
  const count = Object.keys(state.files).length;
  const newestSnapshot = Math.max(state.snapshotAt, ...Object.values(state.files).filter((f) => f.k === "snapshot").map((f) => f.at));
  if (!force && (count <= o.compactAfterFiles || now - newestSnapshot < o.compactInterval)) return false;
  await flush(state, transport, scope, device, now, options);
  const records: Record<string, SyncRecord> = {};
  const tombstoneTTL = Object.keys(state.extra).length ? 2 * o.tombstoneTTL : o.tombstoneTTL;
  for (const [key, record] of Object.entries(state.records)) {
    const drop = record.v === null ? now - hlcWall(record.h) > tombstoneTTL : o.expired(key, record.v, now);
    if (drop) delete state.records[key];
    else records[key] = record;
  }
  const vv = { ...state.vv };
  const file: SnapshotFile = { v: 1, kind: "snapshot", device, at: now, vv, seen: { ...state.seen }, records };
  const id = await transport.write(scope, JSON.stringify(file));
  state.files[id] = { d: device, k: "snapshot", vv, at: now };
  state.snapshotAt = now;
  const dominated = (other: Record<string, number>) => Object.entries(other).every(([d, s]) => (vv[d] ?? 0) >= s);
  const prune = Object.entries(state.files)
    .filter(([fileId, f]) => {
      if (fileId === id || now - f.at < o.pruneGrace) return false;
      if (f.k === "log") return covered(vv, [f.d, f.s ?? Infinity]);
      if (f.k === "snapshot") return dominated(f.vv ?? {});
      return false;
    })
    .map(([fileId]) => fileId);
  if (prune.length) {
    await transport.remove(scope, prune);
    for (const fileId of prune) delete state.files[fileId];
  }
  return true;
}

export type CycleResult = { published: number; changed: number; pending: number; compacted: boolean };

export async function syncScope(args: {
  scope: string;
  state: ScopeState;
  transport: Transport;
  adapters: Adapter[];
  clock: Clock;
  device: string;
  now?: () => number;
  options?: ScopeOptions;
}): Promise<CycleResult> {
  const { scope, state, transport, adapters, clock, device, options } = args;
  const now = args.now ?? Date.now;
  let published = (await publish(state, adapters, clock, device, now())).size;
  await flush(state, transport, scope, device, now(), options);
  const changed = await pull(state, transport, scope, clock, now(), options);
  const keys = new Set([...state.unapplied, ...changed]);
  const unapplied: string[] = [];
  for (const adapter of adapters) {
    const late = await publishAdapter(state, adapter, clock, device, now());
    published += late.size;
    for (const key of late) keys.delete(key);
    if (!(await applyAdapter(state, adapter, keys, now(), 2 * (options?.tombstoneTTL ?? DEFAULTS.tombstoneTTL)))) unapplied.push(...[...keys].filter((k) => k.startsWith(adapter.prefix)));
  }
  state.unapplied = [...unapplied, ...[...keys].filter((k) => !adapters.some((a) => k.startsWith(a.prefix)))];
  if (!state.awaitRemote || Object.keys(state.seen).some((d) => d !== device)) {
    state.joined = true;
    delete state.awaitRemote;
  }
  await flush(state, transport, scope, device, now(), options);
  const compacted = await compact(state, transport, scope, device, now(), options);
  return { published, changed: changed.size, pending: state.pending, compacted };
}
