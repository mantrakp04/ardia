import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { importArcSpace } = await import("./apply.ts");

const S = () => useBrowser.getState();
const P = "default";
const link = (url) => ({ type: "url", title: url, url });
const folder = (title, children, collapsed) => ({ type: "folder", title, children, ...(collapsed === undefined ? {} : { collapsed }) });

function start() {
  S().hydrate({});
  return S().createWindow({ url: "https://start.example/" });
}

test("an Arc folder comes over open or closed as Arc showed it, nested ones included, and open when Arc didn't say", () => {
  start();
  importArcSpace(P, {
    id: "S1",
    name: "One",
    profileId: P,
    tabs: [],
    pinned: [
      folder("Open", [link("https://one.example/"), folder("Inner", [link("https://two.example/")], true)], false),
      folder("Shut", [link("https://three.example/")], true),
      folder("Unknown", [link("https://four.example/")]),
    ],
  });
  const collapsed = Object.fromEntries(Object.values(S().groups).map((g) => [g.name, g.collapsed]));
  assert.deepEqual(collapsed, { Open: false, Inner: true, Shut: true, Unknown: false });
});

test("a space whose pinned section Arc collapsed comes over collapsed, and the others stay open", () => {
  start();
  const work = S().createProfile({ name: "Work" });
  importArcSpace(P, { id: "S1", name: "One", profileId: P, tabs: [], pinned: [link("https://one.example/")], pinnedCollapsed: false });
  importArcSpace(work, {
    id: "S2",
    name: "Two",
    profileId: work,
    tabs: [],
    pinned: [link("https://two.example/"), folder("F", [link("https://three.example/")])],
    pinnedCollapsed: true,
  });
  assert.equal(!!S().profiles[P].pinnedCollapsed, false);
  assert.equal(S().profiles[work].pinnedCollapsed, true);
});
