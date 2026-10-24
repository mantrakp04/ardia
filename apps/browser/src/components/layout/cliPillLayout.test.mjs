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
  assert.equal(windowToastLift({ w1: { tabId: "a", width: 230 } }, "w1", full, toast), lift);
  assert.equal(windowToastLift({}, "w1", full, toast), 0);
  assert.equal(windowToastLift({ w2: { tabId: "a", width: 230 } }, "w1", full, toast), 0);
  const split = { a: { x: 0, width: 400 }, b: { x: 400, width: 400 }, c: { x: 800, width: 400 } };
  assert.equal(windowToastLift({ w1: { tabId: "a", width: 230 } }, "w1", split, toast), 0);
  assert.equal(windowToastLift({ w1: { tabId: "b", width: 230 } }, "w1", split, toast), lift);
  assert.equal(windowToastLift({ w1: { tabId: "peek", width: 230 } }, "w1", split, toast), 0);
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
