import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const path = (name) => new URL(`../ios/${name}`, import.meta.url);
const read = (name) => readFileSync(path(name), "utf8");
const flat = (text) => text.replace(/\s+/g, " ");

test("a page drag ends at mouse-up: the session AppKit starts for the page does not slide back", () => {
  assert.ok(existsSync(path("ArdiaPageDrag.mm")), "ArdiaPageDrag.mm is missing");
  const source = flat(read("ArdiaPageDrag.mm"));
  assert.match(source, /NSClassFromString\(@"WebContentsViewCocoa"\)/);
  assert.match(source, /@selector\(beginDraggingSessionWithItems:event:source:\)/);
  assert.match(source, /ardia_runtime::ReplaceMethod\(/);
  assert.match(source, /NSDraggingSession \*session = \(\(NSDraggingSession \* ?\(\*\)\([^)]*\)\)original\)\(view, begin, items, event, source\);/);
  assert.match(source, /session\.animatesToStartingPositionsOnCancelOrFail = NO;/);
  assert.match(source, /return session;/);
  assert.ok(
    source.indexOf("original)(view, begin") < source.indexOf("animatesToStartingPositionsOnCancelOrFail"),
    "the flag is set on the session the original returned",
  );
});

test("the page drag override is declared and installed once the engine has started", () => {
  assert.match(read("ArdiaInternal.h"), /void InstallPageDragSession\(\);/);
  const delegate = read("ArdiaHostEngineDelegate.mm");
  const start = delegate.indexOf("- (void)engineDidStart {");
  const install = delegate.indexOf("ardia_host::InstallPageDragSession();");
  assert.ok(start >= 0 && install > start, "engineDidStart does not install the page drag override");
  assert.ok(install < delegate.indexOf("[ArdiaLaunchSequence.shared reach:ArdiaLaunchEngineStarted];"));
});
