import { nameOfFile, type BaseDir, type BaseEntry, type BaseLink, type LocalEntry, type LocalLink, type RemoteEntry, type RemoteLevel, type RemoteLink } from "./tree";

type RemoteDir = Extract<RemoteEntry, { kind: "dir" }>;

export type Identities = {
  dirs: Map<BaseDir, RemoteDir>;
  ownerOf: Map<string, RemoteLink>;
  baseOwner: Map<string, BaseLink>;
  moved: Map<BaseLink, RemoteLink>;
  arriving: Map<RemoteLink, BaseLink>;
  arrivingKeys: Set<string>;
  localLinks: Map<string, LocalLink>;
};

const linksIn = (level: RemoteLevel): RemoteLink[] => level.entries.flatMap((r) => (r.kind === "link" ? [r] : r.kind === "dir" ? linksIn(r.level) : []));

const baseLinks = (base: BaseEntry[]): BaseLink[] => base.flatMap((b) => (b.kind === "link" ? [b] : baseLinks(b.children)));

function localLinks(local: LocalEntry[], into: Map<string, LocalLink>) {
  for (const l of local) l.kind === "link" ? into.set(l.key, l) : localLinks(l.children, into);
  return into;
}

export const preferred = (b: BaseLink, candidates: RemoteLink[]): RemoteLink | undefined =>
  candidates.find((r) => r.file === b.file) ?? candidates.find((r) => nameOfFile(r.file, "link") === b.name) ?? candidates[0];

const shared = (a: Set<string>, z: Set<string>) => [...a].filter((x) => z.has(x)).length;

function mapDirs(base: BaseEntry[], remote: RemoteLevel | null, dirs: Map<BaseDir, RemoteDir>, levels: [BaseEntry[], RemoteLevel | null][]) {
  levels.push([base, remote]);
  const wanted = base.filter((b): b is BaseDir => b.kind === "dir");
  const offered = remote ? remote.entries.filter((r): r is RemoteDir => r.kind === "dir") : [];
  const used = new Set<RemoteDir>();
  const pair = (b: BaseDir, r: RemoteDir | undefined) => r && (used.add(r), dirs.set(b, r));
  const baseIdsOf = new Map(wanted.map((b) => [b, new Set(baseLinks(b.children).flatMap((x) => (x.id ? [x.id] : [])))]));
  const remoteIdsOf = new Map(offered.map((r) => [r, new Set(linksIn(r.level).flatMap((x) => (x.id ? [x.id] : [])))]));
  for (const b of wanted) {
    let best: RemoteDir | undefined;
    let score = 0;
    for (const r of offered) {
      const s = used.has(r) ? 0 : shared(baseIdsOf.get(b)!, remoteIdsOf.get(r)!);
      if (s > score || (s > 0 && s === score && r.file === b.file)) (best = r), (score = s);
    }
    pair(b, best);
  }
  for (const b of wanted) if (!dirs.has(b)) pair(b, offered.find((r) => !used.has(r) && r.file === b.file));
  for (const b of wanted) if (!dirs.has(b)) pair(b, offered.find((r) => !used.has(r) && b.children.some((c) => r.level.entries.some((x) => x.file === c.file))));
  for (const b of wanted) mapDirs(b.children, dirs.get(b)?.level ?? null, dirs, levels);
}

export function identities(base: BaseEntry[], local: LocalEntry[], remote: RemoteLevel): Identities {
  const dirs = new Map<BaseDir, RemoteDir>();
  const levels: [BaseEntry[], RemoteLevel | null][] = [];
  mapDirs(base, remote, dirs, levels);
  const ownerOf = new Map<string, RemoteLink>();
  const baseOwner = new Map<string, BaseLink>();
  const levelOf = new Map<RemoteLink, RemoteLevel>();
  const index = (level: RemoteLevel) => level.entries.forEach((r) => (r.kind === "link" ? levelOf.set(r, level) : r.kind === "dir" && index(r.level)));
  index(remote);
  const all = linksIn(remote);
  const moved = new Map<BaseLink, RemoteLink>();
  const arriving = new Map<RemoteLink, BaseLink>();
  for (const [entries, level] of levels) {
    for (const b of entries) {
      if (b.kind !== "link" || !b.id || baseOwner.has(b.id)) continue;
      const everywhere = all.filter((x) => x.id === b.id);
      const here = everywhere.filter((x) => levelOf.get(x) === level);
      const r = here.find((x) => x.file === b.file) ?? everywhere.find((x) => x.file === b.file) ?? preferred(b, here) ?? preferred(b, everywhere);
      if (!r) continue;
      ownerOf.set(b.id, r);
      baseOwner.set(b.id, b);
      if (levelOf.get(r) !== level) (moved.set(b, r), arriving.set(r, b));
    }
  }
  for (const r of all) if (r.id && !ownerOf.has(r.id)) ownerOf.set(r.id, r);
  return { dirs, ownerOf, baseOwner, moved, arriving, arrivingKeys: new Set([...moved.keys()].map((b) => b.key)), localLinks: localLinks(local, new Map()) };
}
