import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, test } from "node:test";

const callbacks = new Set();
const queries = [];
let removals = 0;
globalThis.tabPressAccessibility = {
  isReduceMotionEnabled: () => {
    assert.equal(callbacks.size, 1);
    return new Promise((resolve) => queries.push(resolve));
  },
  addEventListener: (event, listener) => {
    assert.equal(event, "reduceMotionChanged");
    callbacks.add(listener);
    return { remove: () => { callbacks.delete(listener); removals++; } };
  },
};
const native = "data:text/javascript," + encodeURIComponent("export const AccessibilityInfo = globalThis.tabPressAccessibility;");
registerHooks({ resolve: (specifier, context, next) => specifier === "react-native" ? { url: native, shortCircuit: true } : next(specifier, context) });
const { tabPressMotion } = await import("./tabPressMotion.ts");
const emit = (on) => { for (const callback of callbacks) callback(on); };

beforeEach(() => {
  assert.equal(callbacks.size, 0);
  queries.length = 0;
  removals = 0;
});

test("a newer Reduce Motion event outranks the initial asynchronous query", async (t) => {
  const stop = tabPressMotion.subscribe(() => {});
  t.after(stop);
  assert.equal(tabPressMotion.getSnapshot(), true);
  emit(true);
  queries[0](false);
  await Promise.resolve();
  assert.equal(tabPressMotion.getSnapshot(), true);
});

test("many tab subscribers share one query and listener until the last unsubscribes", (t) => {
  const notifications = Array(30).fill(0);
  const stops = notifications.map((_, i) => tabPressMotion.subscribe(() => notifications[i]++));
  t.after(() => stops.forEach((stop) => stop()));
  assert.equal(queries.length, 1);
  assert.equal(callbacks.size, 1);
  emit(false);
  assert.deepEqual(notifications, Array(30).fill(1));
  stops.slice(0, -1).forEach((stop) => stop());
  assert.equal(callbacks.size, 1);
  stops.at(-1)();
  assert.equal(callbacks.size, 0);
  assert.equal(removals, 1);
});

test("remount starts safe and ignores an earlier lifetime's pending query", async (t) => {
  const stop = tabPressMotion.subscribe(() => {});
  emit(false);
  assert.equal(tabPressMotion.getSnapshot(), false);
  stop();
  assert.equal(tabPressMotion.getSnapshot(), true);
  const remounted = tabPressMotion.subscribe(() => {});
  t.after(remounted);
  assert.equal(queries.length, 2);
  queries[0](false);
  await Promise.resolve();
  assert.equal(tabPressMotion.getSnapshot(), true);
  queries[1](false);
  await Promise.resolve();
  assert.equal(tabPressMotion.getSnapshot(), false);
});
