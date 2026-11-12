import assert from "node:assert/strict";
import { test } from "node:test";
const { cardCaptionRoom, cardTopInset, sidebarCaptionRoom, captionRegions, windowControlsPlace, windowControlsBottom, sidebarHeaderCollapsed, downloadsInSidebarFooter, collapsedSidebarHeader } = await import("./layout.ts");
const { SMALL_BAR_HEIGHT, SMALL_WINDOW_BAR_HEIGHT } = await import("./small.ts");
const windows = (await import("../../lib/platformChrome.windows.ts")).WINDOW_CHROME;
const mac = (await import("../../lib/platformChrome.ts")).WINDOW_CHROME;
const { littleArdiaBarLayout } = await import("../../components/littleArdia/barLayout.ts");
const { SMALL_FIELD_HEIGHT, SMALL_BAR_BUTTON } = await import("../../components/littleArdia/tokens.ts");
const { BROWSER_WINDOW_BUTTONS, trailingClearance, WINDOW_CONTROLS, windowControlsWidth } = await import("../../lib/windowChrome.ts");
const { syncCaptionRegions } = await import("./captionRegions.ts");
const macFeatures = (await import("../../lib/platformFeatures.ts")).PLATFORM_FEATURES;
const windowsFeatures = (await import("../../lib/platformFeatures.windows.ts")).PLATFORM_FEATURES;

const SETTINGS = { tabLayout: "sidebar", sidebarSide: "left", addressBar: "toolbar", compactToolbar: false, hideToolbarWhileScrolling: false, autoHideTabs: false };
function state(settings = {}, window = {}, extra = {}) {
  return {
    windows: { w: { id: "w", kind: "main", profileId: "p", fullScreen: false, ...window } },
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
  [{ sidebarSide: "right", autoHideTabs: true }, {}],
  [{ tabLayout: "top" }, {}],
  [{ hideToolbarWhileScrolling: true }, {}],
  [{}, { fullScreen: true }],
];

test("on the Mac no layout gives the card, the toolbar or the sidebar any caption room, window buttons or caption regions", () => {
  for (const [settings, window] of LAYOUTS) {
    const s = state(settings, window);
    assert.equal(cardCaptionRoom(s, "w", 9), 0);
    assert.equal(cardTopInset(s, "w", 9), 9);
    assert.equal(sidebarCaptionRoom(s, "w"), 0);
    assert.equal(windowControlsPlace(s, "w", 9), null);
    assert.deepEqual(captionRegions(s, "w"), []);
    assert.equal(sidebarHeaderCollapsed(s, "w"), false);
    assert.equal(downloadsInSidebarFooter(s, "w"), settings.addressBar === "sidebar");
  }
  assert.equal(SMALL_WINDOW_BAR_HEIGHT, SMALL_BAR_HEIGHT);
  assert.equal(SMALL_BAR_HEIGHT, 38);
});

test("on Windows the card's top row makes room for the window buttons wherever the card reaches them", () => {
  const room = (settings, window, frame = 9) => cardCaptionRoom(state(settings, window), "w", frame, windows);
  assert.equal(room({}, {}), 162);
  assert.equal(room({}, {}, 0), 171);
  assert.equal(room({ tabLayout: "top" }, {}), 0);
  assert.equal(room({ tabLayout: "top", autoHideTabs: true }, {}), 162);
  assert.equal(room({ sidebarSide: "right" }, {}), 0);
  assert.equal(room({ sidebarSide: "right", autoHideTabs: true }, {}), 162);
  assert.equal(room({}, { fullScreen: true }), 0);
  assert.equal(room({}, { kind: "small" }), 0);
});

test("on Windows the room the toolbar keeps holds the buttons, their edge and a gap to drag by", () => {
  const taken = WINDOW_CONTROLS.edge + windowControlsWidth(BROWSER_WINDOW_BUTTONS);
  assert.equal(taken, 141);
  assert.ok(windows.trailingWidth - taken >= 24, "at least 24 points beside the buttons stay free to drag the window by");
});

test("on Windows the card starts at the page frame whenever it has a toolbar, also one that hides while scrolling", () => {
  const top = (settings, window) => cardTopInset(state(settings, window), "w", 9, windows);
  assert.equal(top({}, {}), 9);
  assert.equal(top({ compactToolbar: true }, {}), 9);
  assert.equal(top({ hideToolbarWhileScrolling: true }, {}), 9);
  assert.equal(top({ hideToolbarWhileScrolling: true, compactToolbar: true }, {}), 9);
  assert.equal(top({ hideToolbarWhileScrolling: true, autoHideTabs: true }, {}), 9);
  assert.equal(top({ addressBar: "sidebar", sidebarSide: "right" }, {}), 9);
  assert.equal(top({ tabLayout: "top" }, {}), 9);
  assert.equal(top({ addressBar: "sidebar" }, { fullScreen: true }), 9);
});

test("on Windows only a card with no toolbar under the window buttons leaves them a band", () => {
  const top = (settings, window) => cardTopInset(state(settings, window), "w", 9, windows);
  assert.equal(top({ addressBar: "sidebar" }, {}), 32);
});

test("on Windows a sidebar on the right keeps its header out from under the window buttons", () => {
  assert.equal(sidebarCaptionRoom(state({ sidebarSide: "right" }), "w", windows), 171);
  assert.equal(sidebarCaptionRoom(state({}), "w", windows), 0);
  assert.equal(sidebarCaptionRoom(state({ sidebarSide: "right" }, { fullScreen: true }), "w", windows), 0);
});

const place = (settings = {}, window = {}, frame = 9) => windowControlsPlace(state(settings, window), "w", frame, windows);

test("on Windows the window buttons sit in the row that reaches the window's top right corner", () => {
  assert.deepEqual(place(), { centerY: 30.2, size: 30, host: "toolbar" });
  assert.deepEqual(place({ hideToolbarWhileScrolling: true }), { centerY: 30.2, size: 30, host: "toolbar" });
  assert.deepEqual(place({ compactToolbar: true }), { centerY: 23, size: 22, host: "toolbar" });
  assert.deepEqual(place({}, {}, 0), { centerY: 21.2, size: 30, host: "toolbar" });
  assert.deepEqual(place({ autoHideTabs: true }, {}), { centerY: 30.2, size: 30, host: "toolbar" });
  assert.deepEqual(place({ sidebarSide: "right" }), { centerY: 30, size: 30, host: "sidebar" });
  assert.deepEqual(place({ sidebarSide: "right", autoHideTabs: true }, {}), { centerY: 30.2, size: 30, host: "toolbar" });
  assert.deepEqual(place({ sidebarSide: "right", addressBar: "sidebar" }), { centerY: 24, size: 30, host: "sidebar" });
  assert.deepEqual(place({ addressBar: "sidebar" }), { centerY: 16, size: 26, host: "band" });
  assert.deepEqual(place({ tabLayout: "top" }), { centerY: 20.75, size: 30, host: "strip" });
  assert.deepEqual(place({ tabLayout: "top", autoHideTabs: true }, {}), { centerY: 30.2, size: 30, host: "toolbar" });
  assert.deepEqual(place({}, { kind: "small" }), { centerY: 19, size: 28, host: "strip" });
  assert.equal(place({}, { fullScreen: true }), null);
  assert.equal(windowControlsPlace(state(), "missing", 9, windows), null);
});

test("on Windows the window buttons stay inside their row and clear of a band-less card's corner", () => {
  for (const [settings, window] of LAYOUTS) {
    const at = place(settings, window);
    if (!at) continue;
    assert.ok(at.centerY - at.size / 2 >= 0, `the buttons start inside the window: ${JSON.stringify([settings, window, at])}`);
    assert.equal(windowControlsBottom(at), at.centerY + at.size / 2);
  }
  assert.equal(windowControlsBottom(null), 0);
});

const regions = (settings = {}, window = {}, extra = {}, overlaid = false) => captionRegions(state(settings, window, extra), "w", overlaid, windows);
const SPACER = [-169, 0, 144];

test("on Windows the gap beside the window buttons and the gutter above the card are caption regions", () => {
  assert.deepEqual(regions(), [[...SPACER, 45.2], [0, 0, 0, 9]]);
  assert.deepEqual(regions({ compactToolbar: true }), [[...SPACER, 34], [0, 0, 0, 9]]);
  assert.deepEqual(regions({ pageFrame: 0 }), [[...SPACER, 36.2]]);
  assert.deepEqual(regions({ pageFrame: 12 }), [[...SPACER, 48.2], [0, 0, 0, 12]]);
  assert.deepEqual(regions({ sidebarSide: "right" }), [[...SPACER, 45], [0, 0, 0, 9]]);
  assert.deepEqual(regions({ sidebarSide: "right", addressBar: "sidebar" }), [[...SPACER, 39], [0, 0, 0, 7]]);
  assert.deepEqual(regions({ addressBar: "sidebar" }), [[...SPACER, 29]]);
  assert.deepEqual(regions({ tabLayout: "top" }), [[...SPACER, 35.75]]);
  assert.deepEqual(regions({}, { kind: "small" }), [[...SPACER, 33]]);
});

test("on Windows a caption region never covers the window buttons or reaches below their row", () => {
  for (const [settings, window] of LAYOUTS) {
    const at = place(settings, window);
    for (const [left, top, rightInset, height] of regions(settings, window)) {
      assert.equal(top, 0);
      if (left === 0) assert.ok(height < at.centerY - at.size / 2, `the gutter stops above the buttons: ${JSON.stringify([settings, window])}`);
      else assert.ok(rightInset > WINDOW_CONTROLS.edge + windowControlsWidth(BROWSER_WINDOW_BUTTONS), `the spacer stops before the buttons: ${JSON.stringify([settings, window])}`);
      assert.ok(height <= windowControlsBottom(at));
    }
  }
});

test("on Windows nothing is a caption region while something can cover it, or in full screen", () => {
  assert.deepEqual(regions({}, { fullScreen: true }), []);
  assert.deepEqual(regions({}, {}, { windowUi: { w: { panel: { open: true, initialText: "" }, downloadsOpen: false } } }), [], "the command panel");
  assert.deepEqual(regions({}, {}, { windowUi: { w: { panel: { open: false, initialText: "" }, downloadsOpen: true } } }), [], "the downloads popover");
  assert.deepEqual(regions({}, {}, {}, true), [], "an overlay such as onboarding");
  assert.deepEqual(captionRegions(state(), "missing", false, windows), [], "a window that does not exist");
});

test("on the Mac no caption region is ever sent to native", () => {
  const sent = [];
  const send = (id, list) => sent.push([id, list]);
  const open = { windowUi: { w: { panel: { open: true, initialText: "" }, downloadsOpen: false } } };
  syncCaptionRegions(state(), null, send);
  assert.deepEqual(sent, []);
  syncCaptionRegions(state({}, {}, open), null, send);
  assert.deepEqual(sent, []);
});

test("on Windows an empty sidebar header on the left collapses to the page frame, and downloads move to the footer", () => {
  const collapsed = (settings = {}, window = {}, extra = {}) => sidebarHeaderCollapsed(state(settings, window, extra), "w", windows);
  assert.equal(collapsed(), true);
  assert.equal(collapsed({ compactToolbar: true }), true);
  assert.equal(collapsed({ autoHideTabs: true }, {}), true);
  assert.equal(collapsed({ sidebarSide: "right" }), false, "the window buttons sit in a right sidebar's header");
  assert.equal(collapsed({ addressBar: "sidebar" }), false, "the address row and header tools");
  assert.equal(collapsed({ tabLayout: "top" }), false);
  assert.equal(collapsed({}, { kind: "private" }), false, "the incognito indicator");
  assert.equal(collapsed({}, {}, { profiles: { p: { id: "p" }, q: { id: "q" } }, profileOrder: ["p", "q"] }), false, "the profile indicator");
  assert.equal(collapsedSidebarHeader(9), 9);
  assert.equal(collapsedSidebarHeader(12), 12);
  assert.equal(collapsedSidebarHeader(0), 6);
  const footer = (settings = {}, window = {}) => downloadsInSidebarFooter(state(settings, window), "w", windows);
  assert.equal(footer(), true);
  assert.equal(footer({ addressBar: "sidebar" }), true);
  assert.equal(footer({ sidebarSide: "right" }), false);
  assert.equal(footer({ tabLayout: "top" }), false);
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
  assert.deepEqual(bar, { height: 38, navLeft: 9, navPitch: 30, fieldLeft: 73, fieldTop: 5, buttonTop: 5, trailingRoom: 171, controlsRight: 180 });
  assert.ok(bar.controlsRight >= windows.trailingWidth, "the copy, open and profile buttons stay left of minimize, maximize and close");
  assert.ok(bar.fieldTop >= 0 && bar.fieldTop + SMALL_FIELD_HEIGHT <= bar.height, "the field sits inside the bar");
  assert.ok(bar.height >= windows.titleBarHeight, "the bar covers the whole title band");
});

test("the command panel keeps the Mac's 16 pt right margin and clears the window buttons while it sits beside them", () => {
  for (const top of [0.5, 5, 31, 32, 60]) assert.equal(trailingClearance(top, 16, 0, mac), 16);
  for (const top of [0.5, 5, 31, 32, 60]) assert.equal(trailingClearance(top, 16, 45.2, mac), 16);
  assert.equal(trailingClearance(0.5, 16, 45.2, windows), 171);
  assert.equal(trailingClearance(15, 16, 45.2, windows), 171);
  assert.equal(trailingClearance(45, 16, 45.2, windows), 171);
  assert.equal(trailingClearance(45.2, 16, 45.2, windows), 16);
  assert.equal(trailingClearance(60, 16, 45.2, windows), 16);
  assert.equal(trailingClearance(5, 16, 0, windows), 16);
});

test("the command panel grows from its field on the Mac and opens in place on Windows", () => {
  assert.equal(macFeatures.panelGrowsFromField, true);
  assert.equal(windowsFeatures.panelGrowsFromField, false);
});
