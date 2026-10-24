import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../../store/browser.ts");
const { overviewSections, filterSections } = await import("./model.ts");

const S = () => useBrowser.getState();
const shape = (sections) => sections.map((sec) => [sec.title, sec.items.map((i) => (i.kind === "tab" ? S().tabs[i.id].url : `${i.name}[${i.tabIds.map((id) => S().tabs[id].url).join(",")}]`))]);

test("the overview shows pinned folders, then pinned tabs, then open tabs, for the shown space only", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://open.example/" });
  const tile = S().newTab(w, { url: "https://tile.example/" });
  S().pinTabs([tile], true);
  const a = S().newTab(w, { url: "https://a.example/" });
  const b = S().newTab(w, { url: "https://b.example/" });
  const g = S().createGroup([a, b], { name: "Web Development" });
  S().updateGroup(g, { pinned: true });
  const other = S().createProfile({ name: "Other" });
  S().newTab(w, { url: "https://elsewhere.example/", profileId: other, background: true });
  assert.deepEqual(shape(overviewSections(S(), w)), [
    ["Pinned Folders", ["Web Development[https://a.example/,https://b.example/]"]],
    ["Pinned", ["https://tile.example/"]],
    ["Open", ["https://open.example/"]],
  ]);
});

test("search keeps a folder by its name, or with only the tabs that match", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://open.example/" });
  const a = S().newTab(w, { url: "https://react.dev/" });
  const b = S().newTab(w, { url: "https://hono.dev/" });
  const g = S().createGroup([a, b], { name: "Helpful Tools" });
  S().updateGroup(g, { pinned: true });
  const sections = overviewSections(S(), w);
  const by = (q) => (id) => S().tabs[id].url.includes(q);
  assert.deepEqual(shape(filterSections(sections, by("hono"), "hono")), [["Pinned Folders", ["Helpful Tools[https://hono.dev/]"]]]);
  assert.deepEqual(shape(filterSections(sections, by("helpful"), "helpful")), [["Pinned Folders", ["Helpful Tools[https://react.dev/,https://hono.dev/]"]]]);
  assert.deepEqual(filterSections(sections, by("zzz"), "zzz"), []);
});
