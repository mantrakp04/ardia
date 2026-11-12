import type { SharedFolderOp } from "../../platform/sharedFolders";
import { newLinkId, weblocText } from "../../lib/webloc";
import { MANIFEST, manifestText, nameOfFile, uniqueFileName, type BaseEntry, type Dropped, type TargetEntry, type TargetLevel } from "./tree";
import { weave } from "./merge";

export type Planned = { ops: SharedFolderOp[]; base: BaseEntry[] };

type Pass = { identityOnly: boolean; needsIdentity: boolean; ids: Map<string, string>; seen: Set<string> };

export function planFiles(level: TargetLevel, base: BaseEntry[] = []): Planned {
  const full: Pass = { identityOnly: false, needsIdentity: false, ids: new Map(), seen: new Set() };
  const ops: SharedFolderOp[] = [];
  const next = planLevel("", level, ops, full);
  if (!full.needsIdentity) return { ops, base: next };
  const first: Pass = { identityOnly: true, needsIdentity: false, ids: new Map(), seen: new Set() };
  const identityOps: SharedFolderOp[] = [];
  planLevel("", level, identityOps, first);
  return { ops: identityOps, base: withIds(base, first.ids) };
}

const withIds = (base: BaseEntry[], ids: Map<string, string>): BaseEntry[] =>
  base.map((b) => (b.kind === "dir" ? { ...b, children: withIds(b.children, ids) } : ids.has(b.key) ? { ...b, id: ids.get(b.key)! } : b));

function dropOps(prefix: string, d: Dropped, ops: SharedFolderOp[]) {
  if (d.kind === "link") return void ops.push({ op: "delete", path: `${prefix}${d.file}`, expect: d.url });
  const inside = `${prefix}${d.file}/`;
  for (const k of d.known) dropOps(inside, k.kind === "link" ? { kind: "link", file: k.file, url: k.url } : { kind: "dir", file: k.file, known: k.children }, ops);
  ops.push({ op: "rmdir", path: `${prefix}${d.file}` });
}

type Move = { from: string; to: string; kind: "link" | "dir" };

function moveOps(prefix: string, moves: Move[], reserved: Set<string>, ops: SharedFolderOp[]) {
  const sources = new Set(moves.map((m) => m.from.toLowerCase()));
  const tangled = moves.some((m) => sources.has(m.to.toLowerCase()));
  if (!tangled) {
    for (const m of moves) ops.push({ op: "move", path: `${prefix}${m.from}`, to: `${prefix}${m.to}` });
    return;
  }
  const taken = new Set([...reserved, ...sources, ...moves.map((m) => m.to.toLowerCase())]);
  const parked = moves.map((m) => ({ ...m, via: uniqueFileName(`${nameOfFile(m.from, m.kind)} (moving)`, m.kind, taken) }));
  for (const m of parked) ops.push({ op: "move", path: `${prefix}${m.from}`, to: `${prefix}${m.via}` });
  for (const m of parked) ops.push({ op: "move", path: `${prefix}${m.via}`, to: `${prefix}${m.to}` });
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function planLevel(prefix: string, level: TargetLevel, ops: SharedFolderOp[], pass: Pass): BaseEntry[] {
  const entries = level.entries.filter((e) => e.key !== null);
  if (!pass.identityOnly) for (const d of level.dropped) dropOps(prefix, d, ops);
  const referenced = new Set(entries.map((e) => e.file).filter((f): f is string => !!f));
  const droppedFiles = new Set(level.dropped.map((d) => d.file));
  const kept = (level.remote?.entries ?? []).map((r) => r.file).filter((f) => !referenced.has(f) && !droppedFiles.has(f));
  const taken = new Set(kept.map((f) => f.toLowerCase()));
  const finals = new Map<TargetEntry, string>();
  const held = (e: TargetEntry) => e.kind === "link" && e.heldName !== null;
  for (const e of entries) if (e.file && (!e.renamed || held(e))) (finals.set(e, e.file), taken.add(e.file.toLowerCase()));
  for (const e of entries) if (!finals.has(e)) finals.set(e, uniqueFileName(e.name, e.kind, taken));
  const ids = new Map<TargetEntry, string | null>();
  const { seen } = pass;
  for (const e of entries) {
    if (e.kind !== "link") continue;
    if (held(e)) {
      if (e.id) seen.add(e.id);
      ids.set(e, e.id);
      continue;
    }
    const moving = !!e.file && finals.get(e) !== e.file;
    if (moving && !e.fileId) pass.needsIdentity = true;
    let id = e.id && !seen.has(e.id) ? e.id : null;
    if (!id && (e.write || !e.file || moving || e.fileId || pass.identityOnly)) id = newLinkId();
    if (id) seen.add(id);
    ids.set(e, id);
    if (id && pass.identityOnly) pass.ids.set(e.key!, id);
  }
  for (const e of entries) {
    if (e.kind !== "link" || !e.file || held(e) || (!e.write && (ids.get(e) ?? null) === (e.fileId ?? null))) continue;
    ops.push({ op: "write", path: `${prefix}${e.file}`, text: weblocText(e.url, ids.get(e) ?? null), create: false, expect: e.expect });
  }
  if (pass.identityOnly) {
    for (const e of entries) if (e.kind === "dir" && e.file) planLevel(`${prefix}${e.file}/`, e.level, ops, pass);
    return [];
  }
  const moves = entries.filter((e) => e.file && finals.get(e) !== e.file).map((e) => ({ from: e.file!, to: finals.get(e)!, kind: e.kind }));
  moveOps(prefix, moves, taken, ops);

  const base: BaseEntry[] = [];
  for (const e of entries) {
    const file = finals.get(e)!;
    if (e.kind === "link") {
      if (!e.file) ops.push({ op: "write", path: `${prefix}${file}`, text: weblocText(e.url, ids.get(e) ?? null), create: true, expect: null });
      base.push({ kind: "link", key: e.key!, file, name: e.heldName ?? e.name, url: held(e) ? (e.expect ?? e.url) : e.url, id: ids.get(e) ?? null });
    } else {
      if (!e.file) ops.push({ op: "mkdir", path: `${prefix}${file}` });
      base.push({ kind: "dir", key: e.key!, file, name: e.name, children: planLevel(`${prefix}${file}/`, e.level, ops, pass) });
    }
  }

  const current = level.remote?.manifest ?? null;
  const placed = entries.map((e) => finals.get(e)!);
  const known = new Set([...kept, ...placed]);
  const order = weave(
    placed,
    (current ?? []).filter((f) => known.has(f)),
  );
  if (!level.remote?.manifestPending && (order.length || current) && !sameList(order, current ?? [])) {
    ops.push({ op: "write", path: `${prefix}${MANIFEST}`, text: manifestText(order), create: false, expect: null });
  }
  return base;
}
