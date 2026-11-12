import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeFolder } from "./merge.ts";
import { planFiles } from "./plan.ts";
import { MANIFEST, cleanName, manifestText, parseManifest, uniqueFileName } from "./tree.ts";
import { parseWebloc, weblocLinkId, weblocText } from "../../lib/webloc.ts";

const dir = (files = {}, order = null) => ({ files: new Map(Object.entries(files)), manifest: order ? manifestText(order) : null });

function at(fs, path, make = false) {
  const parts = path.split("/");
  let here = fs;
  for (const p of parts.slice(0, -1)) {
    let next = here.files.get(p);
    if (!next?.dir) {
      if (!make) return [null, parts.at(-1)];
      next = { dir: dir() };
      here.files.set(p, next);
    }
    here = next.dir;
  }
  return [here, parts.at(-1)];
}

function applyOps(fs, ops) {
  const conflicts = [];
  for (const op of ops) {
    const [parent, name] = at(fs, op.path, op.op !== "delete" && op.op !== "rmdir");
    if (!parent) continue;
    if (op.op === "write") {
      if (name === MANIFEST) parent.manifest = op.text;
      else if (op.create && parent.files.has(name)) conflicts.push(op.path);
      else if (!op.create && op.expect && parent.files.get(name)?.url !== op.expect) conflicts.push(op.path);
      else parent.files.set(name, { url: parseWebloc(op.text), id: weblocLinkId(op.text) });
    } else if (op.op === "delete") {
      const item = parent.files.get(name);
      if (item && !item.dir && item.url === op.expect) parent.files.delete(name);
    } else if (op.op === "mkdir") parent.files.set(name, parent.files.get(name) ?? { dir: dir() });
    else if (op.op === "rmdir") {
      if (parent.files.get(name)?.dir.files.size === 0) parent.files.delete(name);
    } else if (op.op === "move") {
      const item = parent.files.get(name);
      const [to, toName] = at(fs, op.to, true);
      if (to.files.has(toName)) {
        conflicts.push(op.to);
        continue;
      }
      parent.files.delete(name);
      to.files.set(toName, item);
    }
  }
  return conflicts;
}

function read(fs) {
  return {
    entries: [...fs.files]
      .sort(([a], [z]) => (a < z ? -1 : 1))
      .map(([file, item]) => (item.dir ? { kind: "dir", file, level: read(item.dir) } : item.held ? { kind: "held", file, waiting: true } : { kind: "link", file, url: item.url, id: item.id ?? null })),
    manifest: parseManifest(fs.manifest),
    manifestPending: false,
  };
}

let nextKey = 0;
function realize(level) {
  const out = [];
  for (const e of level.entries) {
    if (e.kind === "link") {
      e.key ??= `k${++nextKey}`;
      out.push({ kind: "link", key: e.key, name: e.name, url: e.url });
    } else {
      const children = realize(e.level);
      if (!children.length) {
        e.key = null;
        continue;
      }
      e.key ??= `k${++nextKey}`;
      out.push({ kind: "dir", key: e.key, name: e.name, children });
    }
  }
  return out;
}

const mac = (local = []) => ({ base: [], local });

function cycle(m, fs) {
  const { level, waiting } = mergeFolder(m.base, m.local, read(fs));
  m.local = realize(level);
  const { ops, base } = planFiles(level, m.base);
  const conflicts = applyOps(fs, ops);
  if (!conflicts.length) m.base = base;
  return { ops, waiting, conflicts };
}

const link = (key, name, url) => ({ kind: "link", key, name, url });
const names = (m) => m.local.map((e) => (e.kind === "dir" ? `[${e.name}: ${names({ local: e.children }).join(", ")}]` : e.name));
const files = (fs) => [...fs.files.keys()].sort();
const order = (fs) => parseManifest(fs.manifest);

test("sharing a folder writes one webloc per link and the order", () => {
  const fs = dir();
  const a = mac([link("t1", "GitHub", "https://github.com/"), link("t2", "Docs", "https://docs.example/")]);
  cycle(a, fs);
  assert.deepEqual(files(fs), ["Docs.webloc", "GitHub.webloc"]);
  assert.equal(fs.files.get("GitHub.webloc").url, "https://github.com/");
  assert.deepEqual(order(fs), ["GitHub.webloc", "Docs.webloc"]);
  assert.deepEqual(cycle(a, fs).ops, [], "a second pass changes nothing");
});

test("a collaborator's new, renamed and deleted links reach the sidebar, keeping each link's identity", () => {
  const fs = dir();
  const a = mac([link("t1", "One", "https://one.example/"), link("t2", "Two", "https://two.example/")]);
  cycle(a, fs);
  fs.files.set("Three.webloc", { url: "https://three.example/" });
  fs.files.set("Uno.webloc", fs.files.get("One.webloc"));
  fs.files.delete("One.webloc");
  fs.files.delete("Two.webloc");
  const { ops } = cycle(a, fs);
  assert.deepEqual(names(a), ["Uno", "Three"]);
  assert.equal(a.local[0].key, "t1", "a rename keeps the tab");
  assert.deepEqual(ops, [{ op: "write", path: MANIFEST, text: manifestText(["Uno.webloc", "Three.webloc"]), create: false, expect: null }]);
});

test("renaming and moving links in the sidebar renames files and rewrites the order", () => {
  const fs = dir();
  const a = mac([link("t1", "One", "https://one.example/"), link("t2", "Two", "https://two.example/")]);
  cycle(a, fs);
  a.local = [link("t2", "Two", "https://two.example/"), link("t1", "First", "https://one.example/")];
  const { ops } = cycle(a, fs);
  assert.deepEqual(files(fs), ["First.webloc", "Two.webloc"]);
  assert.deepEqual(ops.map((o) => o.op), ["move", "write"]);
  assert.deepEqual(order(fs), ["Two.webloc", "First.webloc"]);
});

test("an order edited elsewhere moves the sidebar; a local move wins over it", () => {
  const fs = dir();
  const a = mac([link("t1", "A", "https://a.example/"), link("t2", "B", "https://b.example/"), link("t3", "C", "https://c.example/")]);
  cycle(a, fs);
  fs.manifest = manifestText(["C.webloc", "A.webloc", "B.webloc"]);
  cycle(a, fs);
  assert.deepEqual(names(a), ["C", "A", "B"]);
  fs.manifest = manifestText(["B.webloc", "C.webloc", "A.webloc"]);
  a.local = [a.local[1], a.local[2], a.local[0]];
  cycle(a, fs);
  assert.deepEqual(names(a), ["A", "B", "C"]);
  assert.deepEqual(order(fs), ["A.webloc", "B.webloc", "C.webloc"]);
});

test("a folder without the order file reads in name order, numbers sorted as numbers", () => {
  const fs = dir({ "Item 10.webloc": { url: "https://x.example/10" }, "Item 9.webloc": { url: "https://x.example/9" }, "alpha.webloc": { url: "https://x.example/a" } });
  const a = mac();
  cycle(a, fs);
  assert.deepEqual(names(a), ["alpha", "Item 9", "Item 10"]);
  assert.deepEqual(order(fs), ["alpha.webloc", "Item 9.webloc", "Item 10.webloc"]);
});

test("a link still downloading from iCloud is waited for, never deleted, and keeps its place in the order", () => {
  const fs = dir({ "A.webloc": { url: "https://a.example/" }, "New.webloc": { held: true }, "B.webloc": { url: "https://b.example/" } }, ["A.webloc", "New.webloc", "B.webloc"]);
  const a = mac();
  const { ops, waiting } = cycle(a, fs);
  assert.equal(waiting, 1);
  assert.deepEqual(names(a), ["A", "B"]);
  assert.ok(ops.every((o) => o.path !== "New.webloc"));
  assert.deepEqual(order(fs), ["A.webloc", "New.webloc", "B.webloc"]);
  fs.files.set("New.webloc", { url: "https://new.example/" });
  cycle(a, fs);
  assert.deepEqual(names(a), ["A", "New", "B"]);
});

test("files Ardia can't open (other schemes, unreadable) stay untouched and keep their names taken", () => {
  const fs = dir({ "Mail.webloc": { held: true } });
  fs.files.get("Mail.webloc").held = true;
  const a = mac([link("t1", "Mail", "https://mail.example/")]);
  const { ops } = cycle(a, fs);
  assert.deepEqual(files(fs), ["Mail 2.webloc", "Mail.webloc"]);
  assert.ok(!ops.some((o) => o.op === "delete"));
});

test("two links with one name get distinct files, case-insensitively", () => {
  const taken = new Set();
  assert.deepEqual(["Docs", "docs", "Docs"].map((n) => uniqueFileName(n, "link", taken)), ["Docs.webloc", "docs 2.webloc", "Docs 3.webloc"]);
  assert.equal(cleanName("  a/b: c  ", "Link"), "a-b- c");
  assert.equal(cleanName("...hidden", "Link"), "hidden");
  assert.equal(cleanName("   ", "Link"), "Link");
});

test("subfolders are directories, both ways, and removing one deletes only the links Ardia knew", () => {
  const fs = dir();
  const a = mac([link("t1", "Top", "https://top.example/"), { kind: "dir", key: "g1", name: "Reading", children: [link("t2", "Essay", "https://essay.example/")] }]);
  cycle(a, fs);
  assert.deepEqual(files(fs), ["Reading", "Top.webloc"]);
  assert.deepEqual([...fs.files.get("Reading").dir.files.keys()], ["Essay.webloc"]);
  fs.files.get("Reading").dir.files.set("Late.webloc", { url: "https://late.example/" });
  a.local = [a.local[0]];
  cycle(a, fs);
  assert.deepEqual([...fs.files.get("Reading").dir.files.keys()], ["Late.webloc"], "a link added meanwhile survives");
  cycle(a, fs);
  assert.deepEqual(names(a), ["Top", "[Reading: Late]"]);
});

test("two Macs editing at once converge on the same links and order", () => {
  const fs = dir();
  const a = mac([link("a1", "One", "https://one.example/"), link("a2", "Two", "https://two.example/")]);
  cycle(a, fs);
  const b = mac();
  cycle(b, fs);
  assert.deepEqual(names(b), ["One", "Two"]);
  a.local = [...a.local, link("a3", "From A", "https://a.example/")];
  b.local = [link("b9", "From B", "https://b.example/"), ...b.local.filter((e) => e.name !== "Two")];
  b.local[1] = { ...b.local[1], name: "Uno" };
  for (let i = 0; i < 3; i++) (cycle(a, fs), cycle(b, fs));
  assert.deepEqual(names(a), names(b));
  assert.deepEqual(names(a), ["From B", "Uno", "From A"]);
  assert.deepEqual(files(fs), ["From A.webloc", "From B.webloc", "Uno.webloc"]);
  assert.deepEqual(cycle(a, fs).ops, []);
  assert.deepEqual(cycle(b, fs).ops, []);
});

test("binding again with no saved state matches what is already there instead of doubling it", () => {
  const fs = dir();
  const a = mac([link("t1", "One", "https://one.example/")]);
  cycle(a, fs);
  a.base = [];
  const { ops } = cycle(a, fs);
  assert.deepEqual(names(a), ["One"]);
  assert.deepEqual(files(fs), ["One.webloc"]);
  assert.deepEqual(ops, []);
});

test("a newer order file version, or junk, reads as no order", () => {
  assert.equal(parseManifest(JSON.stringify({ version: 2, order: ["a"] })), null);
  assert.equal(parseManifest("{"), null);
  assert.deepEqual(parseManifest(manifestText(["a", "b"])), ["a", "b"]);
  assert.equal(weblocText("https://x/").includes("https://x/"), true);
});

test("two links swapping names move through temporary names instead of colliding", () => {
  const fs = dir();
  const a = mac([link("t1", "A", "https://a.example/"), link("t2", "B", "https://b.example/")]);
  cycle(a, fs);
  a.local = [link("t1", "B", "https://a.example/"), link("t2", "A", "https://b.example/")];
  const { conflicts } = cycle(a, fs);
  assert.deepEqual(conflicts, []);
  assert.equal(fs.files.get("A.webloc").url, "https://b.example/");
  assert.equal(fs.files.get("B.webloc").url, "https://a.example/");
  assert.deepEqual(files(fs), ["A.webloc", "B.webloc"]);
  assert.deepEqual(cycle(a, fs).ops, []);
});

test("a case-only rename goes through a temporary name too", () => {
  const fs = dir();
  const a = mac([link("t1", "docs", "https://docs.example/")]);
  cycle(a, fs);
  a.local = [link("t1", "Docs", "https://docs.example/")];
  const { ops, conflicts } = cycle(a, fs);
  assert.deepEqual(conflicts, []);
  assert.equal(ops.filter((o) => o.op === "move").length, 2);
  assert.deepEqual(files(fs), ["Docs.webloc"]);
});

test("two writers adding the same name: the second create fails, then lands beside the first", () => {
  const fs = dir();
  const a = mac([link("a1", "Docs", "https://a.example/")]);
  const b = mac([link("b1", "Docs", "https://b.example/")]);
  const { level } = mergeFolder(b.base, b.local, read(fs));
  cycle(a, fs);
  const late = planFiles(level);
  assert.ok(late.ops.some((o) => o.op === "write" && o.create && o.path === "Docs.webloc"));
  assert.deepEqual(applyOps(fs, late.ops), ["Docs.webloc"], "the late create is refused");
  assert.equal(fs.files.get("Docs.webloc").url, "https://a.example/");
  for (let i = 0; i < 2; i++) (cycle(b, fs), cycle(a, fs));
  assert.deepEqual(files(fs), ["Docs 2.webloc", "Docs.webloc"]);
  assert.equal(fs.files.get("Docs 2.webloc").url, "https://b.example/");
  const urls = (m) => m.local.map((e) => e.url).sort();
  assert.deepEqual(urls(a), urls(b));
});

test("removing a subfolder deletes only weblocs whose URL still matches, never a directory in a link's place", () => {
  const fs = dir();
  const a = mac([link("t0", "Top", "https://top.example/"), { kind: "dir", key: "g1", name: "Reading", children: [link("t1", "Docs", "https://docs.example/"), link("t2", "Old", "https://old.example/")] }]);
  cycle(a, fs);
  const reading = fs.files.get("Reading").dir;
  reading.files.set("Docs.webloc", { dir: dir({ "report.pdf": { url: null } }) });
  reading.files.set("Old.webloc", { url: "https://changed.example/" });
  a.local = [a.local[0]];
  const { ops } = cycle(a, fs);
  const deletes = ops.filter((o) => o.op === "delete");
  assert.deepEqual(deletes.map((o) => [o.path, o.expect]), [["Reading/Docs.webloc", "https://docs.example/"], ["Reading/Old.webloc", "https://old.example/"]]);
  assert.ok(reading.files.get("Docs.webloc").dir.files.has("report.pdf"));
  assert.equal(reading.files.get("Old.webloc").url, "https://changed.example/");
});

test("a folder that can't be listed is an error, not an empty folder", async () => {
  const { remoteLevel } = await import("./remote.ts");
  assert.throws(() => remoteLevel({ entries: [], manifest: null, manifestPending: false, error: "Permission denied" }), /Permission denied/);
  assert.throws(() => remoteLevel({ entries: [{ kind: "dir", file: "Sub", level: { entries: [], manifest: null, manifestPending: false, error: "busy" } }], manifest: null, manifestPending: false }), /busy/);
});

test("a swap with a URL edit, interrupted after any prefix of its file changes, loses no edit and crosses no identity", () => {
  const start = () => {
    const fs = dir();
    const a = mac([link("t1", "A", "https://a.example/"), link("t2", "B", "https://b.example/")]);
    cycle(a, fs);
    a.local = [link("t1", "B", "https://a2.example/"), link("t2", "A", "https://b.example/")];
    return { fs, a };
  };
  const { level } = mergeFolder(start().a.base, start().a.local, read(start().fs));
  const total = planFiles(level).ops.length;
  for (let k = 0; k <= total; k++) {
    const { fs, a } = start();
    const merged = mergeFolder(a.base, a.local, read(fs));
    applyOps(fs, planFiles(merged.level).ops.slice(0, k));
    for (let i = 0; i < 3; i++) cycle(a, fs);
    const byKey = Object.fromEntries(a.local.map((e) => [e.key, `${e.name}=${e.url}`]));
    assert.deepEqual(byKey, { t1: "B=https://a2.example/", t2: "A=https://b.example/" }, `after ${k} of ${total} changes`);
    assert.equal(fs.files.get("B.webloc")?.url, "https://a2.example/", `after ${k} of ${total} changes`);
    assert.equal(fs.files.get("A.webloc")?.url, "https://b.example/", `after ${k} of ${total} changes`);
    assert.deepEqual(files(fs), ["A.webloc", "B.webloc"], `after ${k} of ${total} changes`);
  }
});

const linkKeys = (entries, out = {}) => {
  for (const e of entries) {
    if (e.kind === "link") out[e.key] = `${e.name}=${e.url}`;
    else linkKeys(e.children, out);
  }
  return out;
};

test("a Finder copy keeps the original's identity: deleting the original never deletes the copy", () => {
  const fs = dir();
  const a = mac([link("t1", "A", "https://a.example/"), link("t2", "Keep", "https://keep.example/")]);
  cycle(a, fs);
  const original = fs.files.get("A.webloc");
  fs.files.set("A copy.webloc", { url: "https://copy.example/", id: original.id });
  a.local = a.local.filter((e) => e.key !== "t1");
  cycle(a, fs);
  cycle(a, fs);
  assert.deepEqual(files(fs), ["A copy.webloc", "Keep.webloc"]);
  assert.equal(fs.files.get("A copy.webloc").url, "https://copy.example/");
  assert.ok(fs.files.get("A copy.webloc").id && fs.files.get("A copy.webloc").id !== original.id, "the copy gets its own identity");
  assert.deepEqual(names(a).sort(), ["A copy", "Keep"]);
});

test("a link a collaborator moves into a subfolder keeps its tab and the local edit made meanwhile", () => {
  const fs = dir();
  const a = mac([link("t1", "A", "https://a.example/"), { kind: "dir", key: "g1", name: "Sub", children: [link("t2", "Essay", "https://essay.example/")] }]);
  cycle(a, fs);
  const sub = fs.files.get("Sub").dir;
  sub.files.set("A.webloc", fs.files.get("A.webloc"));
  fs.files.delete("A.webloc");
  a.local = [{ ...a.local[0], url: "https://a2.example/" }, a.local[1]];
  for (let i = 0; i < 2; i++) cycle(a, fs);
  assert.deepEqual(names(a), ["[Sub: Essay, A]"]);
  assert.deepEqual(linkKeys(a.local), { t1: "A=https://a2.example/", t2: "Essay=https://essay.example/" });
  assert.equal(sub.files.get("A.webloc").url, "https://a2.example/");
  assert.ok(!fs.files.has("A.webloc"));
});

test("a swap of links that have no identity yet (made in Finder), interrupted anywhere in either round, loses no edit", () => {
  const start = () => {
    const fs = dir({ "A.webloc": { url: "https://a.example/" }, "B.webloc": { url: "https://b.example/" } }, ["A.webloc", "B.webloc"]);
    const a = mac([link("t1", "A", "https://a2.example/"), link("t2", "B", "https://b.example/")]);
    a.base = [
      { kind: "link", key: "t1", file: "A.webloc", name: "A", url: "https://a.example/", id: null },
      { kind: "link", key: "t2", file: "B.webloc", name: "B", url: "https://b.example/", id: null },
    ];
    a.local = [link("t1", "B", "https://a2.example/"), link("t2", "A", "https://b.example/")];
    return { fs, a };
  };
  const check = (fs, a, label) => {
    assert.deepEqual(linkKeys(a.local), { t1: "B=https://a2.example/", t2: "A=https://b.example/" }, label);
    assert.equal(fs.files.get("B.webloc")?.url, "https://a2.example/", label);
    assert.equal(fs.files.get("A.webloc")?.url, "https://b.example/", label);
    assert.deepEqual(files(fs), ["A.webloc", "B.webloc"], label);
  };
  for (let round = 0; round < 3; round++) {
    let k = 0;
    for (;;) {
      const { fs, a } = start();
      for (let r = 0; r < round; r++) cycle(a, fs);
      const merged = mergeFolder(a.base, a.local, read(fs));
      const { ops } = planFiles(merged.level, a.base);
      if (k > ops.length) break;
      applyOps(fs, ops.slice(0, k));
      for (let i = 0; i < 4; i++) cycle(a, fs);
      check(fs, a, `round ${round + 1}, after ${k} of ${ops.length} changes`);
      k++;
    }
  }
});

test("two subfolders with the same child name, both renamed elsewhere, keep their own links and a local edit", () => {
  const fs = dir();
  const a = mac([
    { kind: "dir", key: "g1", name: "First", children: [link("t1", "Doc", "https://first.example/")] },
    { kind: "dir", key: "g2", name: "Second", children: [link("t2", "Doc", "https://second.example/")] },
  ]);
  cycle(a, fs);
  fs.files.set("Zebra", fs.files.get("First"));
  fs.files.set("Apple", fs.files.get("Second"));
  fs.files.delete("First");
  fs.files.delete("Second");
  a.local = [{ ...a.local[0], children: [link("t1", "Doc", "https://first-edited.example/")] }, a.local[1]];
  for (let i = 0; i < 2; i++) cycle(a, fs);
  assert.deepEqual(linkKeys(a.local), { t1: "Doc=https://first-edited.example/", t2: "Doc=https://second.example/" });
  assert.equal(fs.files.get("Zebra").dir.files.get("Doc.webloc").url, "https://first-edited.example/");
  assert.equal(fs.files.get("Apple").dir.files.get("Doc.webloc").url, "https://second.example/");
});

test("a Finder copy in another subfolder gets its own identity on first bind, so later edits never cross", () => {
  const fs = dir({ A: { dir: dir({ "Doc.webloc": { url: "https://a.example/", id: "same" } }) }, B: { dir: dir({ "Doc.webloc": { url: "https://b.example/", id: "same" } }) } });
  const a = mac();
  cycle(a, fs);
  const idA = fs.files.get("A").dir.files.get("Doc.webloc").id;
  const idB = fs.files.get("B").dir.files.get("Doc.webloc").id;
  assert.ok(idA && idB && idA !== idB, "the copies end up with distinct identities in the files");
  const baseIds = a.base.flatMap((d) => d.children.map((c) => c.id));
  assert.deepEqual(baseIds.sort(), [idA, idB].sort(), "and in the base");
  const keyB = a.local.find((d) => d.name === "B").children[0].key;
  fs.files.get("A").dir.files.delete("Doc.webloc");
  a.local = a.local.map((d) => (d.name === "B" ? { ...d, children: [{ ...d.children[0], url: "https://b-edited.example/" }] } : d));
  for (let i = 0; i < 2; i++) cycle(a, fs);
  assert.equal(linkKeys(a.local)[keyB], "Doc=https://b-edited.example/");
  assert.equal(fs.files.get("B").dir.files.get("Doc.webloc").url, "https://b-edited.example/");
});

test("a link a collaborator moves into a subfolder the user just deleted keeps its tab and edit", () => {
  const fs = dir();
  const a = mac([link("t1", "A", "https://a.example/"), { kind: "dir", key: "g1", name: "Sub", children: [link("t2", "Essay", "https://essay.example/")] }]);
  cycle(a, fs);
  const sub = fs.files.get("Sub").dir;
  sub.files.set("A.webloc", fs.files.get("A.webloc"));
  fs.files.delete("A.webloc");
  a.local = [link("t1", "A", "https://a2.example/")];
  for (let i = 0; i < 2; i++) cycle(a, fs);
  assert.deepEqual(linkKeys(a.local), { t1: "A=https://a2.example/" });
  assert.deepEqual([...sub.files.keys()], ["A.webloc"], "the folder the user deleted keeps only the moved link");
  assert.equal(sub.files.get("A.webloc").url, "https://a2.example/");
});

test("file names are capped by their UTF-8 bytes, so long titles in any script stay under APFS's 255", async () => {
  const { fileNameFor, uniqueFileName } = await import("./tree.ts");
  const bytes = (s) => Buffer.byteLength(s, "utf8");
  for (const title of ["界".repeat(150), "д".repeat(200), "😀".repeat(80), "a".repeat(300)]) {
    assert.ok(bytes(fileNameFor(title, "link")) <= 255 - 8, `${title.slice(0, 3)}… fits with room for a number`);
    assert.ok(bytes(uniqueFileName(title, "link", new Set([fileNameFor(title, "link").toLowerCase()]))) <= 255);
  }
  assert.ok(!fileNameFor("😀".repeat(80), "link").includes("�"), "never splits a character");
});

test("an order file from a newer version is left alone", async () => {
  const { remoteLevel } = await import("./remote.ts");
  const manifestWrites = (manifest) => {
    const fs = dir({ "A.webloc": { url: "https://a.example/" }, "B.webloc": { url: "https://b.example/" } });
    const m = mac();
    cycle(m, fs);
    m.local = [...m.local].reverse();
    const listing = {
      entries: read(fs).entries.map((e) => ({ kind: "link", file: e.file, text: weblocText(e.url, e.id) })),
      manifest,
      manifestPending: false,
    };
    const { level } = mergeFolder(m.base, m.local, remoteLevel(listing));
    return planFiles(level, m.base).ops.filter((o) => o.op === "write" && o.path === MANIFEST);
  };
  assert.deepEqual(manifestWrites(JSON.stringify({ version: 2, order: ["A.webloc", "B.webloc"] })), []);
  assert.equal(manifestWrites("{").length, 1, "junk is replaced");
});

test("a link needs a host to be shared", async () => {
  const { isShareableUrl } = await import("./remote.ts");
  assert.equal(isShareableUrl("https:///"), false);
  assert.equal(isShareableUrl("https:// x"), false);
  assert.equal(isShareableUrl("https://a.example/"), true);
});

test("only order file version 1 sets the order; older or odd versions read as no order", () => {
  for (const version of [0, -1, 0.5]) assert.equal(parseManifest(JSON.stringify({ version, order: ["a"] })), null, `version ${version}`);
  assert.deepEqual(parseManifest(JSON.stringify({ version: 1, order: ["a"] })), ["a"]);
});

test("a copy left in place with the same identity doesn't keep the tab when the original was moved", () => {
  const fs = dir();
  const a = mac([link("t1", "A", "https://a.example/"), { kind: "dir", key: "g1", name: "Sub", children: [link("t2", "Essay", "https://essay.example/")] }]);
  cycle(a, fs);
  const original = fs.files.get("A.webloc");
  fs.files.get("Sub").dir.files.set("A.webloc", original);
  fs.files.set("A copy.webloc", { url: "https://a.example/", id: original.id });
  fs.files.delete("A.webloc");
  a.local = [{ ...a.local[0], url: "https://a2.example/" }, a.local[1]];
  for (let i = 0; i < 2; i++) cycle(a, fs);
  assert.equal(linkKeys(a.local).t1, "A=https://a2.example/");
  assert.ok(a.local.find((e) => e.kind === "dir").children.some((c) => c.key === "t1"), "the tab followed the original into Sub");
  assert.equal(fs.files.get("Sub").dir.files.get("A.webloc").url, "https://a2.example/");
  assert.ok(fs.files.get("A copy.webloc").id !== original.id, "the copy got its own identity");
});

test("a link still downloading is neither written nor renamed, keeps its identity, and is renamed once it arrives", () => {
  const fs = dir();
  const a = mac([link("t1", "A", "https://a.example/")]);
  cycle(a, fs);
  const t1 = "t1";
  const arrived = fs.files.get("A.webloc");
  fs.files.set("A.webloc", { held: true });
  a.local = [{ ...a.local[0], name: "Renamed" }];
  const { level } = mergeFolder(a.base, a.local, read(fs));
  const { ops, base } = planFiles(level, a.base);
  assert.deepEqual(ops.filter((o) => o.path === "A.webloc"), [], "nothing touches the pending file");
  assert.equal(base[0].id, arrived.id, "its identity is kept");
  assert.equal(base[0].name, "A", "the rename stays pending");
  a.base = base;
  fs.files.set("A.webloc", arrived);
  cycle(a, fs);
  assert.deepEqual(files(fs), ["Renamed.webloc"]);
  assert.equal(linkKeys(a.local)[t1], "Renamed=https://a.example/");
});

test("a Finder copy of a subfolder sorting first doesn't take the original's links", () => {
  const fs = dir();
  const a = mac([{ kind: "dir", key: "g1", name: "Zeta", children: [link("t1", "Doc", "https://doc.example/")] }]);
  cycle(a, fs);
  const zeta = fs.files.get("Zeta").dir;
  fs.files.set("Copy of Zeta", { dir: dir({ "Doc.webloc": { ...zeta.files.get("Doc.webloc") } }) });
  a.local = [{ ...a.local[0], children: [link("t1", "Doc", "https://doc-edited.example/")] }];
  cycle(a, fs);
  assert.equal(zeta.files.get("Doc.webloc").url, "https://doc-edited.example/");
  assert.equal(fs.files.get("Copy of Zeta").dir.files.get("Doc.webloc").url, "https://doc.example/");
});

test("a synced link evicted to an iCloud placeholder counts as waiting", () => {
  const fs = dir();
  const a = mac([link("t1", "A", "https://a.example/")]);
  cycle(a, fs);
  fs.files.set("A.webloc", { held: true });
  assert.equal(mergeFolder(a.base, a.local, read(fs)).waiting, 1);
});

test("a local URL edit to a link still downloading waits for the file, then is written", () => {
  const fs = dir();
  const a = mac([link("t1", "A", "https://a.example/")]);
  cycle(a, fs);
  const arrived = fs.files.get("A.webloc");
  fs.files.set("A.webloc", { held: true });
  a.local = [link("t1", "A", "https://a2.example/")];
  const { conflicts, ops } = cycle(a, fs);
  assert.deepEqual(ops.filter((o) => o.path === "A.webloc"), [], "the placeholder isn't touched");
  assert.deepEqual(conflicts, []);
  assert.equal(a.base[0].url, "https://a.example/", "the base keeps the old URL");
  fs.files.set("A.webloc", arrived);
  cycle(a, fs);
  assert.equal(fs.files.get("A.webloc").url, "https://a2.example/");
});

test("a URL with no host isn't a link", async () => {
  const { isShareableUrl } = await import("./remote.ts");
  for (const url of ["https://?q=1", "https://#x", "https://:443", "ftp://a.example/"]) assert.equal(isShareableUrl(url), false, url);
  assert.equal(isShareableUrl("http://a.example:8080/x"), true);
});
