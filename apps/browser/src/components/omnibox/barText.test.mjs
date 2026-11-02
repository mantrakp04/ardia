import assert from "node:assert/strict";
import { test } from "node:test";
const { barReducer, initialBar, selectionTracker } = await import("./barText.ts");

const fresh = (text = "", none = 0) => initialBar(null, text, none);
const run = (state, ...events) => events.reduce(barReducer, state);
const google = { kind: "site", id: "google", name: "Google" };

test("a bar opened on a page shows its address selected, nothing typed yet", () => {
  assert.deepEqual(fresh("https://example.com/"), {
    typed: "https://example.com/",
    edited: false,
    suppressCompletion: true,
    selected: 0,
    scope: null,
    scopeFrom: "",
    pendingSelection: { start: 0, end: 20 },
  });
  assert.equal(fresh("", -1).selected, -1);
  assert.equal(fresh("").pendingSelection, null);
});

test("a key applies the change as the field read it, and the completion comes back only when the read allows it", () => {
  const s = run(fresh(), { kind: "typed", text: "g", suppress: false, selected: 0 });
  assert.equal(s.typed, "g");
  assert.equal(s.edited, true);
  assert.equal(s.suppressCompletion, false);
  assert.equal(run(s, { kind: "typed", text: "", suppress: true, selected: -1 }).selected, -1);
});

test("Esc with a completion showing drops only the completion", () => {
  const s = run(fresh(), { kind: "typed", text: "gi", suppress: false, selected: 2 });
  assert.deepEqual(run(s, { kind: "completionDropped" }), { ...s, suppressCompletion: true });
});

test("→ or a click at the end accepts the completion as typed text and puts the top row back", () => {
  const s = run(fresh(), { kind: "typed", text: "gi", suppress: false, selected: 3 }, { kind: "caretAccepted", text: "github.com" });
  assert.equal(s.typed, "github.com");
  assert.equal(s.suppressCompletion, true);
  assert.equal(s.selected, 0);
  assert.equal(s.pendingSelection, null);
});

test("Tab without a site to search accepts the completion and puts the caret at its end", () => {
  const s = run(fresh(), { kind: "typed", text: "gi", suppress: false, selected: 1 }, { kind: "tabAccepted", text: "github.com" });
  assert.equal(s.typed, "github.com");
  assert.equal(s.selected, 1);
  assert.deepEqual(s.pendingSelection, { start: 10, end: 10 });
});

test("Tab or Space after a site enters its search with an empty field, and Backspace leaves it restoring what was shown", () => {
  const typed = run(fresh(), { kind: "typed", text: "google", suppress: false, selected: 2 });
  const scoped = run(typed, { kind: "enteredScope", scope: google, from: "google.com" });
  assert.deepEqual(scoped, { ...typed, scope: google, scopeFrom: "google.com", typed: "", edited: true, selected: 0, suppressCompletion: true });
  const left = run(scoped, { kind: "leftScope", restore: "google.com" });
  assert.equal(left.scope, null);
  assert.equal(left.typed, "google.com");
  assert.deepEqual(left.pendingSelection, { start: 10, end: 10 });
  const escaped = run(run(scoped, { kind: "typed", text: "cats", suppress: false, selected: 1 }), { kind: "leftScope", restore: null });
  assert.equal(escaped.scope, null);
  assert.equal(escaped.typed, "cats");
  assert.equal(escaped.selected, 0);
});

test("the New Tab box comes back from a tab switch with its scope and the text it came from", () => {
  const restored = initialBar({ typed: "", edited: true, selection: { start: 0, end: 0 }, selected: 0, scope: google, scopeFrom: "x.com " }, "", -1);
  assert.equal(restored.scope, google);
  assert.equal(restored.scopeFrom, "x.com ");
  assert.deepEqual(restored.pendingSelection, { start: 0, end: 0 });
});

test("a calculator row copies its answer into the field, selected, without moving the row", () => {
  const s = run(fresh(), { kind: "typed", text: "2+2", suppress: false, selected: 0 }, { kind: "selected", index: 1 }, { kind: "calculated", text: "4" });
  assert.equal(s.typed, "4");
  assert.equal(s.selected, 1);
  assert.deepEqual(s.pendingSelection, { start: 0, end: 1 });
});

test("an edit from the field's menu replaces the text with the caret where the menu put it", () => {
  const s = run(fresh("https://a.test/"), { kind: "selected", index: 2 }, { kind: "edited", text: "https://a.test/x", caret: 5 });
  assert.equal(s.typed, "https://a.test/x");
  assert.equal(s.edited, true);
  assert.equal(s.selected, 0);
  assert.deepEqual(s.pendingSelection, { start: 5, end: 5 });
});

test("clearing the hero bar empties it and leaves site search, the selection applied once", () => {
  const scoped = run(fresh("", -1), { kind: "enteredScope", scope: google, from: "google.com" }, { kind: "select", selection: { start: 0, end: 3 } });
  const cleared = run(scoped, { kind: "reset", selected: -1 }, { kind: "selectionApplied" });
  assert.equal(cleared.typed, "");
  assert.equal(cleared.edited, false);
  assert.equal(cleared.scope, null);
  assert.equal(cleared.selected, -1);
  assert.equal(cleared.pendingSelection, null);
});

test("a key reads the selection from before its own caret move, and an older move is just the selection", () => {
  let t = 1000;
  const sel = selectionTracker({ start: 0, end: 10 }, () => t);
  sel.note({ start: 1, end: 1 });
  t += 20;
  assert.deepEqual(sel.beforeEdit(), { start: 0, end: 10 });
  t += 100;
  assert.deepEqual(sel.beforeEdit(), { start: 1, end: 1 });
  sel.note({ start: 1, end: 1 });
  assert.deepEqual(sel.before, { start: 0, end: 10 }, "a report of the same selection isn't a move");
  sel.collapse();
  assert.deepEqual(sel.current, { start: 0, end: 0 });
  assert.deepEqual(sel.before, { start: 0, end: 10 });
});
