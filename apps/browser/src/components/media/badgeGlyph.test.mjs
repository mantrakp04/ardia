import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const symbolTag = (source, name) => {
  const start = source.indexOf(`<Symbol name="${name}"`);
  assert.ok(start >= 0, `a Symbol named ${name}`);
  return source.slice(start, source.indexOf("/>", start));
};

test("the PiP and screen-share badge glyphs are centred on their drawn shape, not on the symbol's padded image", () => {
  const badges = read("./TabBadges.tsx");
  for (const name of ["pip.fill", "rectangle.inset.filled"]) {
    assert.match(symbolTag(badges, name), /\bcenterInk\b/, `${name} sets centerInk`);
  }
});

test("centerInk is a Symbol prop on the native view, the shell types and the demo shim", () => {
  assert.match(read("../../../../../packages/shell/ios/SymbolModule.swift"), /Prop\("centerInk"\)/);
  assert.match(read("../../../../../packages/shell/src/views.tsx"), /export type SymbolProps = ViewProps & \{[^}]*\bcenterInk\?: boolean;/);
  assert.match(read("../../../../../packages/demo/src/shims/web/Symbol.tsx"), /export type SymbolProps = ViewProps & \{[^}]*\bcenterInk\?: boolean;/);
});

test("the native symbol view moves its image by the measured ink offset only when centerInk is on", () => {
  const view = read("../../../../../packages/shell/ios/SymbolView.swift");
  assert.match(view, /var centerInk = false \{/);
  assert.match(view, /centerInk \? SymbolInk\.offset\(/);
  assert.match(view, /imageView\.frame = bounds\.offsetBy\(/);
});

test("the demo shim moves a centerInk glyph by the gap between its drawn shape and the view centre", async () => {
  const { inkShift } = await import("../../../../../packages/demo/src/shims/web/symbols/ink.ts");
  assert.deepEqual(inkShift({ x: 4, y: 6, width: 8, height: 6 }, 24), [4, 3]);
  assert.deepEqual(inkShift({ x: 8, y: 8, width: 8, height: 8 }, 24), [0, 0]);
  assert.deepEqual(inkShift({ x: 14, y: 15, width: 4, height: 2 }, 24), [-4, -4]);
  assert.deepEqual(inkShift(null, 24), [0, 0]);
  assert.deepEqual(inkShift({ x: 0, y: 0, width: 0, height: 0 }, 24), [0, 0]);
  const shim = read("../../../../../packages/demo/src/shims/web/Symbol.tsx");
  assert.match(shim, /centerInk \? inkShift\(measureInk\(/);
  assert.match(shim, /left: -canvas \/ 2 \+ shift\[0\], top: -canvas \/ 2 \+ shift\[1\]/);
});
