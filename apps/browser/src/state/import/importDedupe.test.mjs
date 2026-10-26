import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { importArcSpace, importTabs } = await import("./apply.ts");

const S = () => useBrowser.getState();
const P = "default";

test("re-importing an Arc space adds no pinned tab whose page is already pinned in the profile", () => {
  S().hydrate({});
  S().createWindow({ url: "https://home.example/" });
  const space = {
    id: "s2",
    name: "Home",
    profileId: P,
    tabs: [{ url: "https://open.example/", title: "Open" }],
    pinned: [
      { type: "url", title: "Cal", url: "https://cal.example/" },
      { type: "url", title: "Left", url: "https://left.example/" },
    ],
  };
  const pinnedCount = () => Object.values(S().tabs).filter((t) => t.pinned).length;
  assert.equal(importArcSpace(P, space).tabs, 3);
  const after = pinnedCount();
  const tabCount = Object.keys(S().tabs).length;
  assert.equal(importArcSpace(P, space).tabs, 0);
  assert.equal(pinnedCount(), after, "nothing pinned twice");
  assert.equal(Object.keys(S().tabs).length, tabCount, "nor any open tab");
  assert.equal(importTabs(P, [{ url: "https://CAL.example/#", title: "Cal", pinned: true }, { url: "https://new.example/", title: "N", pinned: true }, { url: "https://new.example/", title: "N", pinned: true }], null), 1);
  assert.equal(pinnedCount(), after + 1);
});

test("an import skips pages already pinned as a tile, in a pinned group or parked with a closed window", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://home.example/" });
  const tile = S().newTab(w, { url: "https://tile.example/", profileId: P });
  const grouped = S().newTab(w, { url: "https://grouped.example/", profileId: P });
  S().pinTabs([tile], true);
  const g = S().createGroup([grouped]);
  S().updateGroup(g, { pinned: true });
  const pins = [
    { url: "https://tile.example/", title: "Tile", pinned: true },
    { url: "https://grouped.example/", title: "Grouped", pinned: true },
  ];
  assert.equal(importTabs(P, pins, null), 0, "tile and pinned group count as pinned");
  S().closeWindow(w);
  assert.ok(S().parkedPins[P]?.tabs.length, "the pins are parked");
  const space = { id: "s3", name: "Home", profileId: P, tabs: [{ url: "https://tile.example/", title: "Tile" }], pinned: pins.map((p) => ({ type: "url", ...p })) };
  assert.equal(importArcSpace(P, space).tabs, 0, "parked pins count, for pins and open tabs alike");
});

test("a link whose scheme is in capitals imports, and counts as the same page", () => {
  S().hydrate({});
  S().createWindow({ url: "https://home.example/" });
  assert.equal(importTabs(P, [{ url: "HTTPS://Upper.example/", title: "Upper", pinned: true }], null), 1);
  assert.equal(importTabs(P, [{ url: "https://upper.example/", title: "Upper", pinned: true }], null), 0);
  assert.equal(importTabs(P, [{ url: "FILE:///tmp/a.html", title: "File", pinned: false }], null), 1);
});

test("an import skips open tabs whose page is already open in the profile, and repeats within it", () => {
  S().hydrate({});
  S().createWindow({ url: "https://home.example/" });
  const open = [
    { url: "https://home.example/", title: "Home", pinned: false },
    { url: "https://a.example/", title: "A", pinned: false },
    { url: "https://A.example/#", title: "A again", pinned: false },
  ];
  const urls = () => Object.values(S().tabs).map((t) => t.url).sort();
  assert.equal(importTabs(P, open, null), 1, "only the new page, once");
  assert.deepEqual(urls(), ["https://a.example/", "https://home.example/"]);
  assert.equal(importTabs(P, open, null), 0, "a second import adds nothing");
  assert.deepEqual(urls(), ["https://a.example/", "https://home.example/"]);
});

test("an Arc favorite imports even when the same page sits in a pinned folder or a pinned row, but not twice as a tile", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://home.example/" });
  const grouped = S().newTab(w, { url: "https://www.youtube.com/", profileId: P });
  const g = S().createGroup([grouped]);
  S().updateGroup(g, { pinned: true });
  const row = S().newTab(w, { url: "https://row.example/", profileId: P });
  S().pinTabs([row], true, true);
  const favorites = [
    { url: "https://www.youtube.com/", title: "YouTube", pinned: true },
    { url: "https://row.example/", title: "Row", pinned: true },
    { url: "https://row.example/", title: "Row again", pinned: true },
  ];
  assert.equal(importTabs(P, favorites, null, "tiles"), 2);
  assert.equal(importTabs(P, favorites, null, "tiles"), 0, "a second import adds no tile");
  assert.equal(importTabs(P, favorites, null), 0, "pinned rows still skip pages pinned anywhere");
  S().closeWindow(w);
  assert.ok(S().parkedPins[P]?.tabs.length, "the pins are parked");
  assert.equal(importTabs(P, favorites, null, "tiles"), 0, "parked tiles count too");
});

test("Arc favorites land as tiles after the space's rows and folders came in", async () => {
  const { applyResult } = await import("./apply.ts");
  S().hydrate({});
  S().createWindow({ url: "https://home.example/" });
  const space = {
    id: "s4",
    name: "Home",
    profileId: P,
    tabs: [],
    pinned: [
      { type: "url", title: "Row", url: "https://row.example/" },
      { type: "folder", title: "Videos", children: [{ type: "url", title: "YouTube", url: "https://www.youtube.com/" }] },
    ],
  };
  importArcSpace(P, space);
  assert.equal(importTabs(P, [{ url: "https://www.youtube.com/", title: "YouTube", pinned: true }], null), 0, "the folder pinned YouTube");
  const favorites = [{ url: "https://www.youtube.com/", title: "YouTube" }, { url: "https://row.example/", title: "Row" }];
  const result = { tabs: [], spaces: [space], favorites, history: [], credentials: [], favicons: [], bookmarks: null, vaultToken: null };
  const counts = await applyResult(P, result, "Arc", []);
  assert.equal(counts.tabs, 2);
  const tiles = Object.values(S().tabs).filter((t) => t.pinned && !t.pinnedAsRow).map((t) => t.url).sort();
  assert.deepEqual(tiles, ["https://row.example/", "https://www.youtube.com/"]);
});
