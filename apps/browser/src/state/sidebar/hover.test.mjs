import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { registerRow, setSidebarUi, sidebarUi } = await import("./sidebarUi.ts");
const hover = await import("./hover.ts");

const W = "w";
const HEIGHT = 800;
const ROWS = { a: 100, b: 140, c: 180, tile: 40 };
for (const [id, y] of Object.entries(ROWS)) registerRow(W, id, { measureInWindow: (done) => done(10, y, 160, 30) });
hover.setHoverSpace(W, HEIGHT);

const row = (id) => ({ kind: "tab", id });
const at = (x, y) => ({ nativeEvent: { screenX: x, screenY: HEIGHT - y } });
const shown = () => sidebarUi().hover?.id ?? null;
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fresh(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  hover.suppressHover(false);
  hover.dismissHover();
  hover.cardLeft();
  t.mock.timers.tick(1000);
  setSidebarUi({ hover: null, renaming: null, iconPicker: null });
  useBrowser.getState().hydrate({});
}

function enter(id, event = at(20, ROWS[id] + 10)) {
  let entered = false;
  let aiming = false;
  hover.rowEntered(W, row(id), event, () => {
    entered = true;
    hover.rowShown(W, row(id));
  }, () => (aiming = true));
  return { entered: () => entered, aiming: () => aiming };
}

const leave = (id, event = at(200, ROWS[id] + 10)) => hover.rowLeft(W, row(id), event, true);

async function cardFor(t, id) {
  enter(id);
  t.mock.timers.tick(500);
  await settle();
  assert.equal(shown(), id);
}

test("a row's card shows after 500 ms and hides 160 ms after the pointer leaves", async (t) => {
  fresh(t);
  enter("a");
  t.mock.timers.tick(499);
  await settle();
  assert.equal(shown(), null);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(shown(), "a");
  leave("a");
  t.mock.timers.tick(159);
  assert.equal(shown(), "a");
  t.mock.timers.tick(1);
  assert.equal(shown(), null);
});

test("with a card up, the next row's card shows at once", async (t) => {
  fresh(t);
  await cardFor(t, "a");
  leave("a", at(20, ROWS.b + 1));
  enter("b");
  await settle();
  assert.equal(shown(), "b");
});

test("a card never shows after a dismissal, even one that lands while the row is being measured", async (t) => {
  fresh(t);
  enter("a");
  t.mock.timers.tick(500);
  hover.dismissHover();
  await settle();
  assert.equal(shown(), null, "dismissed while measuring");
  enter("b");
  hover.dismissHover();
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(shown(), null, "dismissed before the delay ran out");
});

test("the card leaves with its row: when the row goes, or the sidebar it was in changes", async (t) => {
  fresh(t);
  await cardFor(t, "a");
  hover.releaseAnchor(W, "a");
  assert.equal(shown(), null, "its row unmounted");
  await cardFor(t, "b");
  hover.releaseAnchor(W, "c");
  assert.equal(shown(), "b", "another row unmounting leaves it");
  hover.dismissHoverIn("other");
  assert.equal(shown(), "b", "another window's sidebar changing leaves it");
  hover.dismissHoverIn(W);
  assert.equal(shown(), null);
  enter("a");
  hover.dismissHoverIn(W);
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(shown(), null, "a card on its way is dropped too");
});

test("while the card is up a row under it waits, and reaching the card keeps it", async (t) => {
  fresh(t);
  await cardFor(t, "tile");
  hover.cardLaidOut({ x: 60, y: 40, width: 260, height: 160 });
  leave("tile", at(55, 55));
  const under = enter("b", at(100, ROWS.b + 10));
  assert.equal(under.entered(), false, "the row under the card waits");
  hover.cardEntered();
  assert.equal(hover.pointerOnCard(), true);
  t.mock.timers.tick(1000);
  assert.equal(shown(), "tile", "on the card it stays");
  hover.cardLeft();
  assert.equal(under.entered(), true, "leaving the card onto the waiting row moves the card there");
  await settle();
  assert.equal(shown(), "b");
});

test("heading for the card from its row keeps it; stopping short for 200 ms hands the hover to the row", async (t) => {
  fresh(t);
  await cardFor(t, "tile");
  hover.cardLaidOut({ x: 69, y: 48, width: 264, height: 152 });
  leave("tile", at(45, 96));
  const passing = enter("b", at(55, 104));
  assert.equal(passing.aiming(), true, "the row on the way lights up");
  assert.equal(passing.entered(), false, "but doesn't take the card");
  t.mock.timers.tick(199);
  assert.equal(passing.entered(), false);
  t.mock.timers.tick(1);
  assert.equal(passing.entered(), true);
  await settle();
  assert.equal(shown(), "b");
});

test("a row away from the card takes the hover at once", async (t) => {
  fresh(t);
  await cardFor(t, "tile");
  hover.cardLaidOut({ x: 69, y: 48, width: 264, height: 152 });
  leave("tile", at(45, 96));
  assert.equal(enter("c", at(30, 190)).entered(), true);
});

test("a row that goes while it waits for the aim never takes the hover", async (t) => {
  fresh(t);
  await cardFor(t, "tile");
  hover.cardLaidOut({ x: 69, y: 48, width: 264, height: 152 });
  leave("tile", at(45, 96));
  const passing = enter("b", at(55, 104));
  hover.releaseAnchor(W, "b");
  t.mock.timers.tick(200);
  assert.equal(passing.entered(), false);
  t.mock.timers.tick(160);
  assert.equal(shown(), null, "nothing to arrive at: the card leaves");
});

test("the card holds while the group panel is held, and on release leaves unless the pointer is back on its row", async (t) => {
  fresh(t);
  await cardFor(t, "a");
  hover.holdHover(true);
  leave("a");
  t.mock.timers.tick(1000);
  assert.equal(shown(), "a", "held");
  hover.holdHover(false);
  t.mock.timers.tick(160);
  assert.equal(shown(), null, "released with the pointer away");

  await cardFor(t, "b");
  hover.holdHover(true);
  hover.holdHover(false);
  t.mock.timers.tick(1000);
  assert.equal(shown(), "b", "released with the pointer on its row");
  leave("b");
  t.mock.timers.tick(160);
  assert.equal(shown(), null, "its row is its owner again");
});

test("no card while a row is renamed or the icon picker is open in its window, or over the command panel", async (t) => {
  fresh(t);
  setSidebarUi({ renaming: { kind: "tab", id: "x", windowId: "other" } });
  enter("a");
  t.mock.timers.tick(500);
  await settle();
  assert.equal(shown(), "a", "a rename in another window doesn't stop it");
  hover.dismissHover();
  setSidebarUi({ renaming: { kind: "tab", id: "x", windowId: W } });
  enter("c");
  t.mock.timers.tick(500);
  await settle();
  assert.equal(shown(), null, "renaming");
  setSidebarUi({ renaming: null, iconPicker: { kind: "tab", id: "x", windowId: W, anchor: null } });
  enter("b");
  t.mock.timers.tick(500);
  await settle();
  assert.equal(shown(), null, "icon picker");
  setSidebarUi({ iconPicker: null });

  const w = useBrowser.getState().createWindow({ url: "a.com" });
  registerRow(w, "a", { measureInWindow: (done) => done(10, 100, 160, 30) });
  useBrowser.getState().openPanel(w, "");
  hover.rowShown(w, row("a"));
  t.mock.timers.tick(500);
  await settle();
  assert.equal(shown(), null, "command panel");
});

test("a drag suppresses the card until it ends", async (t) => {
  fresh(t);
  await cardFor(t, "a");
  hover.suppressHover(true);
  assert.equal(shown(), null);
  enter("b");
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(shown(), null);
  hover.suppressHover(false);
  enter("c");
  t.mock.timers.tick(500);
  await settle();
  assert.equal(shown(), "c");
});

test("the command panel over the rows takes their highlight, and a group's box follows the pointer", () => {
  let refreshed = 0;
  const refresh = () => refreshed++;
  hover.watchCovered(W, refresh, true);
  hover.setRowsCovered(W, true);
  hover.setRowsCovered(W, true);
  assert.equal(hover.rowsCovered(W), true);
  assert.equal(refreshed, 1, "a pointed row re-renders once per change");
  hover.watchCovered(W, refresh, false);
  hover.setRowsCovered(W, false);
  assert.equal(refreshed, 1, "a row that's no longer pointed isn't told");
  hover.setGroupPointed("g", true);
  assert.equal(hover.pointerOnGroup("g"), true);
  hover.setGroupPointed("g", false);
  assert.equal(hover.pointerOnGroup("g"), false);
});
