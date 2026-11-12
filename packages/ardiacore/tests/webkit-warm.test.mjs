import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const path = (name) => fileURLToPath(new URL(name, import.meta.url));
const sources = ["../ios/WebKitTab.swift", "../ios/WebKitTab+PageTab.swift", "../ios/PageViewDefinition.swift"];
const read = (name) => (existsSync(path(name)) ? readFileSync(path(name), "utf8") : "");
const tab = read("../ios/WebKitTab.swift");
const pageTab = read("../ios/WebKitTab+PageTab.swift");
const definition = read("../ios/PageViewDefinition.swift");

test("every source the checks read exists", () => {
  const missing = sources.filter((name) => !existsSync(path(name)));
  assert.deepEqual(missing, []);
});

test("the app still hands every page view its warm flag", () => {
  assert.match(definition, /Prop\("warm"\) \{ \(view: V, warm: Bool\?\) in view\.page\.warm = warm \?\? false \}/);
});

test("a WebKit page shows only while it is the visible tab, so a warm neighbour never covers the page on screen", () => {
  const hidden = [...tab.matchAll(/webView\?\.isHidden = (.+)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(hidden, ["!visible"]);
  assert.doesNotMatch(tab, /\bwarm\b/);
});

test("WebKit tabs take the warm flag as a no-op instead of storing it", () => {
  assert.match(pageTab, /^ {2}var warm: Bool \{ get \{ false \} set \{\} \}$/m);
});
