import { rootIdsFor } from "./bookmarks";
import type { BookmarkOp, EngineBookmark } from "./engineSync";
import type { Bookmarks } from "../browser/types";

type FlatNode = { kind: "url" | "folder"; parent: string | null; title: string; url?: string; addedAt: number; key?: string };
export type Flat = { nodes: Map<string, FlatNode>; children: Map<string, string[]> };

const emptyFlat = (): Flat => ({ nodes: new Map(), children: new Map() });
const cloneFlat = (f: Flat): Flat => ({ nodes: new Map(f.nodes), children: new Map([...f.children].map(([id, c]) => [id, [...c]])) });

export function flatFromStore(b: Bookmarks, engine: string): Flat {
  const roots = rootIdsFor(engine);
  const flat = emptyFlat();
  const walk = (id: string, parent: string | null) => {
    const node = b.nodes[id];
    if (!node || flat.nodes.has(id)) return;
    flat.nodes.set(id, {
      kind: node.kind,
      parent,
      title: node.title,
      ...(node.kind === "url" ? { url: node.url } : {}),
      addedAt: node.addedAt,
      ...(node.syncKey ? { key: node.syncKey } : {}),
    });
    if (node.kind !== "folder") return;
    const kids: string[] = [];
    for (const c of node.children) {
      if (!b.nodes[c] || flat.nodes.has(c)) continue;
      walk(c, id);
      kids.push(c);
    }
    flat.children.set(id, kids);
  };
  walk(roots.bar, null);
  walk(roots.other, null);
  return flat;
}

export function flatFromEngine(tree: { bar: EngineBookmark; other: EngineBookmark }, engine: string): Flat {
  const roots = rootIdsFor(engine);
  const flat = emptyFlat();
  const walk = (node: EngineBookmark, id: string, parent: string | null) => {
    flat.nodes.set(id, {
      kind: node.k === "u" ? "url" : "folder",
      parent,
      title: node.t,
      ...(node.k === "u" ? { url: node.u ?? "" } : {}),
      addedAt: node.a,
      ...(node.key ? { key: node.key } : {}),
    });
    if (node.k === "f") {
      flat.children.set(id, (node.c ?? []).map((c) => c.id));
      for (const c of node.c ?? []) walk(c, c.id, id);
    }
  };
  walk(tree.bar, roots.bar, null);
  walk(tree.other, roots.other, null);
  return flat;
}

const opParent = (engine: string, id: string) => {
  const roots = rootIdsFor(engine);
  return id === roots.bar ? "bar" : id === roots.other ? "other" : id;
};
const flatParent = (engine: string, id: string) => {
  const roots = rootIdsFor(engine);
  return id === "bar" ? roots.bar : id === "other" ? roots.other : id;
};

export function bookmarkOps(from: Flat, to: Flat, engine: string): BookmarkOp[] {
  const roots = rootIdsFor(engine);
  const parentOf = new Map([...from.nodes].map(([id, n]) => [id, n.parent]));
  const kids = new Map([...from.children].map(([id, c]) => [id, [...c]]));
  const ops: BookmarkOp[] = [];
  const queue = [roots.bar, roots.other];
  while (queue.length) {
    const folder = queue.shift()!;
    if (!kids.has(folder)) kids.set(folder, []);
    (to.children.get(folder) ?? []).forEach((id, index) => {
      const node = to.nodes.get(id)!;
      const was = from.nodes.get(id);
      const current = kids.get(folder)!;
      if (!parentOf.has(id)) {
        ops.push({
          op: "add",
          id,
          k: node.kind === "url" ? "u" : "f",
          t: node.title,
          ...(node.url !== undefined ? { u: node.url } : {}),
          a: node.addedAt,
          ...(node.key ? { key: node.key } : {}),
          parent: opParent(engine, folder),
          index,
        });
        current.splice(index, 0, id);
        parentOf.set(id, folder);
        if (node.kind === "folder") kids.set(id, []);
      } else {
        if (parentOf.get(id) !== folder || current.indexOf(id) !== index) {
          const old = kids.get(parentOf.get(id)!);
          if (old) old.splice(old.indexOf(id), 1);
          current.splice(index, 0, id);
          parentOf.set(id, folder);
          ops.push({ op: "move", id, parent: opParent(engine, folder), index });
        }
        if (was && (was.title !== node.title || (node.url !== undefined && was.url !== node.url))) {
          ops.push({ op: "update", id, t: node.title, ...(node.url !== undefined ? { u: node.url } : {}) });
        }
      }
      if (node.kind === "folder") queue.push(id);
    });
  }
  for (const [id, n] of from.nodes) {
    if (to.nodes.has(id) || n.parent === null) continue;
    let under = false;
    for (let at = parentOf.get(id); at; at = parentOf.get(at)) if (!to.nodes.has(at)) under = true;
    if (!under) ops.push({ op: "remove", id });
  }
  return ops;
}

const keepsUrl = (url: string) => /^[a-z][a-z0-9+.-]*:./i.test(url);

export function applyOps(tree: Flat, ops: BookmarkOp[], engine: string): Flat {
  const flat = cloneFlat(tree);
  const detach = (id: string) => {
    const parent = flat.nodes.get(id)?.parent;
    const list = parent ? flat.children.get(parent) : undefined;
    if (list) list.splice(list.indexOf(id), 1);
  };
  const attach = (id: string, parent: string, index: number | undefined) => {
    const list = flat.children.get(parent)!;
    list.splice(Math.max(0, Math.min(index ?? list.length, list.length)), 0, id);
    flat.nodes.set(id, { ...flat.nodes.get(id)!, parent });
  };
  const inside = (id: string, of: string) => {
    for (let at: string | null | undefined = of; at; at = flat.nodes.get(at)?.parent) if (at === id) return true;
    return false;
  };
  for (const op of ops) {
    const node = flat.nodes.get(op.id);
    if (op.op === "remove") {
      if (!node || node.parent === null) break;
      detach(op.id);
      const drop = (id: string) => {
        for (const c of flat.children.get(id) ?? []) drop(c);
        flat.nodes.delete(id);
        flat.children.delete(id);
      };
      drop(op.id);
      continue;
    }
    if (op.op === "update") {
      if (!node || node.parent === null) break;
      flat.nodes.set(op.id, { ...node, ...(op.t !== undefined ? { title: op.t } : {}), ...(op.u && node.kind === "url" && keepsUrl(op.u) ? { url: op.u } : {}) });
      continue;
    }
    const parent = flatParent(engine, op.parent);
    if (flat.nodes.get(parent)?.kind !== "folder") break;
    if (op.op === "add" && node && op.ifAbsent) continue;
    if (op.op === "move" || node) {
      if (!node || node.parent === null || inside(op.id, parent)) break;
      detach(op.id);
      attach(op.id, parent, op.index);
      if (op.op === "add") flat.nodes.set(op.id, { ...flat.nodes.get(op.id)!, title: op.t, ...(op.u && node.kind === "url" && keepsUrl(op.u) ? { url: op.u } : {}) });
      continue;
    }
    if (op.k === "u" && !keepsUrl(op.u ?? "")) continue;
    flat.nodes.set(op.id, {
      kind: op.k === "u" ? "url" : "folder",
      parent,
      title: op.t,
      ...(op.k === "u" ? { url: op.u ?? "" } : {}),
      addedAt: op.a,
      ...(op.key ? { key: op.key } : {}),
    });
    if (op.k === "f") flat.children.set(op.id, []);
    attach(op.id, parent, op.index);
  }
  return flat;
}
