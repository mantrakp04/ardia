import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean).join("\n");

test("the Placement category of the PiP controller is declared with the other categories", () => {
  const header = read("../ios/ArdiaPictureInPictureInternal.h");
  assert.ok(/@interface ArdiaPiPController \(Placement\)\s*@end/.test(header), "ArdiaPictureInPictureInternal.h declares no ArdiaPiPController (Placement) category");
});

test("Placement.mm installs the constrain override on the frameless window class at load", () => {
  const placement = code(read("../ios/ArdiaPiPController+Placement.mm"));
  assert.match(placement, /@implementation ArdiaPiPController \(Placement\)/);
  assert.match(placement, /\+ \(void\)load/);
  assert.match(placement, /NSClassFromString\(@"NativeWidgetMacFramelessNSWindow"\)/);
  assert.match(placement, /@selector\(constrainFrameRect:toScreen:\)/);
});

test("Placement.mm hands back the requested rect only for a window with a PiP controller whose rect is on a connected display", () => {
  const placement = code(read("../ios/ArdiaPiPController+Placement.mm"));
  assert.match(placement, /#import "ArdiaPiPThrowMath\.h"/);
  assert.match(
    placement,
    /BOOL OnAConnectedDisplay\(NSRect rect\) \{\nconst auto screens = ardia_pip::ThrowScreens\(\);\nreturn ardia_pip_throw::OnAScreen\(ardia_pip::ThrowRect\(rect\), screens\.data\(\), \(int\)screens\.size\(\)\);\n\}/,
  );
  const exempt = placement.indexOf("if ([ArdiaPiPController forWindow:window] && OnAConnectedDisplay(rect)) return rect;");
  const next = placement.indexOf("IMP next = ");
  assert.ok(exempt >= 0, "the override must return the rect only for a PiP controller window on a connected display");
  assert.ok(next > exempt, "every other frame must reach the next constrain after the exemption");
  assert.equal(placement.match(/return rect;/g).length, 1);
  assert.equal(placement.match(/forWindow:/g).length, 1);
});

test("Placement.mm sends every other frame to the chrome override when one was replaced, else to the superclass", () => {
  const placement = code(read("../ios/ArdiaPiPController+Placement.mm"));
  assert.match(placement, /__block IMP chrome = nil;/);
  assert.match(placement, /IMP next = chrome \?: class_getMethodImplementation\(class_getSuperclass\(windowClass\), constrain\);/);
  assert.match(placement, /return \(\(NSRect \(\*\)\(id, SEL, NSRect, NSScreen \*\)\)next\)\(window, constrain, rect, screen\);/);
  assert.match(placement, /if \(!class_addMethod\(windowClass, constrain, placed, method_getTypeEncoding\(inherited\)\)\) chrome = method_setImplementation\(inherited, placed\);/);
});

test("Placement.mm identifies a PiP window by its controller alone", () => {
  const placement = code(read("../ios/ArdiaPiPController+Placement.mm"));
  assert.doesNotMatch(placement, /IsChromeFloatingWindow|IsChromeVideoPictureInPicture|IsChromeDocumentPictureInPicture/);
});

test("OnAScreen, the throw math's test of a connected display, is declared and exercised by pip-throw.test.cc", () => {
  const math = read("../ios/ArdiaPiPThrowMath.h");
  assert.match(math, /inline bool OnAScreen\(Rect r, const Screen \*screens, int count\)/);
  const cases = read("./pip-throw.test.cc");
  assert.match(cases, /CHECK\(!OnAScreen\(onSecond, only, 1\)\)/);
  assert.match(cases, /CHECK\(!OnAScreen\(\{100, 100, 468, 263\}, only, 0\)\)/);
});
