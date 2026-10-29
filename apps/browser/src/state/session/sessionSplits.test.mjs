import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { flushPersistence, loadSession, startPersistence } = await import("./persist.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const PROFILE = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const IDS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"];
const tab = (id, extra = {}) => ({
  id, windowId: "w1", profileId: "default", url: `https://${id}.com/`, title: id, favicon: null, pinned: false, muted: false, zoom: 1,
  customTitle: null, customIcon: null, pinnedUrl: null, openerId: null, createdAt: 0, lastActiveAt: 0, ...extra,
});
const snap = (u) => ({ url: `https://${u}.com/`, title: u, favicon: null, pinned: true, muted: false, zoom: 1, customTitle: null, customIcon: null, profileId: "default" });

function oldDocument(version) {
  return {
    version,
    profiles: { default: PROFILE },
    profileOrder: ["default"],
    windows: [{ id: "w1", profileId: "default", incognito: false, tabIds: IDS, activeTabIds: { default: "a" }, sidebarOpen: true, frame: null, createdAt: 0 }],
    windowOrder: ["w1"],
    focusedWindowId: "w1",
    tabs: IDS.map((id) => tab(id)),
    groups: [],
    splits: [
      { id: "two", windowId: "w1", tabIds: ["a", "b"], orientation: "horizontal", sizes: [0.7, 0.3] },
      { id: "stacked", windowId: "w1", tabIds: ["c", "d", "e"], orientation: "vertical", sizes: [0.4, 0.6], stack: { index: 1, sizes: [0.2, 0.8] } },
      { id: "atEnd", windowId: "w1", tabIds: ["f", "g", "h"], orientation: "horizontal", sizes: [0.2, 0.3, 0.5], stack: { index: 2, sizes: [0.5, 0.5] } },
      { id: "badSizes", windowId: "w1", tabIds: ["i", "j"], orientation: "horizontal", sizes: [0.5, 0.25, 0.25] },
      { id: "badStack", windowId: "w1", tabIds: ["k", "l", "m"], orientation: "horizontal", sizes: [0.5, 0.5], stack: { index: 0, sizes: ["x", 1] } },
    ],
    closedTabs: [],
    closedWindows: [],
    parkedPins: {
      default: {
        tabs: [
          { ...snap("p1"), id: "p1", groupId: null },
          { ...snap("p2"), id: "p2", groupId: null },
          { ...snap("p3"), id: "p3", groupId: null },
        ],
        groups: [],
        splits: [{ ids: ["p1", "p2", "p3"], orientation: "vertical", sizes: [0.25, 0.75], stack: { index: 1, sizes: [0.6, 0.4] } }],
      },
    },
  };
}

const EXPECTED = {
  two: { orientation: "horizontal", slots: [{ size: 0.7, tabId: "a" }, { size: 0.3, tabId: "b" }] },
  stacked: { orientation: "vertical", slots: [{ size: 0.4, tabId: "c" }, { size: 0.6, stack: ["d", "e"], stackSizes: [0.2, 0.8] }] },
  atEnd: { orientation: "horizontal", slots: [{ size: 0.2, tabId: "f" }, { size: 0.3, tabId: "g" }, { size: 0.5, tabId: "h" }] },
  badSizes: { orientation: "horizontal", slots: [{ size: 0.5, tabId: "i" }, { size: 0.5, tabId: "j" }] },
  badStack: { orientation: "horizontal", slots: [{ size: 0.5, stack: ["k", "l"], stackSizes: [0.5, 0.5] }, { size: 0.5, tabId: "m" }] },
};
const PARKED = [{ orientation: "vertical", slots: [{ size: 0.25, tabId: "p1" }, { size: 0.75, stack: ["p2", "p3"], stackSizes: [0.6, 0.4] }] }];

function assertSplits() {
  const s = S();
  assert.deepEqual(Object.fromEntries(Object.values(s.splits).map(({ id, orientation, slots }) => [id, { orientation, slots }])), EXPECTED);
  assert.deepEqual(s.parkedPins.default.splits, PARKED);
  for (const v of Object.values(s.splits)) for (const k of ["tabIds", "sizes", "stack"]) assert.equal(k in v, false, `${v.id} has ${k}`);
}

for (const version of [2, 3, 4, 5, 6]) {
  test(`a version ${version} session.json loads each split as slots: panes in order, outer sizes, a stack's own sizes`, () => {
    stub.docs.clear();
    stub.docs.set("session.json", JSON.stringify(oldDocument(version)));
    S().hydrate(loadSession());
    assertSplits();
  });
}

test("a stack at the last pane is dropped and every pane kept; sizes that don't fit their panes become equal", () => {
  stub.docs.clear();
  stub.docs.set("session.json", JSON.stringify(oldDocument(6)));
  S().hydrate(loadSession());
  assert.deepEqual(S().splits.atEnd.slots.map((x) => x.tabId), ["f", "g", "h"]);
  assert.deepEqual(S().splits.badSizes.slots.map((x) => x.size), [0.5, 0.5]);
});

test("the slots save as they are and read back the same", () => {
  stub.docs.clear();
  stub.docs.set("session.json", JSON.stringify(oldDocument(6)));
  const stop = startPersistence();
  S().updateTab("b", { title: "touched" });
  flushPersistence();
  stop();
  const saved = JSON.parse(stub.docs.get("session.json"));
  assert.ok(saved.version >= 7);
  assert.deepEqual(saved.splits.find((v) => v.id === "stacked").slots, EXPECTED.stacked.slots);
  S().hydrate(loadSession());
  assertSplits();
});

test("a version 7 split or parked split whose slots don't read is dropped, not half-read", () => {
  stub.docs.clear();
  const doc = oldDocument(7);
  doc.splits = [
    { id: "ok", windowId: "w1", orientation: "horizontal", slots: [{ size: 0.5, tabId: "a" }, { size: 0.5, tabId: "b" }] },
    { id: "bad", windowId: "w1", orientation: "horizontal", slots: [{ size: 0.5, tabId: "c" }, { size: "big", tabId: "d" }] },
  ];
  doc.parkedPins.default.splits = [{ orientation: "vertical", slots: [{ size: 1, stack: ["p1"] }] }];
  stub.docs.set("session.json", JSON.stringify(doc));
  S().hydrate(loadSession());
  assert.deepEqual(Object.keys(S().splits), ["ok"]);
  assert.deepEqual(S().parkedPins.default.splits, []);
});
