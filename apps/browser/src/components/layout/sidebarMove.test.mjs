import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const sm = await import("./sidebarMove.ts");
const dm = await import("./dockMotion.ts");
const { sidebarOnRight } = await import("../sidebar/tokens.ts");
const { useBrowser } = await import("../../store/browser.ts");
const stub = await import("../../test-native-stub.mjs");
const { reloadSwitches } = await import("../../lib/killSwitches.ts");

const S = () => useBrowser.getState();
const AREA = { width: 1200, height: 800 };
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function freshWindow({ side = "left", layout = "sidebar", open = true, addressBar = "sidebar" } = {}) {
  S().hydrate({});
  S().updateSettings({ sidebarSide: side, tabLayout: layout, addressBar }, { fromSync: true });
  for (const id of Object.keys(dm.useDockMotion.getState().moving)) dm.setDockMoving(id, false);
  const id = S().createWindow({ url: "a.com" });
  if (!open) S().toggleSidebar(id);
  sm.setMoveArea(id, AREA);
  return id;
}

test("the toggle's glyph shows the side the sidebar docks on", () => {
  assert.equal(sm.sidebarGlyph(false), "sidebar.left");
  assert.equal(sm.sidebarGlyph(true), "sidebar.right");
});

test("a press becomes a move past the app's 4 pt drag threshold, as a sidebar row's drag", () => {
  assert.equal(sm.pastMoveThreshold(0, 0), false);
  assert.equal(sm.pastMoveThreshold(4, 0), false);
  assert.equal(sm.pastMoveThreshold(3, 3), true);
  assert.equal(sm.pastMoveThreshold(0, -5), true);
});

test("the target is the window half under the pointer", () => {
  assert.equal(sm.sideUnder(0, 1200), "left");
  assert.equal(sm.sideUnder(599.5, 1200), "left");
  assert.equal(sm.sideUnder(600, 1200), "right");
  assert.equal(sm.sideUnder(1300, 1200), "right", "past the window's edge");
  assert.equal(sm.sideUnder(-40, 1200), "left");
});

test("the preview slab is the sidebar's size, docked at the target edge inside the peek panel's margins", () => {
  const [inset, top] = dm.PEEK_ORIGIN;
  const left = sm.slabRect("left", AREA, 190);
  assert.deepEqual(left, { x: inset, y: top, width: 190 - inset, height: 800 - top - dm.PEEK_BOTTOM });
  const right = sm.slabRect("right", AREA, 190);
  assert.equal(right.x + right.width, 1200 - inset, "flush with the right margin");
  assert.equal(right.width, left.width);
  assert.ok(sm.slabRect("right", { width: 300, height: 500 }, 400).width <= 150, "never past the window's middle");
});

test("only a window with the sidebar layout can move it: not tabs on top, not Little Ardia", () => {
  const id = freshWindow();
  assert.equal(sm.canMoveSidebar(S(), id), true);
  S().updateSettings({ tabLayout: "top" });
  assert.equal(sm.canMoveSidebar(S(), id), false);
  S().updateSettings({ tabLayout: "sidebar" });
  useBrowser.setState((s) => ({ windows: { ...s.windows, [id]: { ...s.windows[id], tabLayout: "top" } } }));
  assert.equal(sm.canMoveSidebar(S(), id), false, "the window's own tabs-on-top");
  const small = S().createWindow({ small: true, url: "b.com" });
  assert.equal(sm.canMoveSidebar(S(), small), false);
  assert.equal(sm.beginSidebarMove(small, 900, 20), false);
  assert.equal(sm.useSidebarMove.getState().windowId, null);
});

test("Right is only for the address bar in the sidebar: with it in the toolbar the sidebar stays left and can't be moved", () => {
  const id = freshWindow({ side: "right", addressBar: "toolbar" });
  assert.equal(sidebarOnRight(S(), id), false);
  assert.equal(sm.canMoveSidebar(S(), id), false);
  assert.deepEqual(sm.sidebarToggleMenuItems(S(), id), [], "no Move Sidebar item");
  assert.equal(sm.beginSidebarMove(id, 30, 20), false, "the drag doesn't start");
  assert.equal(sm.useSidebarMove.getState().windowId, null);
  assert.equal(S().settings.sidebarSide, "right", "the preference is kept");
  S().updateSettings({ addressBar: "sidebar" });
  assert.equal(sidebarOnRight(S(), id), true, "back with the address bar in the sidebar");
  assert.deepEqual(sm.sidebarToggleMenuItems(S(), id).map((i) => i.title), ["Move Sidebar Left"]);
  S().updateSettings({ addressBar: "toolbar" });
  assert.equal(sidebarOnRight(S(), id), false);
  assert.equal(S().settings.sidebarSide, "right");
});

test("with the sidebar-slide kill switch off a hidden sidebar puts the address bar back in the toolbar, so Right is off too", () => {
  const id = freshWindow({ side: "right" });
  stub.docs.set("switches-cache.json", JSON.stringify({ version: 1, switches: { sidebarSlide: false } }));
  reloadSwitches();
  assert.equal(sidebarOnRight(S(), id), false);
  assert.deepEqual(sm.sidebarToggleMenuItems(S(), id), []);
  stub.docs.clear();
  reloadSwitches();
  assert.equal(sidebarOnRight(S(), id), true);
});

test("the drag follows the pointer and reports each change of half once", () => {
  const id = freshWindow();
  assert.equal(sm.beginSidebarMove(id, 30, 20), true);
  assert.deepEqual(sm.useSidebarMove.getState(), { windowId: id, x: 30, y: 20, grab: [0, 0], from: "left", target: "left" });
  assert.equal(sm.updateSidebarMove(400, 300), false);
  assert.equal(sm.updateSidebarMove(700, 300), true, "crossed into the right half");
  assert.equal(sm.updateSidebarMove(900, 310), false);
  assert.equal(sm.useSidebarMove.getState().target, "right");
  assert.equal(sm.endSidebarMove(false), null, "Esc or a lost drag: no change");
  assert.equal(S().settings.sidebarSide, "left");
  assert.equal(sm.useSidebarMove.getState().windowId, null);
});

test("the window is measured only once a drag starts: until then the target is the side it came from", () => {
  const id = freshWindow();
  sm.setMoveArea(id, null);
  assert.equal(sm.beginSidebarMove(id, 1000, 20), true);
  assert.equal(sm.useSidebarMove.getState().target, "left");
  assert.equal(sm.updateSidebarMove(1010, 30), false);
  assert.deepEqual([sm.useSidebarMove.getState().x, sm.useSidebarMove.getState().y], [1010, 30]);
  sm.setMoveArea(id, AREA);
  assert.equal(sm.useSidebarMove.getState().target, "right");
  assert.equal(sm.endSidebarMove(false), null);
});

test("releasing over the same half changes nothing", async () => {
  const id = freshWindow();
  sm.beginSidebarMove(id, 30, 20);
  sm.updateSidebarMove(800, 300);
  sm.updateSidebarMove(200, 300);
  assert.equal(sm.endSidebarMove(true), null);
  await tick(80);
  assert.equal(S().settings.sidebarSide, "left");
  assert.equal(S().windows[id].sidebarOpen, true);
});

test("Pressable's retention rect around the toggle", () => {
  const button = { x: 196, y: 12, width: 30, height: 30 };
  assert.equal(sm.withinPressRetention(211, 27, button), true);
  assert.equal(sm.withinPressRetention(217, 29, button), true, "a 6 pt wobble");
  assert.equal(sm.withinPressRetention(176.5, 27, button), true);
  assert.equal(sm.withinPressRetention(176, 27, button), false, "20 pt past the left edge");
  assert.equal(sm.withinPressRetention(211, 71.5, button), true, "30 pt below");
  assert.equal(sm.withinPressRetention(211, 72, button), false);
  assert.equal(sm.withinPressRetention(211, -8, button), false);
});

function record(ids) {
  const seen = [];
  const stop = useBrowser.subscribe((s) => seen.push([s.settings.sidebarSide, ...ids.map((id) => s.windows[id]?.sidebarOpen)]));
  return { seen, stop };
}

test("a drop writes the setting at once, and that is the only store write: sidebarOpen is never touched", () => {
  const id = freshWindow();
  const { seen, stop } = record([id]);
  sm.beginSidebarMove(id, 30, 20);
  sm.updateSidebarMove(1000, 300);
  assert.equal(sm.endSidebarMove(true), "right");
  stop();
  assert.deepEqual(seen, [["right", true]]);
  assert.equal(sidebarOnRight(S(), id), true, "the layout reads the new side from the first frame; only the dock's own slide lags");
});

test("Settings and sync write the setting as before, chosen flags as usual", () => {
  freshWindow();
  const chosen = () => (S().settings.chosen ?? []).includes("sidebarSide");
  assert.equal(chosen(), false);
  S().updateSettings({ sidebarSide: "right" }, { fromSync: true });
  assert.equal(S().settings.sidebarSide, "right");
  assert.equal(chosen(), false, "a synced value stays synced");
  S().updateSettings({ sidebarSide: "left" });
  assert.equal(chosen(), true, "the person's choice");
});

test("a sync patch that also puts tabs on top leaves every sidebar's open state alone", () => {
  const a = freshWindow();
  const b = S().createWindow({ url: "b.com" });
  S().toggleSidebar(b);
  S().updateSettings({ sidebarSide: "right", tabLayout: "top" }, { fromSync: true });
  assert.deepEqual([S().windows[a].sidebarOpen, S().windows[b].sidebarOpen], [true, false]);
  assert.equal(sidebarOnRight(S(), a), false, "tabs on top: no Right mode");
});

test("the outgoing side: a docked or peeking sidebar slides out on the side it was on; hidden ones and Reduce Motion swap at once", () => {
  assert.equal(sm.outgoingSide(null, "left", { visible: true, slides: true }), "left");
  assert.equal(sm.outgoingSide(null, "left", { visible: false, slides: true }), null, "hidden: nothing to slide");
  assert.equal(sm.outgoingSide(null, "left", { visible: true, slides: false }), null, "Reduce Motion or the kill switch");
});

test("a later change mid-slide retargets: the outgoing side stays the one on screen, the new side is read when it comes in", () => {
  assert.equal(sm.outgoingSide("left", "right", { visible: true, slides: true }), "left");
  assert.equal(sm.outgoingSide("left", "left", { visible: false, slides: false }), "left");
});

test("⌘S during a switch is an ordinary toggle", () => {
  const id = freshWindow();
  S().updateSettings({ sidebarSide: "right" });
  S().toggleSidebar(id);
  assert.equal(S().windows[id].sidebarOpen, false);
  S().toggleSidebar(id);
  assert.equal(S().windows[id].sidebarOpen, true);
});

test("the toggle's right-click menu offers the other side and writes the setting like a drop", () => {
  const id = freshWindow();
  assert.deepEqual(sm.sidebarToggleMenuItems(S(), id), [{ id: "moveSidebarRight", title: "Move Sidebar Right", symbol: "sidebar.right" }]);
  sm.chooseSidebarToggleMenuItem(null);
  assert.equal(S().settings.sidebarSide, "left");
  sm.chooseSidebarToggleMenuItem("moveSidebarRight");
  assert.equal(S().settings.sidebarSide, "right");
  assert.deepEqual(sm.sidebarToggleMenuItems(S(), id).map((i) => i.title), ["Move Sidebar Left"]);
  S().updateSettings({ tabLayout: "top" });
  assert.deepEqual(sm.sidebarToggleMenuItems(S(), id), [], "not with tabs on top");
  const small = S().createWindow({ small: true, url: "b.com" });
  assert.deepEqual(sm.sidebarToggleMenuItems(S(), small), []);
});

test("the menu moves to the side it named, even if the side changed elsewhere while it was open", () => {
  const id = freshWindow();
  const [item] = sm.sidebarToggleMenuItems(S(), id);
  S().updateSettings({ sidebarSide: "right" }, { fromSync: true });
  sm.chooseSidebarToggleMenuItem(item.id);
  assert.equal(S().settings.sidebarSide, "right", "Move Sidebar Right never moves it left");
});

test("a side change from elsewhere during a drag is honoured on drop", () => {
  const id = freshWindow({ open: false });
  sm.beginSidebarMove(id, 30, 20);
  S().updateSettings({ sidebarSide: "right" }, { fromSync: true });
  sm.updateSidebarMove(1000, 300);
  assert.equal(sm.endSidebarMove(true), null, "already there");
  sm.beginSidebarMove(id, 1000, 20);
  S().updateSettings({ sidebarSide: "left" });
  sm.updateSidebarMove(1000, 300);
  assert.equal(sm.endSidebarMove(true), "right");
  assert.equal(S().settings.sidebarSide, "right");
});

const BUTTON = { x: 196, y: 12, width: 30, height: 30 };
const at = (x, y) => ({ dx: x - 211, dy: y - 27, moveX: x, moveY: y });

test("a wobbly press never starts a move drag, so it stays the button's ordinary click", () => {
  const id = freshWindow();
  for (const [x, y] of [[215, 30], [217, 31], [230, 60], [176.5, 27]]) assert.equal(sm.startsMoveDrag(at(x, y), BUTTON), false, `${x},${y}`);
  assert.equal(sm.startsMoveDrag(at(211, 27), null), false, "not measured yet");
  assert.equal(sm.startsMoveDrag(at(225, 40), null), false, "not measured yet: inside the retention round the press");
  assert.equal(sm.startsMoveDrag(at(211, 110), null), true, "not measured yet: a quick drag still starts once it leaves it");
  S().toggleSidebar(id);
  assert.equal(S().windows[id].sidebarOpen, false, "the click toggles as before");
});

test("once the drag has left the press area, releasing back on the button cancels: no toggle, no move", () => {
  const id = freshWindow();
  assert.equal(sm.startsMoveDrag(at(211, 110), BUTTON), true, "left the press area");
  const { seen, stop } = record([id]);
  assert.equal(sm.beginSidebarMove(id, 211, 110), true);
  sm.updateSidebarMove(211, 300);
  sm.updateSidebarMove(212, 28);
  assert.equal(sm.endSidebarMove(true), null);
  stop();
  assert.deepEqual(seen, [], "nothing written");
});

test("once the drag has started, releasing elsewhere on the same half cancels", () => {
  const id = freshWindow();
  const { seen, stop } = record([id]);
  sm.beginSidebarMove(id, 211, 110);
  sm.updateSidebarMove(500, 400);
  assert.equal(sm.endSidebarMove(true), null);
  stop();
  assert.deepEqual(seen, []);
});

test("dropping on the other half moves the sidebar", () => {
  const id = freshWindow();
  sm.beginSidebarMove(id, 211, 110);
  sm.updateSidebarMove(1000, 400);
  assert.equal(sm.endSidebarMove(true), "right");
  assert.equal(S().settings.sidebarSide, "right");
  assert.equal(S().windows[id].sidebarOpen, true);
});
