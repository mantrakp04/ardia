import assert from "node:assert/strict";
import { test } from "node:test";
import { holesFor } from "../../../../packages/expo-windows/src/engine/covers.ts";

const card = { x: 100, y: 50, width: 600, height: 400, radius: 12 };
const popover = { x: 650, y: 60, width: 200, height: 100, radius: 8 };

test("a Peek's page keeps the card behind it, and the page under the Peek gets the card's hole", () => {
  const peekPage = { x: 110, y: 90, width: 580, height: 350 };
  const basePage = { x: 0, y: 40, width: 900, height: 600 };
  assert.deepEqual(holesFor(peekPage, [card, popover], true), [[650, 60, 200, 100, 8]], "a popover over part of the Peek still cuts it");
  assert.deepEqual(holesFor(basePage, [card, popover], false), [
    [100, 50, 600, 400, 12],
    [650, 60, 200, 100, 8],
  ]);
  assert.deepEqual(holesFor(peekPage, [card], false), [[100, 50, 600, 400, 12]], "an ordinary page under a cover that encloses it is still hidden");
  assert.deepEqual(holesFor(peekPage, [{ x: 0, y: 0, width: 50, height: 50, radius: 0 }], true), [], "a cover elsewhere cuts nothing");
});

const { coversIn } = await import("../../../../packages/expo-windows/src/engine/covers.ts");
const { coverClip, coverMeasurer, watchClips } = await import("../../../../packages/expo-windows/src/engine/coverClip.ts");

const node = (x, y, width, height) => ({ box: { x, y, width, height }, measureInWindow(callback) {
  setTimeout(() => callback(this.box.x, this.box.y, this.box.width, this.box.height), 0);
} });

test("a surface on the next profile's sidebar page, clipped out beside the sidebar, cuts no hole in the page", async () => {
  const windowId = "clip-window";
  const sidebarPages = node(8, 44, 240, 600);
  const page = { x: 256, y: 8, width: 900, height: 640 };
  const currentRow = node(14, 52, 228, 34);
  const nextProfileRow = node(254, 52, 228, 34);
  const clips = [coverClip(() => sidebarPages)];
  const current = coverMeasurer(windowId, "current-row", 10, () => currentRow, clips);
  const next = coverMeasurer(windowId, "next-row", 10, () => nextProfileRow, clips);
  await Promise.all([current.measure(), next.measure()]);
  assert.deepEqual(coversIn(windowId), [{ x: 14, y: 52, width: 228, height: 34, radius: 10 }], "only the row inside the sidebar is a cover");
  assert.deepEqual(holesFor(page, coversIn(windowId), false), [], "the page beside the sidebar keeps no hole");

  nextProfileRow.box.x = 134;
  await next.measure();
  assert.deepEqual(coversIn(windowId).at(-1), { x: 134, y: 52, width: 114, height: 34, radius: 10 }, "mid-swipe, the part still inside the sidebar stays a cover");

  nextProfileRow.box.x = 254;
  await next.measure();
  assert.equal(coversIn(windowId).length, 1, "swiped back out, its cover goes");

  const menu = node(300, 60, 200, 100);
  const unclipped = coverMeasurer(windowId, "menu", 8, () => menu, []);
  await unclipped.measure();
  assert.deepEqual(holesFor(page, coversIn(windowId), false), [[300, 60, 200, 100, 8]], "a surface under no clip still cuts its hole");
});

test("a measurement that lands after the surface stopped never brings its cover back", async () => {
  const windowId = "late-window";
  const surface = node(0, 0, 50, 50);
  const measurer = coverMeasurer(windowId, "late", 0, () => surface, []);
  const pending = measurer.measure();
  measurer.stop();
  await pending;
  assert.deepEqual(coversIn(windowId), []);
});

test("a clip that grows or moves without its surfaces laying out has them measured again", async () => {
  const windowId = "moving-clip-window";
  const strip = node(0, 0, 400, 40);
  const tab = node(380, 4, 120, 32);
  const clip = coverClip(() => strip);
  const measurer = coverMeasurer(windowId, "tab", 8, () => tab, [clip]);
  const measured = [];
  const unwatch = watchClips([clip], () => measured.push(measurer.measure()));
  await measurer.measure();
  assert.deepEqual(coversIn(windowId), [{ x: 380, y: 4, width: 20, height: 32, radius: 8 }]);
  strip.box.width = 900;
  clip.moved();
  await Promise.all(measured);
  assert.deepEqual(coversIn(windowId), [{ x: 380, y: 4, width: 120, height: 32, radius: 8 }], "the window grew, so the whole tab shows");
  unwatch();
  strip.box.width = 400;
  clip.moved();
  assert.equal(measured.length, 1, "a surface that stopped watching is not measured");
});
