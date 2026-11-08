import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../browser/store.ts");
const hover = await import("../sidebar/hover.ts");
const { commandBarOpenedProperties } = await import("./commandBarOpened.ts");

const S = () => useBrowser.getState();
const tab = (id, windowId, profileId) => ({
  id, windowId, profileId, url: "https://a.com/", title: "", favicon: null, pin: null, muted: false, zoom: 1, customTitle: null, customIcon: null,
  pinnedUrl: null, page: { kind: "idle" }, openerId: null, createdAt: 0, lastActiveAt: 0,
});
const PROFILES = {
  default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
  work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 0 },
};
const drawnPanel = { open: true, newTab: false, centred: false, hasActiveTab: true, sidebarAnchor: true };

function hydrate(profileId, activeTabIds) {
  S().hydrate({ profiles: PROFILES });
  useBrowser.setState({
    windows: { w: { id: "w", profileId, kind: "main", tabIds: ["a"], activeTabIds, sidebarOpen: true, frame: null, createdAt: 0 } },
    tabs: { a: tab("a", "w", "default") },
  });
}

test("a window with an active tab in its profile reports a drawn panel and the rows it holds covered", () => {
  hydrate("default", { default: "a" });
  hover.setRowsCovered("w", false);
  assert.deepEqual(commandBarOpenedProperties(S(), "w"), { drawn: true, rows_covered: false });
  hover.setRowsCovered("w", hover.panelCoversRows(drawnPanel));
  assert.deepEqual(commandBarOpenedProperties(S(), "w"), { drawn: true, rows_covered: true });
  hover.setRowsCovered("w", false);
});

test("an open panel in a profile with no active tab draws nothing and holds no rows", () => {
  hydrate("work", { default: "a" });
  hover.setRowsCovered("w", hover.panelCoversRows({ ...drawnPanel, hasActiveTab: false }));
  assert.deepEqual(commandBarOpenedProperties(S(), "w"), { drawn: false, rows_covered: false });
});

test("a panel that unmounts while covering the rows no longer reports them covered", () => {
  hydrate("default", { default: "a" });
  const release = hover.holdRowsCovered("w", true);
  assert.equal(commandBarOpenedProperties(S(), "w").rows_covered, true);
  release();
  assert.equal(commandBarOpenedProperties(S(), "w").rows_covered, false);
});
