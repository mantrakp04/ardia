import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const windowMove = read("../../shell/ios/WindowMove.swift");
const landingFit = read("../../shell/ios/LittleLandingFit.swift");
const between = (text, from, to) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} … ${to} not found`);
  return text.slice(start, end);
};

test("the landing fit stops when the window move replacement starts a drag", () => {
  const dragObservers = between(landingFit, "for name in [", "DispatchQueue.main.async");
  assert.match(dragObservers, /^for name in \[[^\]]*WindowMove\.willDrag[^\]]*\] \{/);
  assert.match(dragObservers, /listen\(NotificationCenter\.default, name\) \{ \[weak self\] note in\s*guard let self, let window = note\.object as\? NSWindow, window === self\.currentWindow\(\) else \{ return \}\s*self\.stop\(\)\s*\}/);
  assert.match(between(landingFit, "func stop()", "private func listen"), /stopped = true[\s\S]*removeObserver\(observer\.token\)/);
  assert.match(between(landingFit, "func fit()", "func stop()"), /guard !stopped,/);
  assert.match(windowMove, /static let willDrag = Notification\.Name\(/);
  assert.match(between(windowMove, "static func announceDrag", "static func follow"), /post\(name: willDrag, object: window\)/);
});

test("both custom drag paths announce the drag before the window moves", () => {
  const hook = between(windowMove, "let block: @convention(block) (NSWindow, NSEvent) -> Void", "method_setImplementation");
  assert.match(hook, /windowServerMoves\(window, from: event\) \{\s*WindowMove\.announceDrag\(of: window\)\s*return\s*\}/);
  const follow = between(windowMove, "static func follow", "private static let gestureEvents");
  assert.ok(follow.indexOf("announceDrag(of: window)") >= 0);
  assert.ok(follow.indexOf("announceDrag(of: window)") < follow.indexOf("window.setFrameOrigin(target)"));
});
