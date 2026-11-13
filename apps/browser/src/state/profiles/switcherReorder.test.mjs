import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("../telemetry/client.ts");
const usage = await import("../telemetry/usage.ts");
const { useBrowser } = await import("../browser/store.ts");
const { TAB_CLICK_SLOP } = await import("../sidebar/heldTabPress.ts");
const { switcherDragStarts, switcherDropSlot, switcherShift, switcherLift, switcherLanding, dropSwitcherProfile } = await import("./switcherReorder.ts");
after(() => client.setSharing(false, "settings"));

const S = useBrowser.getState;
const DOT = 12;
const ICON = 26;

beforeEach(() => {
  S().hydrate({});
  for (const name of ["Work", "Side"]) S().createProfile({ name });
});

test("a press that drifts within the sidebar's click slop stays a click, one that goes past it starts a drag", () => {
  assert.equal(switcherDragStarts(4, 3), false);
  assert.equal(switcherDragStarts(TAB_CLICK_SLOP, 0), false);
  assert.equal(switcherDragStarts(TAB_CLICK_SLOP + 1, 0), true);
  assert.equal(switcherDragStarts(-(TAB_CLICK_SLOP + 1), 2), true);
});

test("the dragged dot takes a neighbour's place once its centre passes the neighbour's centre", () => {
  const widths = [DOT, DOT, DOT];
  assert.equal(switcherDropSlot(widths, 0, 5), 0);
  assert.equal(switcherDropSlot(widths, 0, 13), 1);
  assert.equal(switcherDropSlot(widths, 0, 25), 2);
  assert.equal(switcherDropSlot(widths, 0, 400), 2);
  assert.equal(switcherDropSlot(widths, 2, -13), 1);
  assert.equal(switcherDropSlot(widths, 2, -400), 0);
});

test("icons of different widths: the slot follows each cell's own centre", () => {
  const widths = [ICON, DOT, ICON];
  assert.equal(switcherDropSlot(widths, 1, 14), 1);
  assert.equal(switcherDropSlot(widths, 1, 20), 2);
  assert.equal(switcherDropSlot(widths, 1, -20), 0);
});

test("the others make room by the dragged cell's width, and the lifted cell stays inside the row", () => {
  const widths = [ICON, DOT, ICON];
  assert.deepEqual([0, 1, 2].map((j) => switcherShift(widths, 0, 2, j)), [0, -ICON, -ICON]);
  assert.deepEqual([0, 1, 2].map((j) => switcherShift(widths, 2, 0, j)), [ICON, ICON, 0]);
  assert.deepEqual([0, 1, 2].map((j) => switcherShift(widths, 1, 1, j)), [0, 0, 0]);
  assert.equal(switcherLift(widths, 0, 500), DOT + ICON);
  assert.equal(switcherLift(widths, 0, -50), 0);
  assert.equal(switcherLift(widths, 1, 5), 5);
  assert.equal(switcherLanding(widths, 0, 2), DOT + ICON);
  assert.equal(switcherLanding(widths, 2, 0), -(ICON + DOT));
  assert.equal(switcherLanding(widths, 1, 2), ICON);
  assert.equal(switcherLanding(widths, 1, 1), 0);
});

test("dropping the first profile past the third moves it to the end", () => {
  const [first, second, third] = S().profileOrder;
  assert.equal(dropSwitcherProfile(first, switcherDropSlot([DOT, DOT, DOT], 0, 30)), true);
  assert.deepEqual(S().profileOrder, [second, third, first]);
});

test("a drop on its own slot, or of a profile that's gone, changes nothing", () => {
  const order = S().profileOrder;
  assert.equal(dropSwitcherProfile(order[1], 1), false);
  assert.equal(dropSwitcherProfile("gone", 0), false);
  assert.equal(S().profileOrder, order);
});

test("a drop doesn't switch the window's profile", () => {
  const w = S().createWindow({ url: "https://a.com/" });
  const shown = S().windows[w].profileId;
  dropSwitcherProfile(S().profileOrder[0], 2);
  assert.equal(S().windows[w].profileId, shown);
});

test("reorders by drag are counted in usage_counts", async () => {
  client.setSharing(true, "onboarding");
  usage.sessionEnding();
  stub.docs.delete("telemetry-queue.json");
  const order = S().profileOrder;
  dropSwitcherProfile(order[0], 2);
  dropSwitcherProfile(order[0], 2);
  dropSwitcherProfile(S().profileOrder[2], 0);
  usage.sessionEnding();
  await client.saveQueueNow();
  const sent = JSON.parse(stub.docs.get("telemetry-queue.json")).events.filter((e) => e.event === "usage_counts").map((e) => e.properties);
  assert.equal(sent.at(-1).profile_switcher_reorders, 2);
});
