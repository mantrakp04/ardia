import assert from "node:assert/strict";
import { test } from "node:test";
import { barKeyDown, barKeyDownEvents } from "./omniboxKeys.ts";

const items = [
  { kind: "search", url: "https://a.example/", title: "a" },
  { kind: "search", url: "https://b.example/", title: "b" },
  { kind: "search", url: "https://c.example/", title: "c" },
];

function press(key, selectedIndex, mods = { ctrlKey: true }) {
  const dispatched = [];
  const bar = { scope: null, typed: "a", scopeFrom: null, dispatch: (a) => dispatched.push(a) };
  barKeyDown(
    { nativeEvent: { key, ...mods } },
    { bar, hero: false, shownCompletion: "", input: "a", items, selectedIndex, previewing: false, current: items[selectedIndex], tabScope: null, cancelBang() {}, reset() {}, removeRow() {}, forceSearch() {}, go() {}, choose() {} },
  );
  return dispatched;
}

for (const [key, from, to] of [["n", 0, 1], ["j", 0, 1], ["j", 2, 0], ["p", 1, 0], ["k", 1, 0], ["k", 0, 2]]) {
  test(`⌃${key.toUpperCase()} moves the selection from row ${from} to row ${to}`, () => {
    assert.deepEqual(press(key, from), [{ kind: "selected", index: to }]);
  });
}

test("plain j and k leave the selection alone", () => {
  assert.deepEqual(press("j", 0, {}), []);
  assert.deepEqual(press("k", 1, {}), []);
});

test("the bar claims ⌃J, ⌃K, ⌃N and ⌃P from the native field in every key set", () => {
  for (const events of [barKeyDownEvents(false, false), barKeyDownEvents(true, false), barKeyDownEvents(false, true)])
    for (const key of ["j", "k", "n", "p"]) assert.ok(events.some((e) => e.key === key && e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey), key);
});
