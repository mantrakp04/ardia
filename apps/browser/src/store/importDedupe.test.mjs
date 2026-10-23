import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const { importArcSpace, importTabs } = await import("../components/import/apply.ts");

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
