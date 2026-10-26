import assert from "node:assert/strict";
import { test } from "node:test";
import { byDay } from "./state.ts";

test("archived items group by day, newest first", () => {
  const now = new Date(2026, 9, 24, 15, 0);
  const at = (d, h = 10) => new Date(2026, 9, d, h).getTime();
  const items = [{ t: at(24, 9) }, { t: at(23) }, { t: at(24, 14) }, { t: at(20) }, { t: at(12) }, { t: new Date(2026, 7, 2).getTime() }];
  const groups = byDay(items, (i) => i.t, now);
  assert.deepEqual(groups.map((g) => [g.title, g.items.length]), [
    ["Today", 2],
    ["Yesterday", 1],
    ["4 days ago", 1],
    ["Last week", 1],
    [new Date(2026, 7, 2).toLocaleDateString(undefined, { month: "long", year: "numeric" }), 1],
  ]);
  assert.equal(groups[0].items[0].t, at(24, 14), "newest first within a day");
});

test("Archived Tabs shows only this space's closed tabs, never a private window's", async () => {
  const { archivedFor } = await import("./state.ts");
  const closed = [
    { kind: "tab", tab: { profileId: "default", url: "https://a.example/" } },
    { kind: "tab", tab: { profileId: "incognito:1@", url: "https://secret.example/" } },
    { kind: "tab", tab: { profileId: "work", url: "https://w.example/" } },
    { kind: "window", tab: { profileId: "default", url: "https://win.example/" } },
  ];
  assert.deepEqual(archivedFor(closed, "default").map((c) => c.tab.url), ["https://a.example/"]);
  assert.deepEqual(archivedFor(closed, undefined), []);
});

test("the Library never opens in a private window", async () => {
  const { useBrowser } = await import("../../store/browser.ts");
  const { openLibrary, librarySection } = await import("./state.ts");
  useBrowser.getState().hydrate({});
  const normal = useBrowser.getState().createWindow({ url: "https://a.example/" });
  const secret = useBrowser.getState().createWindow({ incognito: true, url: "https://b.example/" });
  openLibrary(secret, "archive");
  assert.equal(librarySection(secret), undefined);
  openLibrary(normal, "archive");
  assert.equal(librarySection(normal), "archive");
});

test("Archived Tabs shows only this space's cleaned-up tabs", async () => {
  const { cleanedIn } = await import("./state.ts");
  const cleaned = [{ tab: { profileId: "default", url: "https://a.example/" } }, { tab: { profileId: "work", url: "https://w.example/" } }];
  assert.deepEqual(cleanedIn(cleaned, "default").map((c) => c.tab.url), ["https://a.example/"]);
  assert.deepEqual(cleanedIn(cleaned, undefined), []);
});
