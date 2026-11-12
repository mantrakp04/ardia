import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

const recorderGate = () => read("packages/shell/ios/ShortcutRecorder.swift").match(/guard ([^\n]*) else \{\n\s*NSSound\.beep\(\)/)?.[1];
const reservedGate = () => read("packages/ardiacore/ios/ArdiaReservedKeys.mm").match(/if \((!fKey [^\n]*)\) return nil;/)?.[1];
const engine = () => read("engine/ardiacore/src/ardia/core/ac_browser_window_keyboard.mm");

test("the shortcut recorder accepts an Option chord, and still refuses bare and Shift-only keys", () => {
  const gate = recorderGate();
  assert.ok(gate, "found the recorder's check");
  assert.match(gate, /flags\.contains\(\.option\)/);
  assert.match(gate, /flags\.contains\(\.command\)/);
  assert.match(gate, /flags\.contains\(\.control\)/);
  assert.doesNotMatch(gate, /\.shift/);
});

test("a reserved command bound to an Option chord beats the page", () => {
  const gate = reservedGate();
  assert.ok(gate, "found the reserved-key check");
  assert.match(gate, /NSEventModifierFlagOption/);
  assert.match(gate, /NSEventModifierFlagCommand/);
  assert.match(gate, /NSEventModifierFlagControl/);
  assert.doesNotMatch(gate, /NSEventModifierFlagShift/);
});

test("the engine hands an unhandled Option chord to the main menu, and tells the page it is a shortcut", () => {
  const source = engine();
  const preHandle = source.match(/PreHandleKeyboardEvent\([\s\S]*?\n\}\n/)?.[0];
  const handle = source.match(/ACBrowserWindow::HandleKeyboardEvent\([\s\S]*?\n\}\n/)?.[0];
  assert.ok(preHandle && handle, "found both key handlers");
  assert.match(preHandle, /NSEventModifierFlagOption[\s\S]*MenuHasKeyEquivalent\(NSApp\.mainMenu/);
  assert.match(handle, /NSEventModifierFlagOption[\s\S]*performKeyEquivalent/);
});
