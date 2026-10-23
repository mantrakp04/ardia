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
