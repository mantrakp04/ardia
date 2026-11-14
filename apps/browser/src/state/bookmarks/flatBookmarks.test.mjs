import assert from "node:assert/strict";
import test from "node:test";
import { applyOps, bookmarkOps } from "./flatBookmarks.ts";
import { rootIdsFor } from "./bookmarks.ts";

const roots = rootIdsFor("");
const folder = (parent, title) => ({ kind: "folder", parent, title, addedAt: 0 });
const url = (parent, title = "link") => ({ kind: "url", parent, title, url: "https://example.invalid", addedAt: 0 });
const equalFlat = (a, b) => {
  const byId = ([a], [b]) => a.localeCompare(b);
  assert.deepEqual([...a.nodes].sort(byId), [...b.nodes].sort(byId));
  assert.deepEqual([...a.children].sort(byId), [...b.children].sort(byId));
};

test("moving a selected block only emits moves for that block", () => {
  const source = "source";
  const target = "target";
  const ids = Array.from({ length: 32000 }, (_, i) => `link-${i}`);
  const from = {
    nodes: new Map([
      [roots.bar, folder(null, "bar")],
      [roots.other, folder(null, "other")],
      [source, folder(roots.other, "source")],
      [target, folder(roots.other, "target")],
      ...ids.map((id) => [id, url(source)]),
    ]),
    children: new Map([[roots.bar, []], [roots.other, [source, target]], [source, ids], [target, []]]),
  };
  const selected = ids.slice(0, 100);
  const to = {
    nodes: new Map(from.nodes),
    children: new Map([...from.children].map(([id, children]) => [id, [...children]])),
  };
  to.children.set(source, ids.slice(selected.length));
  to.children.set(target, selected);
  for (const id of selected) to.nodes.set(id, { ...to.nodes.get(id), parent: target });

  const ops = bookmarkOps(from, to, "");
  assert.equal(ops.length, selected.length);
  assert.equal(ops.filter((op) => op.op === "move").length, selected.length);
  equalFlat(applyOps(from, ops, ""), to);
});

test("a populated destination does not turn moved siblings into moves", () => {
  const source = "source";
  const target = "target";
  const moved = Array.from({ length: 16000 }, (_, i) => `moved-${i}`);
  const existing = Array.from({ length: 16000 }, (_, i) => `existing-${i}`);
  const from = {
    nodes: new Map([
      [roots.bar, folder(null, "bar")], [roots.other, folder(null, "other")],
      [source, folder(roots.other, "source")], [target, folder(roots.other, "target")],
      ...moved.map((id) => [id, url(source)]), ...existing.map((id) => [id, url(target)]),
    ]),
    children: new Map([[roots.bar, []], [roots.other, [source, target]], [source, moved], [target, existing]]),
  };
  const selected = moved.slice(0, 100);
  const to = {
    nodes: new Map(from.nodes),
    children: new Map([...from.children].map(([id, children]) => [id, [...children]])),
  };
  to.children.set(source, moved.slice(selected.length));
  to.children.set(target, [...selected, ...existing]);
  for (const id of selected) to.nodes.set(id, { ...to.nodes.get(id), parent: target });

  const ops = bookmarkOps(from, to, "");
  assert.equal(ops.length, selected.length);
  equalFlat(applyOps(from, ops, ""), to);
});

test("deletions and moves use indexes after removed siblings", () => {
  const source = "source";
  const target = "target";
  const a = "a";
  const b = "b";
  const gone = "gone";
  const from = {
    nodes: new Map([
      [roots.bar, folder(null, "bar")], [roots.other, folder(null, "other")],
      [source, folder(roots.other, "source")], [target, folder(roots.other, "target")],
      [a, url(source)], [b, url(source)], [gone, url(source)],
    ]),
    children: new Map([[roots.bar, []], [roots.other, [source, target]], [source, [a, b, gone]], [target, []]]),
  };
  const to = {
    nodes: new Map(from.nodes),
    children: new Map([[roots.bar, []], [roots.other, [source, target]], [source, [b]], [target, [a]]]),
  };
  to.nodes.delete(gone);
  to.nodes.set(a, { ...to.nodes.get(a), parent: target });

  equalFlat(applyOps(from, bookmarkOps(from, to, ""), ""), to);
});

test("same-folder reorder preserves the requested order", () => {
  const parent = "parent";
  const ids = ["a", "b", "c", "d"];
  const from = {
    nodes: new Map([
      [roots.bar, folder(null, "bar")], [roots.other, folder(null, "other")], [parent, folder(roots.other, "parent")],
      ...ids.map((id) => [id, url(parent, id)]),
    ]),
    children: new Map([[roots.bar, []], [roots.other, [parent]], [parent, ids]]),
  };
  const to = {
    nodes: new Map(from.nodes),
    children: new Map([[roots.bar, []], [roots.other, [parent]], [parent, ["c", "a", "d", "b"]]]),
  };

  equalFlat(applyOps(from, bookmarkOps(from, to, ""), ""), to);
});

test("retained children move out before their deleted folder is removed", () => {
  const old = "old";
  const next = "next";
  const id = "retained";
  const from = {
    nodes: new Map([
      [roots.bar, folder(null, "bar")], [roots.other, folder(null, "other")],
      [old, folder(roots.other, "old")], [id, url(old)],
    ]),
    children: new Map([[roots.bar, []], [roots.other, [old]], [old, [id]]]),
  };
  const to = {
    nodes: new Map([
      [roots.bar, folder(null, "bar")], [roots.other, folder(null, "other")],
      [next, folder(roots.other, "next")], [id, url(next)],
    ]),
    children: new Map([[roots.bar, []], [roots.other, [next]], [next, [id]]]),
  };

  equalFlat(applyOps(from, bookmarkOps(from, to, ""), ""), to);
});

test("cross-folder moves use the order after each emitted move", () => {
  const d = "d";
  const e = "e";
  const w = "w";
  const o = "o";
  const p = "p";
  const n = "n";
  const from = {
    nodes: new Map([
      [roots.bar, folder(null, "bar")], [roots.other, folder(null, "other")],
      [d, folder(roots.bar, "D")], [e, folder(roots.bar, "E")], [w, folder(roots.bar, "W")],
      [o, url(d, "o")], [p, url(d, "p")], [n, url(w, "n")],
    ]),
    children: new Map([[roots.bar, [d, e, w]], [roots.other, []], [d, [o, p]], [e, []], [w, [n]]]),
  };
  const to = {
    nodes: new Map(from.nodes),
    children: new Map([[roots.bar, [d, e, w]], [roots.other, []], [d, [p, n]], [e, [o]], [w, []]]),
  };
  to.nodes.set(o, { ...to.nodes.get(o), parent: e });
  to.nodes.set(n, { ...to.nodes.get(n), parent: d });

  equalFlat(applyOps(from, bookmarkOps(from, to, ""), ""), to);
});

test("moved bookmarks still emit title and URL updates", () => {
  const source = "source";
  const target = "target";
  const id = "moving";
  const from = {
    nodes: new Map([
      [roots.bar, folder(null, "bar")], [roots.other, folder(null, "other")],
      [source, folder(roots.other, "source")], [target, folder(roots.other, "target")],
      [id, { ...url(source, "before"), url: "https://before.example/" }],
    ]),
    children: new Map([[roots.bar, []], [roots.other, [source, target]], [source, [id]], [target, []]]),
  };
  const to = {
    nodes: new Map(from.nodes),
    children: new Map([[roots.bar, []], [roots.other, [source, target]], [source, []], [target, [id]]]),
  };
  to.nodes.set(id, { ...to.nodes.get(id), parent: target, title: "after", url: "https://after.example/" });

  const ops = bookmarkOps(from, to, "");
  assert.deepEqual(ops.map((op) => op.op), ["move", "update"]);
  equalFlat(applyOps(from, ops, ""), to);
});
