import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../../state/browser/store.ts");
const { folderMenuItems, stripEntries } = await import("../../state/tabs/topStrip.ts");

const S = () => useBrowser.getState();
const host = (id) => new URL(S().tabs[id].url).hostname.replace(".example", "");

function setup() {
  S().hydrate({});
  const w = S().createWindow({ url: "https://home.example/" });
  const t = (h) => S().newTab(w, { url: `https://${h}.example/`, background: true });
  const [r1, a, b, c, d, r2, x] = ["r1", "a", "b", "c", "d", "r2", "x"].map(t);
  const outer = S().groupTabs([a, b, c, d], { pinned: true, name: "Outer" });
  const inner = S().groupTabs([b, c], { name: "Inner" });
  const deep = S().groupTabs([c], { name: "Deep" });
  S().placeTabs([r1], { pinned: true, row: true, beforeId: null });
  S().placeTabs([r2], { pinned: true, row: true, beforeId: null, last: true });
  return { w, r1, a, b, c, d, r2, x, outer, inner, deep };
}

const shape = (keys) =>
  keys.map((k) => {
    const [kind, id, x, y] = k.split(":");
    if (kind === "pinned") return `dock ${host(id)}`;
    if (kind === "group") return `group ${S().groups[id].name}`;
    if (kind === "folder") return `folder ${S().groups[id].name} [${x.split(",").map(host).join(",")}] in ${S().groups[y].name}`;
    if (kind === "tab") return `tab ${host(id)}${x ? ` in ${S().groups[x].name}` : ""}`;
    return k;
  });

test("the strip shows a root group's nested groups as one folder each, after every pinned tab in its one container", () => {
  const { w } = setup();
  const entries = shape(stripEntries(S(), w, "default"));
  assert.deepEqual(entries.slice(0, 2), ["dock r1", "dock r2"], "rows after a pinned group still join the one pinned container");
  assert.deepEqual(entries.slice(2, 6), ["group Outer", "tab a in Outer", "folder Inner [b,c] in Outer", "tab d in Outer"]);
  assert.ok(entries.includes("tab x"));
});

test("a folder's menu lists its tabs and its nested folders as submenus, the active tab checked", () => {
  const { w, inner, c } = setup();
  S().activate(c);
  const items = folderMenuItems(S(), inner, c);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "b.example");
  assert.equal(items[1].title, "Deep");
  assert.equal(items[1].children.length, 1);
  assert.equal(items[1].children[0].id, `t:${c}`);
  assert.equal(items[1].children[0].checked, true);
  assert.ok(w);
});
