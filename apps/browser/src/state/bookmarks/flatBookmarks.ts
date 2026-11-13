import { rootIdsFor } from "./bookmarks";
import type { BookmarkOp, EngineBookmark } from "./engineSync";
import type { Bookmarks } from "../browser/types";

type FlatNode = { kind: "url" | "folder"; parent: string | null; title: string; url?: string; addedAt: number; key?: string };
export type Flat = { nodes: Map<string, FlatNode>; children: Map<string, string[]> };

const emptyFlat = (): Flat => ({ nodes: new Map(), children: new Map() });
const cloneFlat = (f: Flat): Flat => ({ nodes: new Map(f.nodes), children: new Map([...f.children].map(([id, c]) => [id, [...c]])) });

type OrderNode = { id: string; priority: number; left: OrderNode | null; right: OrderNode | null; parent: OrderNode | null; size: number };
const nodeSize = (node: OrderNode | null) => node?.size ?? 0;
function priorityOf(id: string) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}
function mergeOrder(a: OrderNode | null, b: OrderNode | null): OrderNode | null {
  if (!a) { if (b) b.parent = null; return b; }
  if (!b) { a.parent = null; return a; }
  if (a.priority <= b.priority) {
    a.right = mergeOrder(a.right, b);
    if (a.right) a.right.parent = a;
    a.size = 1 + nodeSize(a.left) + nodeSize(a.right);
    a.parent = null;
    return a;
  }
  b.left = mergeOrder(a, b.left);
  if (b.left) b.left.parent = b;
  b.size = 1 + nodeSize(b.left) + nodeSize(b.right);
  b.parent = null;
  return b;
}
function splitOrder(root: OrderNode | null, count: number): [OrderNode | null, OrderNode | null] {
  if (!root) return [null, null];
  if (nodeSize(root.left) >= count) {
    const [left, rest] = splitOrder(root.left, count);
    root.left = rest;
    if (rest) rest.parent = root;
    root.size = 1 + nodeSize(root.left) + nodeSize(root.right);
    root.parent = null;
    if (left) left.parent = null;
    return [left, root];
  }
  const [rest, right] = splitOrder(root.right, count - nodeSize(root.left) - 1);
  root.right = rest;
  if (rest) rest.parent = root;
  root.size = 1 + nodeSize(root.left) + nodeSize(root.right);
  root.parent = null;
  if (right) right.parent = null;
  return [root, right];
}
class OrderList {
  #root: OrderNode | null = null;
  #nodes = new Map<string, OrderNode>();
  constructor(ids: string[] = []) { for (const id of ids) this.insert(this.length, id); }
  get length() { return nodeSize(this.#root); }
  has(id: string) { return this.#nodes.has(id); }
  indexOf(id: string) {
    let node = this.#nodes.get(id);
    if (!node) return -1;
    let index = nodeSize(node.left);
    while (node.parent) {
      if (node === node.parent.right) index += nodeSize(node.parent.left) + 1;
      node = node.parent;
    }
    return index;
  }
  at(index: number) {
    let node = this.#root;
    while (node) {
      const left = nodeSize(node.left);
      if (index === left) return node.id;
      if (index < left) node = node.left;
      else { index -= left + 1; node = node.right; }
    }
    return undefined;
  }
  remove(id: string) {
    const index = this.indexOf(id);
    if (index < 0) return false;
    const [left, tail] = splitOrder(this.#root, index);
    const [removed, right] = splitOrder(tail, 1);
    this.#root = mergeOrder(left, right);
    if (removed) {
      removed.left = null; removed.right = null; removed.parent = null; removed.size = 1;
      this.#nodes.delete(id);
    }
    return !!removed;
  }
  insert(index: number, id: string) {
    const existing = this.#nodes.get(id);
    const node = existing ?? { id, priority: priorityOf(id), left: null, right: null, parent: null, size: 1 };
    const at = Math.max(0, Math.min(index, this.length));
    const [left, right] = splitOrder(this.#root, at);
    this.#root = mergeOrder(mergeOrder(left, node), right);
    this.#nodes.set(id, node);
  }
}

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
  const kids = new Map([...from.children].map(([id, c]) => [id, new OrderList(c)]));
  const ops: BookmarkOp[] = [];

  const rescued: string[] = [];
  for (const [id, node] of to.nodes) {
    const oldParent = parentOf.get(id);
    if (!from.nodes.has(id) || !oldParent || to.nodes.has(oldParent)) continue;
    rescued.push(id);
  }
  const rescueByParent = new Map<string, Set<string>>();
  const rescueSet = new Set(rescued);
  for (const id of rescued) {
    const oldParent = parentOf.get(id)!;
    let gone = rescueByParent.get(oldParent);
    if (!gone) rescueByParent.set(oldParent, (gone = new Set()));
    gone.add(id);
  }
  for (const [parent, gone] of rescueByParent) {
    const children = kids.get(parent);
    for (const id of gone) children?.remove(id);
  }
  for (const id of rescued) {
    const desiredParent = to.nodes.get(id)!.parent;
    const parent = desiredParent && kids.has(desiredParent) ? desiredParent : roots.other;
    const current = kids.get(parent) ?? new OrderList();
    ops.push({ op: "move", id, parent: opParent(engine, parent), index: current.length });
    current.insert(current.length, id);
    kids.set(parent, current);
    parentOf.set(id, parent);
  }

  const removedRoots: string[] = [];
  const removed = new Set<string>();
  for (const [id, node] of from.nodes) {
    if (to.nodes.has(id) || !node.parent || !to.nodes.has(node.parent)) continue;
    removedRoots.push(id);
    const drop = (at: string) => {
      if (removed.has(at)) return;
      removed.add(at);
      for (const child of from.children.get(at) ?? []) if (!to.nodes.has(child)) drop(child);
    };
    drop(id);
  }
  for (const id of removedRoots) ops.push({ op: "remove", id });
  if (removed.size) {
    for (const id of removed) {
      const parent = parentOf.get(id);
      if (parent && !removed.has(parent)) kids.get(parent)?.remove(id);
    }
    for (const id of removed) {
      parentOf.delete(id);
      kids.delete(id);
    }
  }

  const queue = [roots.bar, roots.other];
  while (queue.length) {
    const folder = queue.shift()!;
    if (!kids.has(folder)) kids.set(folder, new OrderList());
    const desired = to.children.get(folder) ?? [];
    let successor: string | undefined;
    for (let index = desired.length - 1; index >= 0; index--) {
      const id = desired[index]!;
      const node = to.nodes.get(id)!;
      const was = from.nodes.get(id);
      const current = kids.get(folder)!;
      const actualIndex = () => successor && current.has(successor) ? current.indexOf(successor) : current.length;
      if (!parentOf.has(id)) {
        const position = actualIndex();
        ops.push({
          op: "add",
          id,
          k: node.kind === "url" ? "u" : "f",
          t: node.title,
          ...(node.url !== undefined ? { u: node.url } : {}),
          a: node.addedAt,
          ...(node.key ? { key: node.key } : {}),
          parent: opParent(engine, folder),
          index: position,
        });
        current.insert(position, id);
        parentOf.set(id, folder);
        if (node.kind === "folder") kids.set(id, new OrderList());
      } else {
        const parent = parentOf.get(id)!;
        if (parent !== folder || (successor && current.indexOf(id) > current.indexOf(successor))) {
          const old = kids.get(parent);
          old?.remove(id);
          const position = actualIndex();
          current.insert(position, id);
          parentOf.set(id, folder);
          ops.push({ op: "move", id, parent: opParent(engine, folder), index: position });
        }
        if (was && (was.title !== node.title || (node.url !== undefined && was.url !== node.url))) {
          ops.push({ op: "update", id, t: node.title, ...(node.url !== undefined ? { u: node.url } : {}) });
        }
      }
      if (node.kind === "folder") queue.push(id);
      successor = id;
    }
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
