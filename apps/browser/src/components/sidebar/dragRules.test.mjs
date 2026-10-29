import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const zones = load("dragZones");
const tiles = load("dragTiles");
const session = load("dragSession");

function states(steps) {
  let st = {};
  return steps.filter((s) => s.step).map((s) => (st = { ...st, ...s, step: s.step }));
}
const at = (steps, label) => states(steps).find((s) => s.step === label);
const moves = (steps) => states(steps).filter((s) => s.step.startsWith("move"));
const committed = (steps) => steps.find((s) => s.committed)?.committed;

test("away: the 40 pt bound is strict on both sides, and a drag outside the window has no drop", () => {
  const t = zones["away bounds"];
  assert.notEqual(at(t, "move 240,330").drop.type, "none");
  assert.equal(at(t, "move 240.5,330").drop.type, "none");
  const left = zones["away left bound"];
  assert.notEqual(at(left, "move 10,330").drop.type, "none");
  assert.equal(at(left, "move 9.5,330").drop.type, "none");
  assert.equal(at(zones["away outside window"], "move 60,-3000").drop.type, "none");
});

test("onto: the middle half of a row, strictly, with no x test", () => {
  const t = zones["onto bounds"];
  for (const label of ["move 60,325", "move 5,325", "move 239,325", "move 60,316.6", "move 60,333.4"]) assert.equal(at(t, label).drop.type, "onto", label);
  assert.notEqual(at(t, "move 60,333.5").drop.type, "onto");
  assert.notEqual(at(t, "move 60,316.5").drop.type, "onto");
  assert.equal(at(zones["onto overlap"], "move 60,222").onto, "t:a", "overlapping rows: the first registered");
});

test("pinned rows: tabs keep 6 pt of hysteresis over the list's edge, groups use the edge itself", () => {
  const row = moves(zones["row hysteresis"]).map((s) => s.drop.placement?.pinned);
  assert.deepEqual(row, [false, false, false, false, false, true, true, true, true, false]);
  const group = moves(zones["group edge"]).map((s) => s.drop.placement?.pinned);
  assert.deepEqual(group, [false, false, false, true, true, true, true, false, false, false]);
});

test("pinned rows: the end of the pinned area is placed last, with the live folder's gap and the next block's anchor", () => {
  const past = moves(zones["row past live"]);
  assert.ok(past.some((s) => s.gapKey === "lf:LF(Documents)" && s.drop.placement?.last === true && s.drop.placement.beforeId === null));
  assert.ok(past.some((s) => s.gapKey === "lf:LF(Pull Requests)" && s.drop.placement?.beforeId === "p2"));
});

test("live folders: only among the pinned blocks, never the list", () => {
  const types = moves(zones["live sweep"]).map((s) => s.drop.type);
  assert.ok(types.every((t) => t === "live" || t === "none"));
  assert.ok(moves(zones["live sweep"]).filter((s) => s.drop.type === "none").every((s) => Number(s.step.split(",")[1]) > 300));
});

test("groups: never into their own subtree; a refused placement doesn't fall through to another zone", () => {
  for (const s of moves(zones["group sweep"])) {
    assert.notEqual(s.drop.placement?.parentId, "G(H)", s.step);
    assert.notEqual(s.into, "G(H)", s.step);
  }
  const types = new Set(moves(zones["emptied ancestor"]).map((s) => `${s.drop.type}:${s.drop.placement?.parentId ?? ""}`));
  assert.deepEqual([...types].sort(), ["group:G(Outer)", "none:"]);
});

test("groups: a collapsed group takes rows through its header only; the smaller of two nested groups wins", () => {
  const collapsed = moves(zones["collapsed header"]);
  assert.ok(collapsed.some((s) => s.into === "G(H)" && s.drop.placement?.groupId === "G(H)"));
  assert.ok(!collapsed.some((s) => s.drop.placement?.groupId === "G(H)" && s.into !== "G(H)"));
  assert.ok(moves(zones["nested smallest"]).some((s) => s.drop.placement?.groupId === "G(Inner)"));
});

test("splits: one row of pitch, never onto, into groups, pinned rows and the list", () => {
  const split = moves(zones["split sweep"]);
  assert.ok(split.every((s) => s.drop.type !== "onto"));
  assert.ok(split.every((s) => s.drop.type === "none" || s.pitch === 37));
  assert.ok(split.some((s) => s.drop.placement?.groupId));
  assert.ok(split.some((s) => s.drop.placement?.row));
  assert.ok(split.some((s) => s.drop.placement && !s.drop.placement.pinned && !s.drop.placement.groupId));
});

test("ties: equal transformed y goes by x then registration, and a pointer on a midpoint lands after", () => {
  assert.equal(at(zones["tie order"], "move 60,291").drop.type, "onto");
  assert.equal(committed(zones["tie order"]).tabIds.join(), "b,c,d,a");
});

test("tiles: a slot's pitch, no per-cell gap springs, and the grid grows by a row only when one is added", () => {
  for (const s of moves(tiles["tile sweep"])) if (s.drop.placement?.pinned && s.drop.placement.row === false) assert.equal(s.pitch, 47, s.step);
  for (const s of states(tiles["tile sweep"])) assert.deepEqual(Object.keys(s.gaps).filter((k) => k.startsWith("t:t")), [], s.step);
  assert.ok(states(tiles["row into tiles"]).some((s) => s.gridGrowth === 47));
  assert.ok(states(tiles["room clip"]).every((s) => s.gridGrowth <= 10));
  assert.ok(states(tiles["folder tile reorder"]).every((s) => s.gridGrowth <= 0), "a folder takes one cell");
});

test("held folder: a plain tile needs 400 ms, a target change cancels it, a ready hold widens the centre", () => {
  const hold = states(tiles["hold to fold"]);
  assert.equal(hold[2].drop.type, "tabs", "399 ms: not yet");
  assert.equal(hold[3].drop.type, "folder", "400 ms: a folder");
  assert.equal(hold[4].drop.type, "folder", "40 % off the middle still holds once ready");
  assert.equal(hold[5].drop.type, "tabs", "another tile cancels it");
  const reach = moves(tiles["hold reach"]).map((s) => [s.drop.type, s.hold?.key ?? null]);
  assert.deepEqual(reach, [
    ["tabs", "t:t3"],
    ["tabs", null],
    ["tabs", "t:t3"],
    ["folder", "t:t3"],
    ["folder", "t:t3"],
    ["folder", "t:t3"],
    ["tabs", null],
  ]);
});

test("existing folders take a tile or a row at once; a folder tile never folds into another", () => {
  assert.equal(moves(tiles["tile onto folder"])[0].drop.type, "folder");
  assert.equal(moves(tiles["row onto folder"])[0].drop.type, "folder");
  assert.ok(states(tiles["folder over tile"]).every((s) => s.drop.type !== "folder"));
});

test("folder panel: the first staying member anchors, leaving latches away, an empty panel blocks the rest", () => {
  assert.equal(at(tiles["panel reorder"], "move 101,184").drop.ontoId, "t2");
  const left = states(tiles["panel leave"]);
  const during = left.filter((s) => s.step.startsWith("move"));
  assert.ok(during.slice(1).every((s) => s.folderAway === true));
  assert.ok(during.slice(2).every((s) => s.drop.type !== "folder"), "back over the panel it stays out");
  assert.equal(at(tiles["empty panel"], "move 100,150").drop.type, "none");
  assert.equal(at(tiles["empty panel"], "move 100,220").drop.type, "none");
});

test("external: counted, no ghost, a placement only on commit, never over an internal drag", () => {
  const ext = session.external;
  assert.equal(at(ext, "enter again with 3").external, 3);
  assert.deepEqual(ext.at(-1).placed, { pinned: false, beforeId: "c" });
  assert.deepEqual(ext.at(-1).ghosts, [null, null]);
  const life = session["external lifecycle"];
  assert.equal(life.at(-1).cancelled, null);
  assert.equal(life.at(-1).early, null);
  assert.equal(at(life, "external over an internal drag").external, 0);
});

test("landing: a cancel or a list drop slides home or to the gap; onto, tile and pin drops don't", () => {
  const cases = Object.fromEntries(session["landing cases"].map((c) => [c.label, c.landed !== null]));
  assert.deepEqual(cases, {
    "row to the list": true,
    "row onto a row": false,
    "row into the pinned rows": true,
    "row into the tiles": false,
    "tile along the grid": false,
    "row to its own place": true,
    "row cancelled": true,
  });
});

test("lifecycle: an old landing, measurement or tilesLaidOut never touches a newer drag", () => {
  const landing = states(session["landing token"]);
  assert.deepEqual(landing.find((s) => s.step === "old landing finished").sources, ["t:a"]);
  assert.deepEqual(session["begin pending"].at(-1).ghosts, [null]);
  const late = states(session["tiles laid out token"]);
  const before = late.findIndex((s) => s.step === "old tilesLaidOut arrived");
  assert.deepEqual(late[before].drop, late[before - 1].drop);
});

test("hover cards and Escape capture are off for a drag and back after it, however it ends", () => {
  for (const c of session["hover and escape"].slice(0, 2)) {
    assert.equal(c.during.shows, false);
    assert.deepEqual(c.during.escape, [true]);
    assert.equal(c.after.shows, true);
    assert.deepEqual(c.after.escape, [true, false]);
  }
  const ext = session["hover and escape"][2];
  assert.equal(ext.external.shows, false);
  assert.deepEqual(ext.external.escape, []);
  assert.equal(ext.after.shows, true);
});
