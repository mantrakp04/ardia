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
  const menu = hook.indexOf("ArdiaPerformReservedKey(event)");
  assert.ok(menu >= 0, "preHandleKeyEvent hands a reserved key to the main menu through ArdiaPerformReservedKey");
  assert.ok(keeps >= 0, "preHandleKeyEvent must ask KeepsReservedKeyInDevTools before it sends a reserved key to the main menu");
  assert.ok(keeps < menu, "KeepsReservedKeyInDevTools must be asked before the main menu runs the key");
});

test("a key Developer Tools keeps is refused at the hook and counted once, never handled", () => {
  const hook = bodyOf(read(`${core}ArdiaWindowController.mm`), "- (BOOL)window:(ArdiaCoreWindow *)window preHandleKeyEvent:");
  const kept = hook.match(/if \(KeepsReservedKeyInDevTools\(window\.window, event\)\) \{([\s\S]*?)\n  \}/);
  assert.ok(kept, "the Developer Tools branch must be a block that counts the handoff");
  assert.match(kept[1], /\[ArdiaEvents emit:@"engine\.devToolsKeyKept" data:@\{\}\];/, "the handoff is reported to the app");
  assert.match(kept[1], /NSEventTypeKeyDown && !event\.isARepeat/, "only the first key down counts");
  assert.match(kept[1], /\n    return NO;$/, "a key Developer Tools keeps must return NO so the page and Developer Tools get it");
  assert.doesNotMatch(kept[1], /return YES|performKeyEquivalent|ArdiaPerformReservedKey/, "the main menu never runs a key Developer Tools keeps");
  assert.ok(hook.indexOf("return NO;") < hook.indexOf("ArdiaPerformReservedKey(event)"), "the refusal comes before the main menu runs");
});

test("the kept-key handoff travels from the hook to a capped, property-free telemetry event", () => {
  const api = read("../../../../packages/ardiacore/src/engine/api.ts");
  assert.match(api, /"engine\.devToolsKeyKept": Record<string, never>;/);
  assert.match(read("./performance.ts"), /onDevToolsKeyKept = \(listener: \(\) => void\) => on\("engine\.devToolsKeyKept", listener\);/);
  const keys = read("../state/telemetry/devToolsKeys.ts");
  assert.match(keys, /const MAX_DEVTOOLS_KEY_EVENTS = 20;/);
  assert.match(keys, /if \(sent >= MAX_DEVTOOLS_KEY_EVENTS\) return;/);
  assert.match(keys, /capture\("devtools_key_kept"\);/);
  assert.match(keys, /watchDevToolsKeys = \(\) => onDevToolsKeyKept\(trackDevToolsKeyKept\);/);
  assert.match(read("../state/telemetry/index.ts"), /startUsage\(\);\s*watchDevToolsKeys\(\);/);
  const copy = read("../state/telemetry/copy.ts");
  assert.match(copy, /That ⇧⌘C was passed to a focused Developer Tools instead of copying the page address, once per press/);
  assert.doesNotMatch(copy, /element picker on or off/, "the event is a handoff, it doesn't say the picker toggled");
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
  assert.match(keeps, /IsDevToolsPickerKey\(event\)/, "only the key Developer Tools uses is kept, not whatever Copy URL is rebound to");
  const pickerKey = bodyOf(source, "bool IsDevToolsPickerKey(NSEvent *event)");
  assert.match(pickerKey, /ModifiersOfKey\(@"c", event\.modifierFlags\) == \(NSEventModifierFlagCommand \| NSEventModifierFlagShift\)/, "⇧⌘C and no other modifiers");
  assert.match(pickerKey, /charactersIgnoringModifiers\.lowercaseString isEqualToString:@"c"/, "the C key");
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
