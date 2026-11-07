import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean).join("\n");

test("the Placement category of the PiP controller is declared with the other categories", () => {
  const header = read("../ios/ArdiaPictureInPictureInternal.h");
  assert.ok(/@interface ArdiaPiPController \(Placement\)\s*@end/.test(header), "ArdiaPictureInPictureInternal.h declares no ArdiaPiPController (Placement) category");
});

test("a PiP window is exempt from AppKit's constrainFrameRect:toScreen:, so the throw math alone keeps it on a display", () => {
  const placement = code(read("../ios/ArdiaPiPController+Placement.mm"));
  assert.match(placement, /@implementation ArdiaPiPController \(Placement\)/);
  assert.match(placement, /\+ \(void\)load/);
  assert.match(placement, /NSClassFromString\(@"NativeWidgetMacFramelessNSWindow"\)/);
  assert.match(placement, /@selector\(constrainFrameRect:toScreen:\)/);
  const exempt = placement.indexOf("if ([ArdiaPiPController forWindow:window]) return rect;");
  const inherited = placement.indexOf("class_getMethodImplementation(");
  assert.ok(exempt >= 0, "a window with a PiP controller must get its requested rect back");
  assert.ok(inherited > exempt, "the exemption must come before the inherited constrain runs");
});

test("the exemption leaves later swizzles of NSWindow's constrain in the chain, and no other window is exempt", () => {
  const placement = code(read("../ios/ArdiaPiPController+Placement.mm"));
  assert.match(placement, /class_getMethodImplementation\(class_getSuperclass\(windowClass\), constrain\)/);
  assert.equal(placement.match(/forWindow:/g).length, 1);
  assert.doesNotMatch(placement, /IsChromeFloatingWindow|IsChromeVideoPictureInPicture|IsChromeDocumentPictureInPicture/);
});
