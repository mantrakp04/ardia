import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { importArcSpace } = await import("./apply.ts");
const { splitTabIds } = await import("../splits/splits.ts");
const { isPinnedRow } = await import("../browser/model.ts");

const S = () => useBrowser.getState();
const P = "default";
const link = (url, title = url) => ({ type: "url", title, url });
const split = (...children) => ({ type: "folder", title: "", role: "split", children });

const home = () => ({
  id: "S-HOME",
  name: "Home",
  profileId: P,
  pinned: [
    link("https://mail.example/", "Mail"),
    split(link("https://docs.example/a", "Doc A"), link("https://mail.example/", "Mail again")),
    { type: "folder", title: "Projects", children: [link("https://project.example/"), split(link("https://spec.example/"), link("https://figma.example/"))] },
    { type: "url", title: "Cal", pageTitle: "Calendar", url: "https://calendar.example/" },
  ],
  tabs: [
    { url: "https://news.example/", title: "News", pinned: false, windowIndex: 0, active: false },
    ...["one", "two", "three"].map((n) => ({ url: `https://${n}.example/`, title: n, pinned: false, splitId: "H-USV", windowIndex: 0, active: false })),
  ],
});

const urlsOf = (split) => splitTabIds(split).map((id) => S().tabs[id].url);
const splitUrls = () => Object.values(S().splits).map(urlsOf).sort((a, z) => a[0].localeCompare(z[0]));

function start() {
  S().hydrate({});
  return S().createWindow({ url: "https://start.example/" });
}

test("an Arc space brings its top-level pinned tabs over as pinned rows", () => {
  start();
  importArcSpace(P, home());
  const rows = Object.values(S().tabs).filter((t) => isPinnedRow(t)).map((t) => t.url).sort();
  assert.deepEqual(rows, ["https://calendar.example/", "https://docs.example/a", "https://mail.example/", "https://mail.example/"]);
  const cal = Object.values(S().tabs).find((t) => t.url === "https://calendar.example/");
  assert.equal(cal.customTitle, "Cal");
});

test("Arc split views come over as Ardia splits, pinned, in a folder and among the open tabs", () => {
  start();
  const r = importArcSpace(P, home());
  assert.deepEqual(splitUrls(), [
    ["https://docs.example/a", "https://mail.example/"],
    ["https://one.example/", "https://two.example/", "https://three.example/"],
    ["https://spec.example/", "https://figma.example/"],
  ]);
  const [pinnedSplit] = Object.values(S().splits).filter((v) => splitTabIds(v).every((id) => isPinnedRow(S().tabs[id])));
  assert.ok(pinnedSplit, "the top-level split is a split of pinned rows");
  const projects = Object.values(S().groups).find((g) => g.name === "Projects");
  assert.ok(projects?.pinned);
  const inFolder = Object.values(S().splits).find((v) => urlsOf(v)[0] === "https://spec.example/");
  assert.ok(splitTabIds(inFolder).every((id) => projects.tabIds.includes(id)), "the folder's split stays in its group");
  const imported = Object.values(S().groups).find((g) => g.name === "Imported");
  const openSplit = Object.values(S().splits).find((v) => urlsOf(v)[0] === "https://one.example/");
  assert.ok(splitTabIds(openSplit).every((id) => imported.tabIds.includes(id) && !S().tabs[id].pin));
  assert.equal(r.tabs, 11);
});

test("importing the same space again adds no tab and no split", () => {
  start();
  importArcSpace(P, home());
  const tabs = Object.keys(S().tabs).length;
  const splits = Object.keys(S().splits).length;
  assert.equal(importArcSpace(P, home()).tabs, 0);
  assert.equal(Object.keys(S().tabs).length, tabs);
  assert.equal(Object.keys(S().splits).length, splits);
});

test("a split keeps every pane even when one of its pages is already pinned", () => {
  const w = start();
  const t = S().newTab(w, { url: "https://figma.example/", profileId: P });
  S().pinTabs([t], true, true);
  importArcSpace(P, home());
  assert.ok(splitUrls().some((u) => u.join() === "https://spec.example/,https://figma.example/"));
});

test("an Arc split of four panes becomes a split of three and a tab beside it", () => {
  start();
  const four = split(...["a", "b", "c", "d"].map((n) => link(`https://${n}.example/`)));
  importArcSpace(P, { id: "S-WORK", name: "Work", profileId: P, pinned: [four], tabs: [] });
  assert.deepEqual(splitUrls(), [["https://a.example/", "https://b.example/", "https://c.example/"]]);
  assert.ok(isPinnedRow(Object.values(S().tabs).find((t) => t.url === "https://d.example/")));
});
