import assert from "node:assert/strict";
import test from "node:test";
import { notingPageFocus, watchPageFocus } from "./pageFocus.ts";

test("a page taking focus tells every watcher before the page's own focus handler runs", () => {
  const calls = [];
  const stopA = watchPageFocus(() => calls.push("a"));
  const stopB = watchPageFocus(() => calls.push("b"));
  const props = notingPageFocus({ tabId: "t1", onPageFocus: () => calls.push("page") });
  props.onPageFocus();
  assert.deepEqual(calls, ["a", "b", "page"]);
  stopA();
  props.onPageFocus();
  assert.deepEqual(calls, ["a", "b", "page", "b", "page"]);
  stopB();
  notingPageFocus({})?.onPageFocus();
  assert.equal(calls.length, 5);
});

test("a focus watcher that throws doesn't keep the other watchers or the page's own focus handler from running", () => {
  const calls = [];
  const reported = [];
  const original = console.error;
  console.error = (...args) => reported.push(args);
  const stopA = watchPageFocus(() => { throw new Error("watcher failed"); });
  const stopB = watchPageFocus(() => calls.push("b"));
  try {
    notingPageFocus({ onPageFocus: () => calls.push("page") }).onPageFocus();
  } finally {
    console.error = original;
    stopA();
    stopB();
  }
  assert.deepEqual(calls, ["b", "page"]);
  assert.equal(reported.length, 1);
  assert.equal(reported[0][1].message, "watcher failed");
});
