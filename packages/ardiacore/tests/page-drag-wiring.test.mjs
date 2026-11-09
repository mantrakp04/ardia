import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const path = (name) => new URL(`../ios/${name}`, import.meta.url);
const read = (name) => readFileSync(path(name), "utf8");
const flat = (text) => text.replace(/\s+/g, " ");

test("source wiring: ArdiaPageDrag.mm turns off the slide-back on the session WebContentsViewCocoa returns (runtime: the page-drag acceptance check)", () => {
  assert.ok(existsSync(path("ArdiaPageDrag.mm")), "ArdiaPageDrag.mm is missing");
  const source = flat(read("ArdiaPageDrag.mm"));
  assert.match(source, /NSClassFromString\(@"WebContentsViewCocoa"\)/);
  assert.match(source, /@selector\(beginDraggingSessionWithItems:event:source:\)/);
  assert.match(source, /ardia_runtime::ReplaceMethod\(/);
  assert.match(source, /NSDraggingSession \*session = \(\(NSDraggingSession \* ?\(\*\)\([^)]*\)\)original\)\(view, begin, items, event, source\);/);
  assert.match(source, /session\.animatesToStartingPositionsOnCancelOrFail = NO;/);
  assert.match(source, /return session;/);
  assert.match(source, /if \(!installed\) NSLog\(@"\[ardiacore\] page drag session override not installed/);
  assert.ok(
    source.indexOf("original)(view, begin") < source.indexOf("animatesToStartingPositionsOnCancelOrFail"),
    "the flag is set on the session the original returned",
  );
});

test("source wiring: the page drag override is declared and installed from engineDidStart, before the engine-started launch step", () => {
  assert.match(read("ArdiaInternal.h"), /void InstallPageDragSession\(\);/);
  const delegate = read("ArdiaHostEngineDelegate.mm");
  const start = delegate.indexOf("- (void)engineDidStart {");
  const install = delegate.indexOf("ardia_host::InstallPageDragSession();");
  assert.ok(start >= 0 && install > start, "engineDidStart does not install the page drag override");
  assert.ok(install < delegate.indexOf("[ArdiaLaunchSequence.shared reach:ArdiaLaunchEngineStarted];"));
});
