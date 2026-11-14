import assert from "node:assert/strict";
import { test } from "node:test";
import { takerOfOpenedTab } from "../../../../packages/expo-windows/src/engine/openedTabs.ts";

const page = (key, profile) => ({ key, profile });
const REGULAR = page("regular", "p-work");
const OTHER = page("other", "p-home");
const PRIVATE = page("private", "incognito-1@p-work");

test("a tab a page opened with no opener goes to a page of the same profile, not the first one mounted", () => {
  assert.equal(takerOfOpenedTab([REGULAR, OTHER, PRIVATE], "p-home"), OTHER);
  assert.equal(takerOfOpenedTab([REGULAR, OTHER, PRIVATE], "p-work"), REGULAR);
});

test("a tab opened from a private window never lands in a regular one", () => {
  assert.equal(takerOfOpenedTab([REGULAR, OTHER, PRIVATE], "incognito-1@p-work"), PRIVATE);
  assert.equal(takerOfOpenedTab([REGULAR, OTHER], "incognito-1@p-work"), undefined);
});

test("a private tab whose own window is gone goes to another private window of the same profile, as the engine shares their session", () => {
  const sibling = page("sibling", "incognito-2@p-work");
  const elsewhere = page("elsewhere", "incognito-3@p-home");
  assert.equal(takerOfOpenedTab([REGULAR, elsewhere, sibling], "incognito-1@p-work"), sibling);
  assert.equal(takerOfOpenedTab([REGULAR, elsewhere], "incognito-1@p-work"), undefined);
});

test("a tab of a profile with no page listening is taken by nobody", () => {
  assert.equal(takerOfOpenedTab([REGULAR, PRIVATE], "p-gone"), undefined);
  assert.equal(takerOfOpenedTab([], "p-work"), undefined);
});

test("a tab the engine names no profile for goes to a regular page, never a private one", () => {
  assert.equal(takerOfOpenedTab([PRIVATE, REGULAR], undefined), REGULAR);
  assert.equal(takerOfOpenedTab([PRIVATE], undefined), undefined);
});

test("the original profile's empty name matches only itself", () => {
  const original = page("original", "");
  assert.equal(takerOfOpenedTab([REGULAR, original], ""), original);
  assert.equal(takerOfOpenedTab([REGULAR], ""), undefined);
});
