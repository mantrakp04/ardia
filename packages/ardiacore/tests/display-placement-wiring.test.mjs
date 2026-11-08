import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const podspec = read("../ios/ArdiaCore.podspec");
const earlyWindow = read("../ios/ArdiaEarlyWindow.mm");
const launch = read("../ios/ArdiaHost+Launch.mm");
const identity = read("../ios/ArdiaDisplayIdentity.mm");
const windowManager = read("../../shell/ios/WindowManager.swift");
const fullScreenRestore = read("../../shell/ios/FullScreenRestore.swift");

test("the display identity helper is public to Swift and built on the pure placement math", () => {
  assert.match(podspec, /public_header_files = [^\n]*'ArdiaDisplayIdentity\.h'/);
  assert.match(identity, /#include "ArdiaDisplayPlacementMath\.h"/);
  assert.match(identity, /CGDisplayCreateUUIDFromDisplayID/);
});

test("the early launch window is placed on the saved display and constrained to it", () => {
  assert.match(launch, /display:\[window\[@"display"\] isKindOfClass:NSString\.class\]/);
  assert.match(earlyWindow, /screenWithIdentifier:display\]/);
  assert.match(earlyWindow, /screen = savedDisplay \?: window\.screen \?: NSScreen\.mainScreen/);
});

test("the window manager places on the saved display and reports the display a full-screen window is on", () => {
  assert.match(windowManager, /let saved = ArdiaDisplayIdentity\.screen\(withIdentifier: display\)/);
  assert.match(windowManager, /if let screen = saved \?\? window\.screen \?\? NSScreen\.main/);
  assert.match(windowManager, /if on, let display = ArdiaDisplayIdentity\.identifier\(of: window\.screen\) \{ body\["display"\] = display \}/);
  assert.match(windowManager, /name: NSWindow\.didChangeScreenNotification/);
});

test("full screen is toggled only after the window is moved to its saved display", () => {
  const move = fullScreenRestore.indexOf("self.windows.moveToSavedDisplay(id)");
  const toggle = fullScreenRestore.indexOf("window.toggleFullScreen(nil)");
  assert.ok(move > 0 && toggle > move);
});

test("a window the runtime already has takes the saved display from the new open call", () => {
  const existing = windowManager.indexOf("if let existing = window(id) {");
  const refresh = windowManager.indexOf("managed[id]?.display = options.display", existing);
  const early = windowManager.indexOf("return\n", existing);
  assert.ok(existing > 0 && refresh > existing && refresh < early);
});
