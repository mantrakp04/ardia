import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const lines = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
const body = (text, signature) => {
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `${signature} not found`);
  const end = text.indexOf("\n  }\n", start);
  assert.ok(end > start, `${signature} has no closing brace`);
  return lines(text.slice(start, end));
};

test("a WebKit tab hands 英数 and かな to the input source before WebKit sees the key", () => {
  assert.equal(
    body(read("../ios/WebKitWebView.swift"), "override func keyDown(with event: NSEvent) {"),
    [
      "override func keyDown(with event: NSEvent) {",
      "if InputSourceKeys.consume(event) { return }",
      "super.keyDown(with: event)",
    ].join("\n"),
  );
});

test("InputSourceKeys takes exactly 英数 and かな and runs the system's key bindings for them", () => {
  const source = read("../ios/InputSourceKeys.swift");
  assert.match(source, /public enum InputSourceKeys \{/);
  assert.match(source, /keyCodes: Set<UInt16> = \[UInt16\(kVK_JIS_Eisu\), UInt16\(kVK_JIS_Kana\)\]/);
  assert.match(source, /processKeyBindings = NSSelectorFromString\("processInputKeyBindings:"\)/);
  assert.equal(
    body(source, "public static func consume(_ event: NSEvent) -> Bool {"),
    [
      "public static func consume(_ event: NSEvent) -> Bool {",
      "guard keyCodes.contains(event.keyCode), NSTextInputContext.responds(to: processKeyBindings) else { return false }",
      "typealias ProcessKeyBindings = @convention(c) (AnyClass, Selector, NSEvent) -> ObjCBool",
      "let process = unsafeBitCast(NSTextInputContext.method(for: processKeyBindings), to: ProcessKeyBindings.self)",
      "_ = process(NSTextInputContext.self, processKeyBindings, event)",
      "return true",
    ].join("\n"),
  );
});

test("Ardia's own text views use the same helper, so the two engines cannot drift apart", () => {
  const patches = read("../../shell/ios/AppKitPatches.swift");
  assert.ok(patches.includes("if InputSourceKeys.consume(event) { return }"));
  assert.doesNotMatch(patches, /kVK_JIS_Eisu|kVK_JIS_Kana|processInputKeyBindings/);
});
