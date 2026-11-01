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
