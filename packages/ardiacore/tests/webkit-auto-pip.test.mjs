import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const path = (name) => fileURLToPath(new URL(name, import.meta.url));
const read = (name) => readFileSync(path(name), "utf8");
const tab = read("../ios/WebKitTab.swift");
const sight = read("../ios/WebKitTab+AutoPictureInPicture.swift");
const pageTab = read("../ios/WebKitTab+PageTab.swift");
const webView = read("../ios/WebKitWebView.swift");
const windowHostHeader = read("../ios/ArdiaChromeWindowHost.h");
const windowHost = read("../ios/ArdiaChromeWindowHost.mm");
const swiftc = process.env.SWIFTC || "swiftc";

test("WebKit tabs keep the autoPictureInPicture flag instead of a stub that reads false", () => {
  assert.doesNotMatch(pageTab, /var autoPictureInPicture\b[^\n]*get \{ false \}/);
  assert.match(tab, /^ {2}var autoPictureInPicture = false$/m);
});

test("WebKit tabs follow the user's sight of their window the way Chromium views do", () => {
  assert.match(sight, /let seen = visible && ArdiaChromeWindowHost\.userSees\(window\)/);
  assert.match(sight, /forName: ArdiaWindowSeenDidChange, object: window/);
  assert.match(tab, /override func viewDidMoveToWindow\(\) \{ super\.viewDidMoveToWindow\(\); watchSight\(\) \}/);
  assert.match(tab, /var visible = true \{ didSet \{ updateHidden\(\); updateSight\(\) \} \}/);
});

test("leaving opens picture in picture and returning closes it through the page's own player call", () => {
  assert.match(sight, /case \.open: setPictureInPicture\(true\) \{ _ in \}/);
  assert.match(sight, /case \.close: setPictureInPicture\(false\) \{ _ in \}/);
  assert.match(sight, /autoPictureInPictureRule\.sight\(seen, enabled: autoPictureInPicture, playing: !playingFrames\.isEmpty\)/);
});

test("the page's picture in picture reports reach the rule", () => {
  assert.match(tab, /case "pip":\n\s+let active = dict\?\["active"\] as\? Bool \?\? false\n\s+autoPictureInPictureRule\.reported\(active: active\)/);
});

test("the sight observer is dropped when the window changes or the tab closes or gives its view away", () => {
  assert.match(tab, /private\(set\) var closed = false \{ didSet \{ if closed \{ stopWatchingSight\(\) \} \} \}/);
  assert.match(sight, /func watchSight\(\) \{\n\s+stopWatchingSight\(\)/);
  const relinquish = tab.slice(tab.indexOf("func relinquish() -> WebKitWebView? {"), tab.indexOf("\n  }\n", tab.indexOf("func relinquish() -> WebKitWebView? {")));
  assert.match(relinquish, /closed = true/);
});

test("the rule travels with the page view, so a tab that takes the view over still closes the picture in picture its predecessor opened", () => {
  assert.match(webView, /^ {2}var autoPictureInPictureRule = WebKitAutoPictureInPicture\(\)$/m);
  assert.doesNotMatch(tab, /var autoPictureInPictureRule = WebKitAutoPictureInPicture\(\)/);
  assert.match(
    sight,
    /var autoPictureInPictureRule: WebKitAutoPictureInPicture \{\n\s+get \{ webView\?\.autoPictureInPictureRule \?\? WebKitAutoPictureInPicture\(\) \}\n\s+set \{ webView\?\.autoPictureInPictureRule = newValue \}\n\s+\}/,
  );
  const attach = tab.slice(tab.indexOf("private func attach(_ view: WebKitWebView) {"), tab.indexOf("private func observe("));
  assert.match(attach, /webView = view\n[\s\S]*\n {4}updateSight\(\)\n {2}\}/);
});

test("ArdiaCore's public window host gives Swift the same sight rule as Chromium views", () => {
  assert.match(windowHostHeader, /\+ \(BOOL\)userSeesWindow:\(nullable NSWindow \*\)window NS_SWIFT_NAME\(userSees\(_:\)\);/);
  assert.match(windowHostHeader, /extern NSNotificationName const ArdiaWindowSeenDidChange;/);
  assert.match(windowHost, /\+ \(BOOL\)userSeesWindow:\(NSWindow \*\)window \{\n\s+return \[ArdiaWindowController userSees:window\];/);
});

test("the leave and return rule opens once per leave and closes on return", (t) => {
  const probe = spawnSync(swiftc, ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return t.skip("swiftc is not available");
  const dir = mkdtempSync(join(tmpdir(), "ardia-auto-pip-"));
  try {
    const binary = join(dir, "auto-pip-test");
    const built = spawnSync(
      swiftc,
      ["-parse-as-library", path("../ios/WebKitAutoPictureInPicture.swift"), path("./webkit-auto-pip.test.swift"), "-o", binary],
      { encoding: "utf8" },
    );
    assert.equal(built.status, 0, built.stderr);
    const ran = spawnSync(binary, { encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
