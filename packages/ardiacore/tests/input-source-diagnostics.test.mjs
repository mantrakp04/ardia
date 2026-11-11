import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const focusState = read("../ios/ArdiaFocusState.mm");
const podspec = read("../ios/ArdiaCore.podspec");

const body = (name) => {
  const start = focusState.indexOf(name);
  assert.ok(start >= 0, `${name} not found`);
  const open = focusState.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < focusState.length; i++) {
    if (focusState[i] === "{") depth++;
    if (focusState[i] === "}" && --depth === 0) return focusState.slice(open, i + 1);
  }
  assert.fail(`${name} has no closing brace`);
};

test("the current input source id comes from the keyboard source's own identifier, on the main thread only", () => {
  const current = body("NSString *CurrentInputSourceId()");
  assert.match(current, /NSThread\.isMainThread/);
  assert.match(current, /TISCopyCurrentKeyboardInputSource\(\)/);
  assert.match(current, /TISGetInputSourceProperty\(source, kTISPropertyInputSourceID\)/);
  assert.match(current, /CFRelease\(source\)/);
  assert.match(focusState, /#import <Carbon\/Carbon\.h>/);
  assert.match(podspec, /s\.frameworks\s*=\s*[^\n]*'Carbon'/);
});

test("the field's composition state is its class, text input client conformance, hasMarkedText and context source", () => {
  const described = body("NSString *DescribeTextInput(NSResponder *responder)");
  assert.match(described, /conformsToProtocol:@protocol\(NSTextInputClient\)/);
  assert.match(described, /hasMarkedText\]/);
  assert.match(described, /selectedKeyboardInputSource/);
  assert.match(described, /responder\.className/);
});

test("the record never reads typed text, marked text or key codes", () => {
  for (const name of ["NSString *CurrentInputSourceId()", "NSString *DescribeTextInput(NSResponder *responder)"]) {
    const text = body(name);
    assert.doesNotMatch(text, /markedRange|selectedRange|attributedSubstring|string\]|keyCode|characters|NSEvent|insertText|setMarkedText/);
  }
});

test("Copy Diagnostics' focus block gets the input source and the key window's responder composition state", () => {
  const state = body("NSString *FocusState()");
  assert.match(state, /CurrentInputSourceId\(\)/);
  assert.match(state, /DescribeTextInput\(key\.firstResponder\)/);
});

test("a keyboard layout change is added to the focus history with the new source's id", () => {
  const watch = body("void WatchFocusChanges()");
  const observer = watch.slice(watch.indexOf("NSTextInputContextKeyboardSelectionDidChangeNotification"));
  assert.ok(observer.length < watch.length, "the layout change observer is missing");
  assert.match(observer, /queue:NSOperationQueue\.mainQueue/);
  assert.match(observer, /NoteFocusChange\(\[@"input source changed to " stringByAppendingString:CurrentInputSourceId\(\)\], nil\)/);
});
