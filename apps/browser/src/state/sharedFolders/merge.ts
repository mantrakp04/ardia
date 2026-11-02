import {
  EMPTY_REMOTE,
  nameOfFile,
  remoteOrder,
  type BaseDir,
  type BaseEntry,
  type BaseLink,
  type Dropped,
  type LocalDir,
  type LocalEntry,
  type RemoteEntry,
  type RemoteLevel,
  type RemoteLink,
  type TargetEntry,
  type TargetLevel,
} from "./tree";
import { identities, preferred, type Identities } from "./identities";

export type Merged = { level: TargetLevel; waiting: number };

type Context = Identities & { waiting: number };

export function mergeFolder(base: BaseEntry[], local: LocalEntry[], remote: RemoteLevel): Merged {
  const ctx: Context = { ...identities(base, local, remote), waiting: 0 };
  const level = mergeLevel(base, local, remote, ctx);
  return { level, waiting: ctx.waiting };
}

const holdsArrival = (level: RemoteLevel, ctx: Context): boolean =>
  level.entries.some((r) => (r.kind === "link" ? ctx.arriving.has(r) : r.kind === "dir" && holdsArrival(r.level, ctx)));

const sameThing = (b: BaseEntry, r: RemoteEntry) =>
  b.kind === "link" ? r.kind === "link" && r.url === b.url : r.kind === "dir" && b.children.some((c) => r.level.entries.some((x) => x.file === c.file));

const twinOf = (l: LocalEntry, r: RemoteEntry) => (l.kind === "link" ? r.kind === "link" && r.url === l.url : r.kind === "dir" && r.file.toLowerCase() === l.name.toLowerCase());

function mergeLevel(base: BaseEntry[], local: LocalEntry[], remote: RemoteLevel, ctx: Context): TargetLevel {
  const localByKey = new Map(local.map((l) => [l.key, l]));
  const baseKeys = new Set(base.map((b) => b.key));
  const staying = base.filter((b) => b.kind !== "link" || !ctx.moved.has(b));
  const arrivals = remote.entries.filter((r): r is RemoteLink => r.kind === "link" && ctx.arriving.has(r));
  const open = remote.entries.filter((r) => !(r.kind === "link" && ctx.arriving.has(r)));
  const owned = (r: RemoteEntry): r is RemoteLink => r.kind === "link" && !!r.id && ctx.ownerOf.get(r.id) === r;
  const foreign = (b: BaseEntry, r: RemoteEntry) => owned(r) && ctx.baseOwner.has(r.id!) && ctx.baseOwner.get(r.id!) !== b;
  const used = new Set<RemoteEntry>();
  const claimed = new Map<BaseEntry, RemoteEntry>();
  const take = (b: BaseEntry, r: RemoteEntry | undefined) => r && !used.has(r) && (used.add(r), claimed.set(b, r));
  for (const b of staying) {
    if (b.kind === "dir") take(b, ctx.dirs.get(b));
    else if (b.id && ctx.baseOwner.get(b.id) === b) take(b, open.find((r) => r === ctx.ownerOf.get(b.id!)));
  }
  for (const b of staying) if (b.kind === "link" && !claimed.has(b)) take(b, open.find((r) => r.kind !== "dir" && r.file === b.file && !foreign(b, r)));
  for (const b of staying) if (b.kind === "link" && !claimed.has(b)) take(b, open.find((x) => !used.has(x) && !foreign(b, x) && sameThing(b, x)));
  const fresh = open.filter((r) => !used.has(r));

  const entries: TargetEntry[] = [];
  const dropped: Dropped[] = [];
  const keep = (b: BaseEntry, here: LocalEntry | undefined, found: RemoteEntry | undefined) => {
    const r = found && (found.kind === b.kind || (found.kind === "held" && b.kind === "link")) ? found : undefined;
    if (!here && b.kind === "dir" && r?.kind === "dir" && holdsArrival(r.level, ctx)) {
      entries.push({ kind: "dir", key: null, file: r.file, name: nameOfFile(r.file, "dir"), renamed: false, level: mergeLevel(b.children, [], r.level, ctx) });
      return;
    }
    if (!here || here.kind !== b.kind || !r) {
      if (!here && r) dropped.push(r.kind === "dir" ? { kind: "dir", file: r.file, known: (b as BaseDir).children } : { kind: "link", file: r.file, url: r.kind === "link" ? r.url : (b as BaseLink).url });
      return;
    }
    const localRenamed = here.name !== b.name;
    const name = localRenamed ? here.name : r.file !== b.file ? nameOfFile(r.file, b.kind) : b.name;
    if (here.kind === "link" && b.kind === "link") {
      const remoteUrl = r.kind === "link" ? r.url : null;
      const fileId = r.kind === "link" ? r.id : null;
      const localMoved = here.url !== b.url;
      const url = localMoved || remoteUrl === null ? here.url : remoteUrl;
      const ownsFile = owned(r) && (!ctx.baseOwner.has(fileId!) || ctx.baseOwner.get(fileId!) === b);
      const id = ownsFile ? fileId : b.id && (ctx.baseOwner.get(b.id) ?? b) === b ? b.id : null;
      const heldName = r.kind === "held" ? b.name : null;
      if (r.kind === "held" && r.waiting) ctx.waiting += 1;
      entries.push({ kind: "link", key: b.key, file: r.file, name, url, renamed: localRenamed, write: remoteUrl === null ? localMoved : url !== remoteUrl, expect: remoteUrl ?? b.url, id, fileId, heldName });
    } else if (here.kind === "dir" && b.kind === "dir" && r.kind === "dir") {
      entries.push({ kind: "dir", key: b.key, file: r.file, name, renamed: localRenamed, level: mergeLevel(b.children, here.children, r.level, ctx) });
    }
  };
  for (const b of staying) keep(b, localByKey.get(b.key), claimed.get(b));
  for (const r of arrivals) {
    const b = ctx.arriving.get(r)!;
    keep(b, ctx.localLinks.get(b.key), r);
  }

  for (const l of local) {
    if (baseKeys.has(l.key) || ctx.arrivingKeys.has(l.key)) continue;
    const twin = fresh.find((r) => !used.has(r) && twinOf(l, r));
    if (twin) used.add(twin);
    if (l.kind === "link") {
      const fileId = twin?.kind === "link" ? twin.id : null;
      const id = twin && owned(twin) && !ctx.baseOwner.has(fileId!) ? fileId : null;
      entries.push({ kind: "link", key: l.key, file: twin?.file ?? null, name: l.name, url: l.url, renamed: true, write: !twin, expect: twin?.kind === "link" ? twin.url : null, id, fileId, heldName: null });
    } else {
      const level = twin?.kind === "dir" ? twin.level : EMPTY_REMOTE;
      entries.push({ kind: "dir", key: l.key, file: twin?.file ?? null, name: l.name, renamed: true, level: mergeLevel([], (l as LocalDir).children, level, ctx) });
    }
  }

  for (const r of fresh) {
    if (used.has(r)) continue;
    if (r.kind === "held") ctx.waiting += r.waiting ? 1 : 0;
    else if (r.kind === "link") {
      const own = owned(r) && !ctx.baseOwner.has(r.id!);
      entries.push({ kind: "link", key: null, file: r.file, name: nameOfFile(r.file, "link"), url: r.url, renamed: false, write: false, expect: r.url, id: own ? r.id : null, fileId: r.id, heldName: null });
    } else entries.push({ kind: "dir", key: null, file: r.file, name: r.file, renamed: false, level: mergeLevel([], [], r.level, ctx) });
  }

  return { entries: ordered(entries, base, local, remote), dropped, remote };
}

function ordered(entries: TargetEntry[], base: BaseEntry[], local: LocalEntry[], remote: RemoteLevel): TargetEntry[] {
  const byKey = new Map(entries.filter((e) => e.key !== null).map((e) => [e.key!, e]));
  const byFile = new Map(entries.filter((e) => e.file !== null).map((e) => [e.file!, e]));
  const present = (list: (TargetEntry | undefined)[]) => list.filter((e): e is TargetEntry => !!e);
  const baseSeq = present(base.map((b) => byKey.get(b.key)));
  const localSeq = present(local.map((l) => byKey.get(l.key)));
  const { listed, rest } = remoteOrder(remote);
  const listedSeq = present(listed.map((f) => byFile.get(f)));
  const remoteSeq = [...listedSeq, ...present(rest.map((f) => byFile.get(f)))];
  const localMoved = !sameRelative(baseSeq, localSeq);
  const remoteMoved = !remote.manifestPending && !sameRelative(baseSeq, remoteSeq);
  const primary = localMoved ? localSeq : remoteMoved ? remoteSeq : baseSeq;
  const woven = weave(weave(primary, localSeq), listedSeq);
  const placed = new Set(woven);
  return weave([...woven, ...remoteSeq.filter((e) => !placed.has(e))], entries);
}

export function sameRelative<T>(a: T[], b: T[]): boolean {
  const inB = new Set(b);
  const inA = new Set(a);
  const x = a.filter((e) => inB.has(e));
  const y = b.filter((e) => inA.has(e));
  return x.every((e, i) => e === y[i]);
}

export function weave<T>(primary: T[], other: T[]): T[] {
  const out = [...primary];
  const placed = new Set(out);
  other.forEach((x, i) => {
    if (placed.has(x)) return;
    let j = i - 1;
    while (j >= 0 && !placed.has(other[j]!)) j--;
    out.splice(j < 0 ? 0 : out.indexOf(other[j]!) + 1, 0, x);
    placed.add(x);
  });
  return out;
}
