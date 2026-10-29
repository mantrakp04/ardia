import assert from "node:assert/strict";
import test from "node:test";
import { symbolMarkup } from "./render.ts";
import { SYMBOL_NAMES, symbolLayers } from "./data.ts";

const layer = { body: '<path d="M0 0h10v10z"/>', viewBox: 24, paint: "stroke", fits: { regular: [1, 1, 0, 0, 1, 0, 1] } };
const options = { pointSize: 14, weight: "regular", width: 42, height: 42, color: "currentColor", id: "test" };

test("symbol colors cannot close SVG attributes or inject elements", () => {
  for (const paint of ["stroke", "fill"]) {
    const color = '\"><script>alert(1)</script><g onload="alert(2)" data-x="&\'';
    const markup = symbolMarkup([{ ...layer, paint }], { ...options, color });
    assert.ok(markup.includes("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;g onload=&quot;alert(2)&quot; data-x=&quot;&amp;&apos;"));
    assert.equal(markup.includes("<script>"), false);
    assert.equal(markup.includes(' onload="'), false);
    assert.equal(markup.includes(' data-x="'), false);
  }
});

test("symbol colors escape entities before quotes and preserve ordinary paint values", () => {
  const markup = symbolMarkup([layer], { ...options, color: "&#34; onload=&#34;alert(1)" });
  assert.ok(markup.includes('color="&amp;#34; onload=&amp;#34;alert(1)"'));
  for (const color of ["currentColor", "#a1b2c3", "rgba(20, 30, 40, 0.5)", "var(--icon-color)"]) {
    assert.ok(symbolMarkup([layer], { ...options, color }).includes(`stroke="${color}"`));
  }
});

test("mask IDs cannot escape the XML attribute or fragment URL", () => {
  const id = '\") url(https://evil.example/x)><svg/onload=alert(1)';
  const markup = symbolMarkup([layer, { ...layer, knockout: 0.1 }], { ...options, id });
  const maskId = markup.match(/<mask id="([^"]+)"/)[1];
  assert.match(maskId, /^[a-zA-Z0-9_-]+$/);
  assert.ok(markup.includes(`mask="url(#${maskId})"`));
  assert.equal(markup.includes("https:"), false);
  assert.equal(markup.includes("onload="), false);
  assert.ok(symbolMarkup([layer, { ...layer, knockout: 0.1 }], { ...options, id: "" }).includes('id="symbol-k1"'));
});

test("every shipped symbol body contains only generated SVG geometry", () => {
  const geometry = new Set(["path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "g"]);
  for (const name of SYMBOL_NAMES) {
    const layers = symbolLayers(name);
    assert.ok(layers?.length, name);
    for (const { body } of layers) {
      for (const match of body.matchAll(/<\/?([a-zA-Z][\w:-]*)\b/g)) assert.ok(geometry.has(match[1]), `${name}: ${match[1]}`);
      assert.equal(/\bon\w+\s*=|\b(?:href|src|style)\s*=|url\s*\(|<\?|<!/i.test(body), false, name);
    }
  }
});
