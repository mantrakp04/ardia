import assert from "node:assert/strict";
import { test } from "node:test";
const { cardCaptionRoom, cardTopInset, sidebarCaptionRoom, titleBandFree } = await import("./layout.ts");
const { SMALL_BAR_HEIGHT, SMALL_WINDOW_BAR_HEIGHT } = await import("./small.ts");
const windows = (await import("../../lib/platformChrome.windows.ts")).WINDOW_CHROME;
const mac = (await import("../../lib/platformChrome.ts")).WINDOW_CHROME;
const { littleArdiaBarLayout } = await import("../../components/littleArdia/barLayout.ts");
const { SMALL_FIELD_HEIGHT, SMALL_BAR_BUTTON } = await import("../../components/littleArdia/tokens.ts");
const { trailingClearance } = await import("../../lib/windowChrome.ts");
const macFeatures = (await import("../../lib/platformFeatures.ts")).PLATFORM_FEATURES;
const windowsFeatures = (await import("../../lib/platformFeatures.windows.ts")).PLATFORM_FEATURES;

const SETTINGS = { tabLayout: "sidebar", sidebarSide: "left", addressBar: "toolbar", compactToolbar: false, hideToolbarWhileScrolling: false };
function state(settings = {}, window = {}, extra = {}) {
  return {
    windows: { w: { id: "w", kind: "main", profileId: "p", sidebarOpen: true, fullScreen: false, ...window } },
    windowOrder: ["w"],
    ui: { focusOrder: ["w"] },
    profiles: { p: { id: "p", name: "Personal" } },
    profileOrder: ["p"],
    downloads: [],
    windowUi: {},
    ...extra,
    settings: { pageFrame: 9, ...SETTINGS, ...settings },
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

test("the Mac never asks for a caption title band", () => {
  for (const [settings, window] of LAYOUTS) {
    assert.equal(titleBandFree(state(settings, window), "w"), false);
    assert.equal(titleBandFree(state({ ...settings, hideToolbarWhileScrolling: true }, window), "w"), false);
  }
});

const DEFAULT_LAYOUT = { hideToolbarWhileScrolling: true };
const bandFree = (settings = {}, window = {}, extra = {}, overlaid = false) =>
  titleBandFree(state({ ...DEFAULT_LAYOUT, ...settings }, window, extra), "w", overlaid, windows);

test("on Windows the default layout leaves the title band free for Windows' own caption", () => {
  assert.equal(bandFree(), true);
  assert.equal(bandFree({ compactToolbar: true }), true);
  assert.equal(bandFree({ pageFrame: 0 }), true);
  assert.equal(bandFree({}, { sidebarOpen: false }), true);
  assert.equal(bandFree({ sidebarSide: "right" }, { sidebarOpen: false }), true);
});

test("on Windows any layout that puts a control in the title band keeps the band for the UI", () => {
  assert.equal(bandFree({ hideToolbarWhileScrolling: false }), false, "the toolbar starts inside the band");
  assert.equal(bandFree({ tabLayout: "top" }), false, "the top tab strip fills the band");
  assert.equal(bandFree({ tabLayout: "top" }, { sidebarOpen: false }), false, "the top strip's peek and toolbar reach the band");
  assert.equal(bandFree({}, { tabLayout: "top" }), false, "a window with its own top tab layout");
  assert.equal(bandFree({ sidebarSide: "right" }), false, "a sidebar on the right puts the card's toolbar in the band");
  assert.equal(bandFree({ addressBar: "sidebar" }), false, "the sidebar's address row and header tools sit in the band");
  assert.equal(bandFree({}, { kind: "small" }), false, "Little Ardia's bar is the band");
  assert.equal(bandFree({}, { fullScreen: true }), false, "full screen has no title band");
  assert.equal(bandFree({}, { kind: "private" }), false, "the incognito indicator sits in the sidebar header");
  assert.equal(bandFree({}, {}, { profiles: { p: { id: "p" }, q: { id: "q" } }, profileOrder: ["p", "q"] }), false, "the profile indicator sits in the sidebar header");
  assert.equal(bandFree({}, {}, { downloads: [{ id: "d", profile: "p", state: "complete" }] }), false, "the downloads button sits in the sidebar header");
  assert.equal(bandFree({}, {}, { windowUi: { w: { panel: { open: true, initialText: "" }, downloadsOpen: false } } }), false, "the command panel can rise into the band");
  assert.equal(bandFree({}, {}, { windowUi: { w: { panel: { open: false, initialText: "" }, downloadsOpen: true } } }), false, "the downloads popover");
  assert.equal(bandFree({}, {}, {}, true), false, "an overlay such as onboarding covers the band");
  assert.equal(titleBandFree(state(DEFAULT_LAYOUT), "missing", false, windows), false, "a window that does not exist");
});

test("on the Mac Little Ardia's bar keeps its numbers", () => {
  const bar = { height: 38, navLeft: 79, navPitch: 30, fieldLeft: 143, fieldTop: 5, buttonTop: 5, trailingRoom: 0, controlsRight: 9 };
  assert.deepEqual(littleArdiaBarLayout(mac), bar);
  assert.deepEqual(littleArdiaBarLayout(), bar);
  assert.equal(SMALL_FIELD_HEIGHT, 28);
  assert.equal(SMALL_BAR_BUTTON, 28);
});

test("on Windows Little Ardia's bar starts at the window's left edge and its controls end before the caption buttons", () => {
  const bar = littleArdiaBarLayout(windows);
  assert.deepEqual(bar, { height: 38, navLeft: 9, navPitch: 30, fieldLeft: 73, fieldTop: 5, buttonTop: 5, trailingRoom: 138, controlsRight: 147 });
  assert.ok(bar.controlsRight >= windows.trailingWidth, "the copy, open and profile buttons stay left of minimize, maximize and close");
  assert.ok(bar.fieldTop >= 0 && bar.fieldTop + SMALL_FIELD_HEIGHT <= bar.height, "the field sits inside the bar");
  assert.ok(bar.height >= windows.titleBarHeight, "the bar covers the whole title band");
});

test("the command panel keeps the Mac's 16 pt right margin and clears Windows' caption buttons while it sits in the title band", () => {
  for (const top of [0.5, 5, 31, 32, 60]) assert.equal(trailingClearance(top, 16, mac), 16);
  assert.equal(trailingClearance(0.5, 16, windows), 138);
  assert.equal(trailingClearance(5, 16, windows), 138);
  assert.equal(trailingClearance(31.5, 16, windows), 138);
  assert.equal(trailingClearance(32, 16, windows), 16);
  assert.equal(trailingClearance(60, 16, windows), 16);
});

test("the command panel grows from its field on the Mac and opens in place on Windows", () => {
  assert.equal(macFeatures.panelGrowsFromField, true);
  assert.equal(windowsFeatures.panelGrowsFromField, false);
});
