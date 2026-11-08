import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { mount } = await import("../../test-hooks.mjs");
const { animations } = await import("react-native");
const { usePeek } = await import("./usePeek.ts");
const dm = await import("./dockMotion.ts");

const HIDE_DELAY_MS = 120;

function sceneOf(t, props = { enabled: true }) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  animations.held = true;
  animations.running = [];
  const peek = mount(({ enabled }) => usePeek(enabled), { props });
  t.after(() => {
    peek.unmount();
    animations.held = false;
    animations.running = [];
  });
  return peek;
}

function peekOut(peek) {
  peek.value.show();
  animations.finish();
  assert.equal(peek.value.live, true);
  assert.equal(peek.value.holding, true, "a peek that is out holds its wide zone");
}

function slidingAway(t, peek) {
  peek.value.hide();
  t.mock.timers.tick(HIDE_DELAY_MS);
}

test("a peek lets go of its wide zone the moment it starts sliding away, so the pointer coming back beside the panel can't pull it out again (#674)", (t) => {
  const peek = sceneOf(t);
  peekOut(peek);
  peek.value.hide();
  t.mock.timers.tick(HIDE_DELAY_MS - 1);
  assert.equal(peek.value.holding, true, "within the hide delay a quick return still cancels the hide");
  t.mock.timers.tick(1);
  assert.equal(peek.value.live, true, "the panel is still on screen while it slides");
  assert.equal(peek.value.holding, false, "but it no longer holds the column beside it");
  const hold = dm.peekHoldWidth(240, 5);
  assert.equal(dm.edgeWatchWidth(peek.value.holding, false, hold, 9), 0, "so the native watcher stops reporting that column");
  animations.finish();
  assert.equal(peek.value.live, false);
  assert.equal(peek.value.holding, false);
});

test("touching the edge while the peek slides away brings it back, and it holds again", (t) => {
  const peek = sceneOf(t);
  peekOut(peek);
  slidingAway(t, peek);
  assert.equal(peek.value.holding, false);
  peek.value.show();
  assert.equal(peek.value.live, true);
  assert.equal(peek.value.holding, true);
  animations.finish();
  assert.equal(peek.value.live, true, "the interrupted slide never closes it");
  assert.equal(peek.value.holding, true);
});

test("a return within the hide delay keeps the peek out", (t) => {
  const peek = sceneOf(t);
  peekOut(peek);
  peek.value.hide();
  t.mock.timers.tick(HIDE_DELAY_MS - 20);
  peek.value.show();
  t.mock.timers.tick(HIDE_DELAY_MS * 2);
  assert.equal(peek.value.live, true);
  assert.equal(peek.value.holding, true);
});

test("a peek that is switched off while out stops holding as it slides away, then closes", (t) => {
  const peek = sceneOf(t);
  peekOut(peek);
  peek.rerender({ enabled: false });
  assert.equal(peek.value.live, true);
  assert.equal(peek.value.holding, false);
  animations.finish();
  assert.equal(peek.value.live, false);
  assert.equal(peek.value.holding, false);
});
