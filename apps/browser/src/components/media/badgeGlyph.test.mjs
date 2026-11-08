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
    assert.match(symbolTag(badges, name), /\bcenterInk(?:=\{true\})?(?![\w={])/, `${name} turns centerInk on`);
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

test("a badge Symbol counts as centred only when centerInk is shorthand or true", () => {
  const turnedOn = /\bcenterInk(?:=\{true\})?(?![\w={])/;
  assert.match('<Symbol name="x" centerInk style={{}} />', turnedOn);
  assert.match('<Symbol name="x" centerInk={true} style={{}} />', turnedOn);
  assert.doesNotMatch('<Symbol name="x" centerInk={false} style={{}} />', turnedOn);
  assert.doesNotMatch('<Symbol name="x" centerInk={on} style={{}} />', turnedOn);
  assert.doesNotMatch('<Symbol name="x" style={{}} />', turnedOn);
});

test("the demo shim moves a centerInk glyph by the gap between its drawn shape and the view centre", async () => {
  const { inkShift } = await import("../../../../../packages/demo/src/shims/web/symbols/ink.ts");
  assert.deepEqual(inkShift({ x: 4, y: 6, width: 8, height: 6 }, 24), [4, 3]);
  assert.deepEqual(inkShift({ x: 8, y: 8, width: 8, height: 8 }, 24), [0, 0]);
  assert.deepEqual(inkShift({ x: 14, y: 15, width: 4, height: 2 }, 24), [-4, -4]);
  assert.deepEqual(inkShift(null, 24), [0, 0]);
  assert.deepEqual(inkShift({ x: 0, y: 0, width: 0, height: 0 }, 24), [0, 0]);
  const shim = read("../../../../../packages/demo/src/shims/web/Symbol.tsx");
  assert.match(shim, /centerInk && knownInkShift\(inkKey\)/);
  assert.match(shim, /measureInkShift\(inkKey, probe, canvas\)/);
  assert.match(shim, /left: -canvas \/ 2 \+ shift\[0\], top: -canvas \/ 2 \+ shift\[1\]/);
});

test("the demo shim finds the drawn shape from the rendered pixels, strokes included", async () => {
  const { inkBox } = await import("../../../../../packages/demo/src/shims/web/symbols/ink.ts");
  const raster = (width, height, ink) => {
    const rgba = new Uint8Array(width * height * 4);
    for (const [x, y, alpha] of ink) rgba[(y * width + x) * 4 + 3] = alpha;
    return rgba;
  };
  const drawn = raster(16, 16, [[4, 6, 255], [11, 6, 255], [4, 9, 255], [11, 9, 255]]);
  assert.deepEqual(inkBox(drawn, 16, 16, 8), { x: 0.5, y: 0.75, width: 1, height: 0.5 });
  const withStrokeEdge = raster(16, 16, [[4, 6, 255], [11, 6, 255], [3, 8, 255], [12, 8, 16]]);
  assert.deepEqual(inkBox(withStrokeEdge, 16, 16, 8), { x: 3 / 8, y: 6 / 8, width: 10 / 8, height: 3 / 8 });
  const faint = raster(16, 16, [[4, 6, 255], [11, 9, 15]]);
  assert.deepEqual(inkBox(faint, 16, 16, 8), { x: 0.5, y: 0.75, width: 0.125, height: 0.125 });
  assert.equal(inkBox(new Uint8Array(16 * 16 * 4), 16, 16, 8), null);
  assert.equal(inkBox(new Uint8Array(8), 16, 16, 8), null);
  assert.equal(inkBox(drawn, 0, 16, 8), null);
  assert.equal(inkBox(drawn, 16, 16, 0), null);
});

test("a zero-sized or non-finite centerInk symbol is left where it is, like the native no-op, and never reaches the raster surface", async () => {
  const { measureInkShift } = await import("../../../../../packages/demo/src/shims/web/symbols/ink.ts");
  const globals = ["Image", "document"];
  const saved = globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const touched = [];
  globalThis.Image = class {
    set src(_value) {}
    decode() {
      touched.push("decode");
      return Promise.resolve();
    }
  };
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        drawImage() {},
        getImageData(_x, _y, width, height) {
          if (!(width > 0 && height > 0)) throw new DOMException("The source width is 0.", "IndexSizeError");
          return { data: new Uint8ClampedArray(width * height * 4) };
        },
      }),
    }),
  };
  try {
    for (const canvas of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(await measureInkShift(`empty-${canvas}`, "<svg/>", canvas), null, `canvas ${canvas}`);
    }
    assert.deepEqual(touched, []);
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("the demo shim measures the drawn shape with an opaque probe colour, so the glyph's own colour never changes the cached shift", async () => {
  const { inkProbeMarkup } = await import("../../../../../packages/demo/src/shims/web/symbols/ink.ts");
  const { symbolLayers } = await import("../../../../../packages/demo/src/shims/web/symbols/data.ts");
  const { symbolMarkup } = await import("../../../../../packages/demo/src/shims/web/symbols/render.ts");
  const layers = symbolLayers("pip.fill");
  assert.ok(layers, "pip.fill artwork");
  const options = { pointSize: 6.6, weight: "bold", width: 20, height: 20, id: "probe" };
  const probe = inkProbeMarkup(layers, options);
  assert.equal(probe, symbolMarkup(layers, { ...options, color: "#000" }));
  assert.doesNotMatch(probe, /rgba?\(|hsla?\(|transparent/i);
  const shim = read("../../../../../packages/demo/src/shims/web/Symbol.tsx");
  assert.match(shim, /const probe = inkProbeMarkup\(layers, \{[^}]*\}\);/);
  assert.match(shim, /measureInkShift\(inkKey, probe, canvas\)/);
  assert.doesNotMatch(shim, /measureInkShift\(inkKey, markup/);
});

test("the probe takes the renderer's own options minus the colour, so a change to them reaches the probe", () => {
  const ink = read("../../../../../packages/demo/src/shims/web/symbols/ink.ts");
  assert.match(ink, /options: Omit<Parameters<typeof symbolMarkup>\[1\], "color">\)/);
  assert.doesNotMatch(ink, /options: \{[^}]*\bpointSize\b/);
});

test("a failed measurement is not remembered, so the next layout measures again", () => {
  const ink = read("../../../../../packages/demo/src/shims/web/symbols/ink.ts");
  assert.match(ink, /if \(!box\) return null;\n  const shift = inkShift\(box, canvas\);\n  measured\.set\(key, shift\);/);
  const native = read("../../../../../packages/shell/ios/SymbolInk.swift");
  assert.match(native, /guard let measured = measure\(image, in: size\) else \{ return \.zero \}\n    cache\[cacheKey\] = measured/);
});
