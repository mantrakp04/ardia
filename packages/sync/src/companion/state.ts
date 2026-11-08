import { Clock } from "../hlc.ts";
import { restoreJournal } from "../scope.ts";
import { emptyScope, type LogFile, type ScopeState } from "../scopeState.ts";
import type { Ack, BookmarkOp, PendingSend } from "./adapters.ts";

export type Host = {
  chainStatus(): string;
  read(scope: string, knownJSON: string): string;
  write(scope: string, payload: string): string;
  remove(scope: string, idsJSON: string): string;
  persistJournal(scope: string, batchesJSON: string): string;
  saveState(stateJSON: string, seqsJSON: string): string;
};

export type CompanionState = {
  v: 1;
  device: string;
  clock: string | null;
  scopes: Record<string, ScopeState>;
  sends: PendingSend[];
  acks: Ack[];
  bookmarks: BookmarkOp[];
  floors: Record<string, Record<string, number>>;
  pulled: Record<string, true>;
  visited?: Record<string, Record<string, number>>;
  due?: Record<string, Record<string, true>>;
  removals?: Record<string, string[]>;
  ghosts?: { id: string; since: number }[];
  sent?: Record<string, number>;
};

let companion: CompanionState | null = null;
let savedJSON = "";
let savedPrint = "";
let viewJSON = "";

export const host = (): Host => {
  const h = (globalThis as { __host?: Host }).__host;
  if (!h) throw new Error("the sync host isn't registered");
  return h;
};

export function loaded(): CompanionState {
  if (!companion) throw new Error("the companion isn't loaded");
  return companion;
}

const freshState = (device: string): CompanionState => ({ v: 1, device, clock: null, scopes: {}, sends: [], acks: [], bookmarks: [], floors: {}, pulled: {} });

export function companionLoad(input: { device: string; state?: CompanionState | null; journal?: Record<string, LogFile[]> | null; fresh?: boolean; ghosts?: string[] }) {
  if (!input.state && !input.fresh) throw new Error("no saved state for this device");
  if (input.state && (input.state.v !== 1 || input.state.device !== input.device || !input.state.scopes || typeof input.state.scopes !== "object")) {
    throw new Error("the saved state belongs to another device or version");
  }
  const state = input.state ?? freshState(input.device);
  state.sends ??= [];
  state.acks ??= [];
  state.bookmarks ??= [];
  state.floors ??= {};
  state.pulled ??= {};
  state.scopes ??= {};
  state.visited ??= {};
  state.due ??= {};
  state.removals ??= {};
  state.ghosts ??= [];
  state.sent ??= {};
  for (const id of input.ghosts ?? []) if (id !== input.device && !state.ghosts.some((g) => g.id === id)) state.ghosts.push({ id, since: Date.now() });
  const clock = new Clock(input.device, state.clock);
  let restored = false;
  for (const [scope, batches] of Object.entries(input.journal ?? {})) {
    const mine = (Array.isArray(batches) ? batches : []).filter((f) => f && f.device === input.device);
    if (!mine.length) continue;
    restoreJournal((state.scopes[scope] ??= emptyScope()), mine, clock, 0);
    restored = true;
  }
  if (restored) state.clock = clock.last;
  companion = state;
  savedJSON = "";
  savedPrint = "";
  viewJSON = "";
  return { device: state.device, scopes: Object.keys(state.scopes).length };
}

export function companionUnload() {
  companion = null;
  savedJSON = "";
  savedPrint = "";
  viewJSON = "";
  return true;
}

export function companionStateUnsaved() {
  savedJSON = "";
  savedPrint = "";
  return true;
}

function fingerprint(c: CompanionState): string {
  const scopes = Object.keys(c.scopes)
    .sort()
    .map((name) => {
      const s = c.scopes[name]!;
      return [name, s.seq, s.journal?.length ?? 0, s.outbox.length, Object.keys(s.files).length, s.pending, Object.keys(s.damaged).length, s.unapplied.length, s.joined, JSON.stringify(s.vv), JSON.stringify(s.extra), JSON.stringify(s.seen)].join("|");
    });
  return JSON.stringify([c.clock, scopes, c.sends, c.acks, c.bookmarks, c.floors, c.pulled, c.visited, c.due, c.removals, c.ghosts, c.sent]);
}

export function save(force = false): boolean {
  const c = loaded();
  const print = fingerprint(c);
  if (!force && savedJSON && print === savedPrint) return true;
  const json = JSON.stringify(c);
  if (json === savedJSON) {
    savedPrint = print;
    return true;
  }
  const seqs = Object.fromEntries(Object.entries(c.scopes).map(([scope, s]) => [scope, s.seq]));
  if (host().saveState(json, JSON.stringify(seqs)) !== "ok") return false;
  savedJSON = json;
  savedPrint = print;
  return true;
}

export function viewIsNew(json: string): boolean {
  if (json === viewJSON) return false;
  viewJSON = json;
  return true;
}
