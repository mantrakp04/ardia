import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const path = (name) => fileURLToPath(new URL(name, import.meta.url));
const sources = [
  "../ios/ArdiaWebView+Painting.mm",
  "../ios/ArdiaWebView+Focus.mm",
  "../ios/ArdiaWebView+StandIn.mm",
  "../ios/ArdiaHoverProbe.mm",
  "../../shell/ios/FocusHandoff.swift",
];
const read = (name) => (existsSync(path(name)) ? readFileSync(path(name), "utf8") : "");
const painting = read("../ios/ArdiaWebView+Painting.mm");
const standIn = read("../ios/ArdiaWebView+StandIn.mm");
const probe = read("../ios/ArdiaHoverProbe.mm");
const handoff = read("../../shell/ios/FocusHandoff.swift");

const body = (source, header, closer = "\n}\n") => {
  const start = source.indexOf(header);
  if (start < 0) return "";
  const end = source.indexOf(closer, start);
  return source.slice(start, end < 0 ? source.length : end);
};

test("every source the checks read exists", () => {
  const missing = sources.filter((name) => !existsSync(path(name)));
  assert.deepEqual(missing, []);
});

test("applyPainting takes focus from a lingering pane only after it unhides the page, so the page can take the focus back", () => {
  const paint = body(painting, "- (void)applyPainting {");
  const unhidden = paint.indexOf("sub.hidden = !shown;");
  const committed = paint.indexOf("[CATransaction commit];");
  const taken = paint.indexOf("[self takeFocusFromLingeringPane]");
  assert.ok(unhidden > 0 && committed > unhidden && taken > 0, "applyPainting unhides the page and takes focus from the lingering pane");
  assert.ok(taken > committed, "takeFocusFromLingeringPane runs before the page is unhidden, so focusPage is skipped for a hidden page");
});

test("taking focus from a lingering pane gives it to the page when the page is visible and shown", () => {
  const take = body(painting, "- (void)takeFocusFromLingeringPane {");
  assert.match(take, /if \(!\[window makeFirstResponder:nil\]\) return;/);
  assert.match(take, /_visible && !_standalone && page && page\.superview == self && !page\.isHiddenOrHasHiddenAncestor\) \[self focusPage\];/);
});

test("lending a page to a successor asks the successor to take the focus the page held", () => {
  const lend = body(standIn, "- (void)lendPageToSuccessor");
  assert.match(lend, /const BOOL heldFocus = /);
  assert.match(lend, /if \(heldFocus\) \{[\s\S]*\[holder requestFocusRestoreIn:window\];/);
});

test("a focus handoff that ends without restoring the page refocuses the visible page when the window has no responder", () => {
  const end = body(handoff, "private func end(_ gate: Gate, restoring: Bool) {", "\n  }\n");
  assert.match(end, /guard let window = gate\.window, Self\.unfocused\(window\) else \{ return \}/);
  assert.match(end, /afterPendingUI \{[\s\S]*Self\.unfocused\(window\)[\s\S]*ArdiaWebView\.focusVisiblePage\(in: window\)/);
});

test("the hover probe repairs a key window with no first responder on a click over the page", () => {
  const safe = body(probe, "bool SafeToHeal(");
  assert.match(safe, /HoverReason::responderLost\) return trigger == HoverTrigger::click && check\.overPage && check\.windowKey;/);
  const heal = body(probe, "void Heal(");
  assert.match(heal, /reason == HoverReason::responderLost\) \{\s*NSView \*page = PageAt\(window, point\);\s*if \(page\) \[window makeFirstResponder:page\];/);
});
