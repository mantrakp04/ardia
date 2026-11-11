import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const core = "../../../../packages/ardiacore/ios/";
const bodyOf = (source, signature) => {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} is missing`);
  const end = source.indexOf("\n}", start);
  return source.slice(start, end);
};

test("a reserved key goes to the main menu only when a focused Developer Tools doesn't keep it", () => {
  const hook = bodyOf(read(`${core}ArdiaWindowController.mm`), "- (BOOL)window:(ArdiaCoreWindow *)window preHandleKeyEvent:");
  const keeps = hook.indexOf("KeepsReservedKeyInDevTools(window.window, event)");
  const menu = hook.indexOf("performKeyEquivalent");
  assert.ok(keeps >= 0, "preHandleKeyEvent must ask KeepsReservedKeyInDevTools before it sends a reserved key to the main menu");
  assert.ok(keeps < menu, "KeepsReservedKeyInDevTools must be asked before the main menu runs the key");
});

test("Developer Tools keeps only Copy URL's key, and only when the focus is inside a tab's Developer Tools view", () => {
  const header = read(`${core}ArdiaChromeWindowInternal.h`);
  assert.match(header, /bool KeepsReservedKeyInDevTools\(NSWindow \*window, NSEvent \*event\);/, "declare KeepsReservedKeyInDevTools beside KeepsUnhandledSidebarKeyInPage");
  const source = read(`${core}ArdiaReservedKeys.mm`);
  assert.match(source, /kCopyUrlIdentifier = @"ardia\.command\.copyUrl";/);
  const keeps = bodyOf(source, "bool KeepsReservedKeyInDevTools(NSWindow *window, NSEvent *event)");
  assert.match(keeps, /kCopyUrlIdentifier/, "only the Copy URL item is kept");
  assert.match(keeps, /firstResponder/, "the focus decides");
  assert.doesNotMatch(keeps, /@"ardia\./, "no other reserved key is named here, so they keep going to the main menu");
  const inDevTools = bodyOf(source, "bool IsInDevTools(NSView *view)");
  assert.match(inDevTools, /devtoolsView/, "the Developer Tools view is the one ArdiaWebView tracks");
  assert.match(inDevTools, /isDescendantOf:/);
});

test("the shortcuts test expects a focused Developer Tools to own ⇧⌘C, and Ardia to keep it reserved elsewhere", () => {
  const script = read("../../scripts/shortcuts-test.mjs");
  const reserved = script.match(/const reservedShortcuts = new Set\(\[([\s\S]*?)\]\);/)[1];
  assert.match(script, /\["⇧⌘C", [^\n]*\{ command: "copyUrl" \}[^\n]*"devtools-own"\],/);
  assert.match(reserved, /"⇧⌘C"/);
});
