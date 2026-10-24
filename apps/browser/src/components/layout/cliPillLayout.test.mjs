import assert from "node:assert/strict";
import { test } from "node:test";

const { CLI_PILL_BOTTOM, CLI_PILL_HEIGHT, statusBubblePlacement, statusBubbleWidth } = await import("./cliPillLayout.ts");

const pillLeft = (paneWidth, pillWidth) => (paneWidth - pillWidth) / 2;

test("with no pill the status bubble keeps Chrome's place and width", () => {
  assert.deepEqual(statusBubblePlacement(1200, 0), { maxWidth: 600, bottom: 6 });
  assert.deepEqual(statusBubblePlacement(240, 0), { maxWidth: 160, bottom: 6 });
});

test("a wide pane narrows the bubble so it ends before the pill", () => {
  for (const paneWidth of [600, 900, 1200, 1800]) {
    const { maxWidth, bottom } = statusBubblePlacement(paneWidth, 230);
    assert.equal(bottom, 6);
    assert.ok(6 + maxWidth <= pillLeft(paneWidth, 230) - 8, `pane ${paneWidth}`);
    assert.ok(maxWidth <= statusBubbleWidth(paneWidth));
  }
});

test("a narrow pane lifts the bubble above the pill instead", () => {
  for (const paneWidth of [300, 400, 480]) {
    const { maxWidth, bottom } = statusBubblePlacement(paneWidth, 230);
    assert.ok(bottom >= CLI_PILL_BOTTOM + CLI_PILL_HEIGHT + 6, `pane ${paneWidth}`);
    assert.equal(maxWidth, statusBubbleWidth(paneWidth));
  }
});

const { CLI_PILL_CLEARANCE, cliPillColors, cliPillHost, cliPillPlacements, cliPillWidthIn, pageToastLift, placeCliPill, windowToastLift, withdrawCliPill } = await import("./cliPillLayout.ts");

test("the pill's card is the peek, else the full screen tab, else the focused card", () => {
  assert.equal(cliPillHost({ activeId: "a" }), "a");
  assert.equal(cliPillHost({ activeId: "a", fullscreenTab: "b" }), "b");
  assert.equal(cliPillHost({ activeId: "a", fullscreenTab: "b", peekId: "p" }), "p");
  assert.equal(cliPillHost({ activeId: "a", fullscreenTab: null, peekId: undefined }), "a");
  assert.equal(cliPillHost({}), undefined);
});

test("one placement per window; a withdrawn card's leftover cleanup doesn't remove the new card's pill", () => {
  cliPillPlacements.setState({}, true);
  placeCliPill("w1", "a", 230);
  placeCliPill("w2", "x", 230);
  placeCliPill("w1", "b", 228);
  withdrawCliPill("w1", "a");
  assert.deepEqual(cliPillPlacements.getState(), { w1: { tabId: "b", width: 228 }, w2: { tabId: "x", width: 230 } });
  withdrawCliPill("w1", "b");
  assert.deepEqual(cliPillPlacements.getState(), { w2: { tabId: "x", width: 230 } });
  assert.equal(cliPillWidthIn(cliPillPlacements.getState(), "w2", "x"), 230);
  assert.equal(cliPillWidthIn(cliPillPlacements.getState(), "w2", "y"), 0);
  assert.equal(cliPillWidthIn(cliPillPlacements.getState(), "w1", "b"), 0);
  cliPillPlacements.setState({}, true);
});

test("a page's toast lifts only when the pill is shown in that same card", () => {
  const placements = { w1: { tabId: "a", width: 230 } };
  assert.equal(pageToastLift(placements, "w1", "a", 24), CLI_PILL_CLEARANCE - 24);
  assert.equal(pageToastLift(placements, "w1", "b", 24), 0);
  assert.equal(pageToastLift(placements, "w2", "a", 24), 0);
  assert.equal(pageToastLift({}, "w1", "a", 24), 0);
  assert.equal(pageToastLift({ w1: { tabId: "a", width: 0 } }, "w1", "a", 24), 0);
});

test("the window's split toast lifts only when the pill in that window sits under it", () => {
  const toast = { width: 300, containerWidth: 1200, bottom: 22 };
  const full = { a: { x: 0, width: 1200 } };
  const lift = CLI_PILL_CLEARANCE - 22;
  assert.equal(windowToastLift({ w1: { tabId: "a", width: 230 } }, "w1", { hostTab: "a", panes: full }, toast), lift);
  assert.equal(windowToastLift({}, "w1", { hostTab: "a", panes: full }, toast), 0);
  assert.equal(windowToastLift({ w2: { tabId: "a", width: 230 } }, "w1", { hostTab: "a", panes: full }, toast), 0);
  const split = { a: { x: 0, width: 400 }, b: { x: 400, width: 400 }, c: { x: 800, width: 400 } };
  assert.equal(windowToastLift({ w1: { tabId: "a", width: 230 } }, "w1", { hostTab: "a", panes: split }, toast), 0);
  assert.equal(windowToastLift({ w1: { tabId: "b", width: 230 } }, "w1", { hostTab: "b", panes: split }, toast), lift);
  assert.equal(windowToastLift({ w1: { tabId: "peek", width: 230 } }, "w1", { hostTab: "peek", panes: split }, toast), 0);
});

test("while the pill moves to another card the toast follows the card it is moving to, not the placement it is leaving", () => {
  const toast = { width: 300, containerWidth: 1200, bottom: 22 };
  const lift = CLI_PILL_CLEARANCE - 22;
  const leaving = { w1: { tabId: "old", width: 230 } };
  assert.equal(windowToastLift(leaving, "w1", { hostTab: "new", panes: { new: { x: 0, width: 1200 } } }, toast), lift);
  const split = { a: { x: 0, width: 600 }, b: { x: 600, width: 600 } };
  assert.equal(windowToastLift({ w1: { tabId: "b", width: 230 } }, "w1", { hostTab: "a", panes: split }, { ...toast, width: 200 }), 0);
  assert.equal(windowPillWidth(leaving, "w1"), 230);
  assert.equal(windowPillWidth(leaving, "w2"), 0);
});

const channel = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const rgba = (color) => {
  const hex = color.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(hex[2] ? parseInt(hex[2], 16) / 255 : 1);
  const fn = color.match(/^rgba\(([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)$/);
  return fn.slice(1).map(Number);
};
const over = (top, bottom) => {
  const [r, g, b, a] = rgba(top);
  const [R, G, B] = rgba(bottom);
  return [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (fg, bg) => {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

test("every piece of pill text meets WCAG AA (4.5:1) in light and dark", async () => {
  const { themeFor } = await import("../../lib/theme.ts");
  for (const key of ["plum:light", "plum:dark", "neutral:light", "incognito:dark"]) {
    const theme = themeFor(key);
    const colors = cliPillColors(theme);
    const fill = over(colors.fill, "#808080");
    const pairs = [
      ["detail", colors.detail, fill],
      ["title", colors.title, fill],
      ...["rest", "hovered", "pressed"].map((state) => [`stop ${state}`, colors.stopText, over(colors.stopFill(state), `#${fill.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`)]),
    ];
    for (const [name, fg, bg] of pairs) {
      const ratio = contrast(over(fg, `#${bg.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`), bg);
      assert.ok(ratio >= 4.5, `${key} ${name}: ${ratio.toFixed(2)}`);
    }
  }
});

const { CLI_PILL_INSET, CLI_PILL_LABELS, cliPillLabel, cliPillWidthSeed, windowPillWidth } = await import("./cliPillLayout.ts");

test("a pane too narrow for the full sentence gets a shorter whole one, then loses the glyph, then keeps just the name and Stop", () => {
  const full = CLI_PILL_LABELS[0];
  assert.deepEqual(cliPillLabel(1200), { detail: " is controlling Ardia", glyph: true });
  assert.deepEqual(cliPillLabel(full.width + 2 * CLI_PILL_INSET), { detail: full.detail, glyph: true });
  assert.deepEqual(cliPillLabel(231), { detail: " is in control", glyph: true });
  assert.deepEqual(cliPillLabel(CLI_PILL_LABELS[1].width + 2 * CLI_PILL_INSET - 1), { detail: " is in control", glyph: false });
  assert.deepEqual(cliPillLabel(155), { detail: "", glyph: true });
  assert.deepEqual(cliPillLabel(80), { detail: "", glyph: false });
  for (let i = 1; i < CLI_PILL_LABELS.length; i++) assert.ok(CLI_PILL_LABELS[i].width < CLI_PILL_LABELS[i - 1].width);
});

test("a pill moving to another card in its window starts from the window's measured width, so toasts don't drop for a frame", () => {
  cliPillPlacements.setState({}, true);
  placeCliPill("w1", "a", 232);
  withdrawCliPill("w1", "a");
  assert.equal(cliPillWidthSeed("w1", true), 0);
  placeCliPill("w1", "a", 232);
  const seed = cliPillWidthSeed("w1", true);
  assert.equal(seed, 232);
  assert.equal(cliPillWidthSeed("w1", false), 0);
  assert.equal(cliPillWidthSeed("w2", true), 0);
  const lifts = [];
  const unsubscribe = cliPillPlacements.subscribe((p) => lifts.push(pageToastLift(p, "w1", "b", 24)));
  withdrawCliPill("w1", "a");
  placeCliPill("w1", "b", seed);
  unsubscribe();
  assert.equal(lifts.at(-1), CLI_PILL_CLEARANCE - 24);
  cliPillPlacements.setState({}, true);
});
