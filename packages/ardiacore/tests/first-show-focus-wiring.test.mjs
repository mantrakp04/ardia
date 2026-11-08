import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ios = new URL("../ios/", import.meta.url);
const native = (file) => readFileSync(new URL(file, ios), "utf8");

const bodyOf = (text, signature) => {
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `${signature} is in the source`);
  const open = text.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  assert.fail(`${signature} has no closing brace`);
};

const marksFirstShow = "_focus.onFirstShow = YES;";

test("the page focus state remembers that its page still needs focus on first show", () => {
  const state = bodyOf(native("ArdiaWebViewInternal.h"), "struct ArdiaPageFocusState");
  assert.match(state, /BOOL onFirstShow\{\};/);
});

test("a tab taken from an offer marks its view before it is held or attached", () => {
  const ensure = bodyOf(native("ArdiaWebView+Transfer.mm"), "- (void)ensureTab {");
  const offered = ensure.slice(ensure.indexOf('hasPrefix:@"ardiacore:"'));
  const mark = offered.indexOf(marksFirstShow);
  assert.ok(mark >= 0, "the offered branch marks the view");
  assert.ok(mark < offered.indexOf("holdTransferOf:offered"), "the mark comes before the hold");
  assert.ok(mark < offered.indexOf("[self attach:offered]"), "the mark comes before the attach");
});

test("a parked link tab marks its view before it is taken, and unmarks it when it is not", () => {
  const take = bodyOf(native("ArdiaWebView+Transfer.mm"), "- (BOOL)takeLinkTab:");
  const mark = take.indexOf(marksFirstShow);
  const taken = take.indexOf("[self takeTransferredTab] != ArdiaTransferNone");
  assert.ok(mark >= 0 && taken > mark, "the link tab marks the view before takeTransferredTab");
  const unmark = take.indexOf("_focus.onFirstShow = NO;", taken);
  assert.ok(unmark > taken && unmark < take.indexOf("discardTab:tab"), "a discarded link tab leaves no mark");
});

test("settling a first-show request starts the focus window only once the view shows its page", () => {
  const settle = bodyOf(native("ArdiaWebView+Focus.mm"), "- (void)settleFirstShowFocus {");
  assert.match(settle, /if \(!_focus\.onFirstShow \|\| !_tab \|\| !_visible \|\| !self\.window\) return;/);
  const cleared = settle.indexOf("_focus.onFirstShow = NO;");
  const requested = settle.indexOf("[self requestFocusRestore];");
  assert.ok(cleared >= 0 && requested > cleared, "the mark is cleared, then focus is requested");
});

test("a request is settled when the view becomes visible and when the page is attached", () => {
  const visible = bodyOf(native("ArdiaWebView.mm"), "- (void)setVisible:(BOOL)visible {");
  assert.match(visible, /if \(visible\) \[self settleFirstShowFocus\];/);
  const attach = bodyOf(native("ArdiaWebView+Tab.mm"), "- (void)attach:(ArdiaCoreTab *)tab {");
  assert.ok(attach.trimEnd().endsWith("[self settleFirstShowFocus];\n}"), "attach ends by settling the request");
});

test("a view that lets go of its tab forgets the request", () => {
  const detach = bodyOf(native("ArdiaWebView+Tab.mm"), "- (void)detach {");
  assert.match(detach, /_focus\.onFirstShow = NO;/);
});
