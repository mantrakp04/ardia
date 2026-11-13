import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
const ts = createRequire(import.meta.url)("typescript");

const text = readFileSync(new URL("./PinnedGrid.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("PinnedGrid.tsx", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);

function all(node, keep, out = []) {
  if (keep(node)) out.push(node);
  ts.forEachChild(node, (child) => void all(child, keep, out));
  return out;
}

const tagOf = (node) => (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText(file);
const isJsx = (node) => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
const tile = all(file, (n) => ts.isVariableDeclaration(n) && n.name.getText(file) === "PinnedTile")[0];
const elements = (name) => all(tile, (n) => isJsx(n) && tagOf(n) === name);

test("PinnedTile exists and draws a TileFace inside a TabPressArea", () => {
  assert.equal(elements("TabPressArea").length, 1);
  assert.equal(elements("TileFace").length, 1);
});

test("the calendar countdown badge and status marks aren't handed to the glass tile to host beside its selection ring", () => {
  const face = elements("TileFace")[0];
  const props = (ts.isJsxElement(face) ? face.openingElement : face).attributes.properties.map((p) => p.name.getText(file));
  assert.ok(!props.includes("badge"), `PinnedTile passes badge to TileFace (${props.join(", ")}): the native GlassEffect hosts it under the active tile's DockSelection`);
});

test("the badge and status marks are siblings of the press area in every style, so they draw over the glass and the ring", () => {
  const area = elements("TabPressArea")[0];
  const siblings = area.parent.children.filter(ts.isJsxExpression).map((c) => c.expression?.getText(file));
  assert.ok(siblings.includes("overlays"), `the overlays after the press area are ${JSON.stringify(siblings)}, not a bare overlays in every style`);
});
