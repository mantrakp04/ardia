import assert from "node:assert/strict";
import test from "node:test";

globalThis.__DEV__ = false;
globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 4);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);

const { Pager, setPagerReach } = await import("./shims/web/motion/pager.ts");
const { useBrowser } = await import("../../browser/src/state/browser/store.ts");
const { initialHostSession } = await import("./hostSession.ts");
const { installProfileWindows, pagesInPlace } = await import("./hostWindowProfiles.ts");

const S = () => useBrowser.getState();
const ORDER = ["default", "work", "side"];
let keys = 0;

function pager(blocked = new Set(["work"])) {
  const routed = [];
  setPagerReach({ hosts: (_key, id) => !blocked.has(id), route: (key, id) => routed.push([key, id]) });
  const states = [];
  const positions = [];
  const area = { pageWidth: () => 200, attached: () => true, onPosition: (p) => positions.push(p), onState: (e) => states.push(e) };
  const named = Pager.named(`w-${++keys}`);
  named.attach(area);
  named.configure({ key: named.key, selected: 0, count: ORDER.length, ack: 0, order: ORDER });
  return { named, area, routed, states, positions };
}

const settled = (named) => new Promise((resolve) => {
  const poll = () => named.snapshot().phase === "idle" ? resolve() : setTimeout(poll, 5);
  poll();
});

test("a swipe toward a profile this window can't host stops at the edge and routes to that profile's window", async () => {
  const { named, area, routed, states, positions } = pager();
  named.input(area, "began", 0, -1, 0);
  named.input(area, "changed", 300, -1, 0.05);
  named.input(area, "changed", 600, -1, 0.1);
  assert.ok(Math.max(...positions) < 1, `position reached ${Math.max(...positions)}`);
  named.input(area, "ended", 600, -1, 0.12);
  await settled(named);
  assert.equal(named.snapshot().selected, 0);
  assert.equal(named.snapshot().profileId, "default");
  assert.ok(!states.some((e) => e.selected !== 0), "never selects the isolated profile's page");
  assert.deepEqual(routed, [[named.key, "work"]]);
});

test("a short swipe toward a blocked profile springs back without routing", async () => {
  const { named, area, routed } = pager();
  named.input(area, "began", 0, -1, 0);
  named.input(area, "changed", 40, -1, 0.2);
  named.input(area, "ended", 40, -1, 0.4);
  await settled(named);
  assert.equal(named.snapshot().selected, 0);
  assert.deepEqual(routed, []);
});

test("menu and keyboard switches to a blocked profile are refused, so the shared fallback routes them", () => {
  const { named, routed } = pager();
  assert.equal(named.switchTo(1, ORDER), false);
  assert.equal(named.step(1, false, ORDER), false);
  assert.equal(named.snapshot().selected, 0);
  assert.deepEqual(routed, []);
});

test("profiles the window hosts still page in place", async () => {
  const { named, area, routed } = pager(new Set());
  named.input(area, "began", 0, -1, 0);
  named.input(area, "changed", 300, -1, 0.05);
  named.input(area, "ended", 300, -1, 0.3);
  await settled(named);
  assert.equal(named.snapshot().selected, 1);
  assert.equal(named.switchTo(2, ORDER), true);
  await settled(named);
  assert.equal(named.snapshot().selected, 2);
  assert.deepEqual(routed, []);
});

test("Linux pages in place only for profiles sharing the window's engine profile, and routes the rest", () => {
  S().hydrate(initialHostSession({ bootstrap: { windowId: "main", profileId: "default", startup: false } }, null));
  const work = S().createProfile({ name: "Work" });
  const side = S().createProfile({ name: "Side", shareWith: "default" });
  const focused = [];
  installProfileWindows(useBrowser, (id) => focused.push(id), async () => true);
  assert.equal(pagesInPlace(S(), "main", side), true);
  assert.equal(pagesInPlace(S(), "main", work), false);
  assert.equal(pagesInPlace(S(), "main", "default"), true);
  const before = Object.keys(S().windows).length;
  S().switchProfile("main", work);
  assert.equal(S().windows.main.profileId, "default");
  assert.equal(Object.keys(S().windows).length, before + 1);
});
