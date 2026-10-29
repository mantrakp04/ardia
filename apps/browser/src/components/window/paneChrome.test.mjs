import assert from "node:assert/strict";
import { test } from "node:test";
const { cardChrome, paneBar } = await import("./paneChrome.ts");

const card = (o = {}) => cardChrome({ addressInSidebar: false, small: false, split: false, fullscreen: false, hideWhileScrolling: false, ...o });
const shown = { visible: true, fullscreen: false, lingering: false };
const warm = { visible: false, fullscreen: false, lingering: false };
const lingering = { visible: true, fullscreen: false, lingering: true };

test("a window that isn't split keeps one toolbar above its panes, and each shown pane draws only its band", () => {
  assert.deepEqual(card(), { kind: "window", autoHide: false });
  assert.deepEqual(paneBar(card(), shown), { kind: "backdrop" });
  assert.deepEqual(paneBar(card(), warm), { kind: "spacer" });
});

test("split panes and a window with a full-screen page keep a toolbar in each pane", () => {
  assert.deepEqual(card({ split: true }), { kind: "pane", autoHide: false });
  assert.deepEqual(paneBar(card({ split: true }), shown), { kind: "toolbar" });
  assert.deepEqual(paneBar(card({ split: true }), warm), { kind: "spacer" });
  assert.deepEqual(card({ fullscreen: true }), { kind: "pane", autoHide: false });
  assert.deepEqual(paneBar(card({ fullscreen: true }), shown), { kind: "toolbar" });
});

test("the full-screen page itself has no toolbar", () => {
  assert.deepEqual(paneBar(card({ fullscreen: true }), { ...shown, fullscreen: true }), { kind: "none" });
  assert.deepEqual(paneBar(card({ fullscreen: true, hideWhileScrolling: true }), { ...shown, fullscreen: true }), { kind: "none" });
});

test("a small window and the address bar in the sidebar draw no toolbar on the card, and never hide one while scrolling", () => {
  for (const o of [{ small: true }, { addressInSidebar: true }, { small: true, hideWhileScrolling: true }, { addressInSidebar: true, hideWhileScrolling: true, split: true }]) {
    assert.deepEqual(card(o), { kind: "none" });
    assert.deepEqual(paneBar(card(o), shown), { kind: "none" });
  }
});

test("hide while scrolling: the window's bar follows the shown pane, which draws the backdrop and publishes its motion", () => {
  const chrome = card({ hideWhileScrolling: true });
  assert.deepEqual(chrome, { kind: "window", autoHide: true });
  assert.deepEqual(paneBar(chrome, shown), { kind: "autoHide", bar: "window" });
  assert.deepEqual(paneBar(chrome, warm), { kind: "autoHide", bar: null });
});

test("hide while scrolling in a split: each pane hides its own bar", () => {
  assert.deepEqual(paneBar(card({ split: true, hideWhileScrolling: true }), shown), { kind: "autoHide", bar: "pane" });
  assert.deepEqual(paneBar(card({ split: true, hideWhileScrolling: true }), lingering), { kind: "autoHide", bar: "pane" });
});

test("a New Tab page lingering under the new tab keeps its band but doesn't take over the window's bar", () => {
  assert.deepEqual(paneBar(card(), lingering), { kind: "backdrop" });
  assert.deepEqual(paneBar(card({ hideWhileScrolling: true }), lingering), { kind: "autoHide", bar: "backdrop" });
});
