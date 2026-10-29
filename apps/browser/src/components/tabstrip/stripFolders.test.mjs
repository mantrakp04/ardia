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

const member = (m) =>
  m.kind === "folder"
    ? `folder ${S().groups[m.id].name} [${m.tabIds.map(host).join(",")}] in ${S().groups[m.group].name}`
    : `${m.kind} ${host(m.id)}${m.group ? ` in ${S().groups[m.group].name}` : ""}`;

const shape = (entries) =>
  entries.flatMap((e) => {
    if (e.kind === "dock") return e.ids.map((id) => `dock ${host(id)}`);
    if (e.kind === "group") return [`group ${S().groups[e.id].name}`, ...e.members.map(member)];
    return [member(e)];
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
  assert.equal(items[1].children[0].value.tabId, c);
  assert.equal(items[1].children[0].checked, true);
  assert.ok(w);
});
