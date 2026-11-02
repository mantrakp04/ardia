import { canonical } from "./canon.ts";
import { hlcWall, type Clock, type HLC } from "./hlc.ts";
import { holdsBack, noteFileHealth } from "./fileHealth.ts";
import type { Adapter, LogFile, Origin, ScopeOptions, ScopeState, SnapshotFile, SyncFile, SyncRecord, Transport } from "./scopeState.ts";

const DEFAULTS: Required<Omit<ScopeOptions, "persist" | "holdApply">> = {
  expired: () => false,
  tombstoneTTL: 45 * 86_400_000,
  compactAfterFiles: 40,
  compactInterval: 10 * 60_000,
  pruneGrace: 60 * 60_000,
  damagedGiveUp: 86_400_000,
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isMapOf = (v: unknown, item: (x: unknown) => boolean) => isObject(v) && Object.values(v).every(item);
const isOrigin = (v: unknown) => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && isCount(v[1]);
const isValue = (o: Record<string, unknown>) => Object.prototype.hasOwnProperty.call(o, "v") && o.v !== undefined;
const isOp = (v: unknown) => isObject(v) && typeof v.k === "string" && typeof v.h === "string" && isValue(v);
const isRecord = (v: unknown) => isObject(v) && typeof v.h === "string" && isOrigin(v.o) && isValue(v);

function parseSyncFile(payload: string): SyncFile | null {
  let file: unknown;
  try {
    file = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isObject(file) || file.v !== 1 || typeof file.device !== "string" || !isTime(file.at)) return null;
  if (file.kind === "log") return isCount(file.seq) && Array.isArray(file.ops) && file.ops.every(isOp) ? (file as LogFile) : null;
  if (file.kind === "snapshot") {
    return isMapOf(file.vv, isCount) && isMapOf(file.seen, isTime) && isMapOf(file.records, isRecord) ? (file as SnapshotFile) : null;
  }
  return null;
}

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

type Change = { key: string; value: unknown; json: string };
type Stamps = Map<string, { json: string; h: HLC }>;

async function changesOf(state: ScopeState, adapter: Adapter, now: number) {
  if (adapter.adoptRemoteOnJoin && !state.joined) return null;
  let pending: Set<string> | null = null;
  const queued = (key: string) => (pending ??= new Set([...state.outbox, ...(state.journal ?? []).flatMap((f) => f.ops)].map((op) => op.k))).has(key);
  const extraction = await adapter.extract((key) => parseBase(state.base[key]), queued, now, (key) => key in state.records, (key) => state.records[key]?.v, (key) => state.records[key]?.h);
  if (!extraction) return null;
  const changes: Change[] = [];
  for (const [key, value] of extraction.values) {
    if (value === null || value === undefined) throw new Error(`[sync] ${key}: a live value can't be null`);
    const json = canonical(value);
    if (state.base[key] === json && !extraction.republish?.(key)) continue;
    changes.push({ key, value, json });
  }
  for (const key of Object.keys(state.base)) {
    if (!key.startsWith(adapter.prefix) || extraction.values.has(key) || extraction.ignore?.(key)) continue;
    changes.push({ key, value: null, json: "null" });
  }
  return { changes, settle: extraction.published };
}

function stampOf(state: ScopeState, adapter: Adapter, clock: Clock, { key, value }: Change): HLC {
  const editedAt = !state.records[key] && value !== null ? adapter.editedAt?.(value) : undefined;
  return editedAt !== undefined ? clock.at(editedAt) : clock.tick();
}

async function candidateStamps(state: ScopeState, adapter: Adapter, clock: Clock, now: number): Promise<Stamps> {
  const found = await changesOf(state, adapter, now);
  return new Map((found?.changes ?? []).map((change) => [change.key, { json: change.json, h: stampOf(state, adapter, clock, change) }]));
}

async function publishAdapter(state: ScopeState, adapter: Adapter, clock: Clock, device: string, now: number, stamps?: Stamps): Promise<Set<string>> {
  const published = new Set<string>();
  const found = await changesOf(state, adapter, now);
  if (!found) return published;
  for (const change of found.changes) {
    const { key, value, json } = change;
    if (value === null) delete state.base[key];
    else state.base[key] = json;
    const candidate = stamps?.get(key);
    const h = candidate?.json === json ? candidate.h : stampOf(state, adapter, clock, change);
    const known = state.records[key];
    if (known && known.h >= h) continue;
    state.records[key] = { h, v: value, o: [device, state.seq + 1] };
    state.outbox.push({ k: key, h, v: value });
    published.add(key);
  }
  const { settle } = found;
  if (settle && published.size) settleWhenDurable(state, () => settle(published));
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
  const unreadable = listing.damaged.map(({ id }) => id);
  for (const { id, payload } of listing.files) {
    const file = parseSyncFile(payload);
    if (file) parsed.push({ id, file });
    else unreadable.push(id);
  }
  parsed.sort((a, b) => (a.file.kind === b.file.kind ? 0 : a.file.kind === "snapshot" ? -1 : 1));
  for (const { id, file } of parsed) {
    if (file.kind === "snapshot") {
      ingestSnapshot(state, file, clock, changed);
      state.files[id] = { d: file.device, k: "snapshot", vv: file.vv, at: file.at };
    } else {
      ingestLog(state, file, clock, changed);
      state.files[id] = { d: file.device, k: "log", s: file.seq, at: file.at };
    }
  }
  const present = new Set(listing.present);
  for (const id of Object.keys(state.files)) if (!present.has(id)) delete state.files[id];
  noteFileHealth(state, { read: parsed.map(({ id }) => id), unreadable, pending: listing.pending, present }, now, damagedGiveUp);
  return changed;
}

async function applyAdapter(state: ScopeState, adapter: Adapter, keys: Set<string>, now: number, horizon: number, held: () => boolean): Promise<boolean> {
  const mine = new Set([...keys].filter((k) => k.startsWith(adapter.prefix)));
  if (!mine.size) return true;
  const view = visible(state, adapter.prefix);
  const applyAs = (state.applyAs ??= {});
  applyAs[adapter.prefix] ??= state.joined ? "joined" : "joining";
  const settle = (key: string) => {
    if (view.has(key)) state.base[key] = canonical(view.get(key));
    else delete state.base[key];
  };
  const landed = new Set<string>();
  let ok: boolean | void = false;
  try {
    const records = { known: (key: string) => key in state.records, now, horizon, joined: applyAs[adapter.prefix] === "joined", held, landed: (key: string) => void landed.add(key) };
    ok = await adapter.apply(view, mine, (key) => parseBase(state.base[key]), records);
  } catch (error) {
    console.warn(`[sync] applying ${adapter.prefix} failed`, error);
  }
  if (ok === false || held()) {
    for (const key of landed) {
      if (!mine.has(key)) continue;
      settle(key);
      keys.delete(key);
    }
    return false;
  }
  applyAs[adapter.prefix] = "joined";
  for (const key of mine) settle(key);
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
  let published = 0;
  const stamps = new Map<Adapter, Stamps>();
  for (const adapter of adapters) {
    if (adapter.publishAfterPull) stamps.set(adapter, await candidateStamps(state, adapter, clock, now()));
    else published += (await publishAdapter(state, adapter, clock, device, now())).size;
  }
  await flush(state, transport, scope, device, now(), options);
  const changed = await pull(state, transport, scope, clock, now(), options);
  const held = holdsBack(state, now(), options?.damagedGiveUp ?? DEFAULTS.damagedGiveUp);
  const keys = new Set([...state.unapplied, ...changed]);
  const unapplied: string[] = [];
  let heldApply = false;
  const applyHeld = () => !!options?.holdApply?.();
  for (const adapter of adapters) {
    const late = adapter.publishAfterPull && held ? new Set<string>() : await publishAdapter(state, adapter, clock, device, now(), stamps.get(adapter));
    published += late.size;
    for (const key of late) keys.delete(key);
    heldApply ||= applyHeld();
    const applied = !heldApply && (await applyAdapter(state, adapter, keys, now(), 2 * (options?.tombstoneTTL ?? DEFAULTS.tombstoneTTL), applyHeld));
    heldApply ||= applyHeld();
    if (!applied) unapplied.push(...[...keys].filter((k) => k.startsWith(adapter.prefix)));
  }
  state.unapplied = [...unapplied, ...[...keys].filter((k) => !adapters.some((a) => k.startsWith(a.prefix)))];
  if (!heldApply && (!state.awaitRemote || Object.keys(state.seen).some((d) => d !== device))) {
    state.joined = true;
    delete state.awaitRemote;
  }
  await flush(state, transport, scope, device, now(), options);
  const compacted = await compact(state, transport, scope, device, now(), options);
  return { published, changed: changed.size, pending: state.pending, compacted };
}
