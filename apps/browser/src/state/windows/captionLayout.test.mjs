import assert from "node:assert/strict";
import { test } from "node:test";
const { cardCaptionRoom, cardTopInset, sidebarCaptionRoom } = await import("./layout.ts");
const { SMALL_BAR_HEIGHT, SMALL_WINDOW_BAR_HEIGHT } = await import("./small.ts");
const windows = (await import("../../lib/platformChrome.windows.ts")).WINDOW_CHROME;

const SETTINGS = { tabLayout: "sidebar", sidebarSide: "left", addressBar: "toolbar", compactToolbar: false, hideToolbarWhileScrolling: false };
function state(settings = {}, window = {}) {
  return {
    windows: { w: { id: "w", kind: "main", sidebarOpen: true, fullScreen: false, ...window } },
    windowOrder: ["w"],
    ui: { focusOrder: ["w"] },
    settings: { ...SETTINGS, ...settings },
  };
}

const LAYOUTS = [
  [{}, {}],
  [{ compactToolbar: true }, {}],
  [{ addressBar: "sidebar" }, {}],
  [{ sidebarSide: "right" }, {}],
  [{ sidebarSide: "right" }, { sidebarOpen: false }],
  [{ tabLayout: "top" }, {}],
  [{ hideToolbarWhileScrolling: true }, {}],
  [{}, { fullScreen: true }],
];

test("on the Mac no layout gives the card, the toolbar or the sidebar any caption room", () => {
  for (const [settings, window] of LAYOUTS) {
    const s = state(settings, window);
    assert.equal(cardCaptionRoom(s, "w", 9, 42), 0);
    assert.equal(cardTopInset(s, "w", 9), 9);
    assert.equal(sidebarCaptionRoom(s, "w"), 0);
  }
  assert.equal(SMALL_WINDOW_BAR_HEIGHT, SMALL_BAR_HEIGHT);
  assert.equal(SMALL_BAR_HEIGHT, 38);
});

test("on Windows the card's top row makes room for the caption buttons wherever the card reaches them", () => {
  const room = (settings, window, frame = 9) => cardCaptionRoom(state(settings, window), "w", frame, 42, windows);
  assert.equal(room({}, {}), 129);
  assert.equal(room({}, {}, 0), 138);
  assert.equal(room({ tabLayout: "top" }, {}), 0);
  assert.equal(room({ tabLayout: "top" }, { sidebarOpen: false }), 129);
  assert.equal(room({ sidebarSide: "right" }, {}), 0);
  assert.equal(room({ sidebarSide: "right" }, { sidebarOpen: false }), 129);
  assert.equal(room({}, { fullScreen: true }), 0);
  assert.equal(room({}, { kind: "small" }), 0);
});

test("on Windows a card without a tall enough toolbar starts below the caption buttons", () => {
  const top = (settings, window) => cardTopInset(state(settings, window), "w", 9, windows);
  assert.equal(top({}, {}), 9);
  assert.equal(top({ compactToolbar: true }, {}), 9);
  assert.equal(top({ addressBar: "sidebar" }, {}), 32);
  assert.equal(top({ hideToolbarWhileScrolling: true }, {}), 32);
  assert.equal(top({ addressBar: "sidebar", sidebarSide: "right" }, {}), 9);
  assert.equal(top({ tabLayout: "top" }, {}), 9);
  assert.equal(top({ addressBar: "sidebar" }, { fullScreen: true }), 9);
});

test("on Windows a sidebar on the right keeps its header out from under the caption buttons", () => {
  assert.equal(sidebarCaptionRoom(state({ sidebarSide: "right" }), "w", windows), 138);
  assert.equal(sidebarCaptionRoom(state({}), "w", windows), 0);
  assert.equal(sidebarCaptionRoom(state({ sidebarSide: "right" }, { fullScreen: true }), "w", windows), 0);
});
