import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const ts = createRequire(import.meta.url)("typescript");
const MARKER = "TabContentArea";

function elements(file) {
  const path = new URL(`../components/${file}`, import.meta.url);
  const source = ts.createSourceFile(file, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const visit = (node, markers) => {
    let inner = markers;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const name = opening.tagName.getText(source);
      const props = Object.fromEntries(
        opening.attributes.properties.filter(ts.isJsxAttribute).map((attribute) => [attribute.name.getText(source), attribute.initializer?.getText(source) ?? "true"]),
      );
      found.push({ name, markers, props });
      if (name === MARKER) inner = [...markers, props.contentAreaOf];
    }
    ts.forEachChild(node, (child) => visit(child, inner));
  };
  visit(source, []);
  return found;
}

const placed = (file, name) => {
  const hits = elements(file).filter((element) => element.name === name);
  assert.ok(hits.length > 0, `${file} renders no <${name}>`);
  return hits;
};

test("the views a page replaces sit in the tab's content area, marked with its tab", () => {
  for (const name of ["NewTabPage", "SplitEmptyState", "EmptyCard", "InternalPage"]) {
    for (const hit of placed("window/TabPane.tsx", name)) assert.deepEqual(hit.markers, ["{tabId}"], `<${name}> in TabPane.tsx`);
  }
  assert.ok(placed("ntp/NewTabPage.tsx", "Omnibox").length > 0, "the New Tab page's search field");
  assert.ok(placed("split/SplitEmptyState.tsx", "SearchField").length > 0, "the empty split pane's search field");
});

test("the toolbar, the find bar, the sidebar rename field and the command bar are outside any tab's content area", () => {
  for (const name of ["Toolbar", "PageOverlays", "TabWebView", "BookmarksBar", "AutoHideToolbar"]) {
    for (const hit of placed("window/TabPane.tsx", name)) assert.deepEqual(hit.markers, [], `<${name}> in TabPane.tsx`);
  }
  for (const [file, field] of [
    ["window/PageOverlays.tsx", "FindBar"],
    ["find/FindBar.tsx", "TextInput"],
    ["sidebar/TabRow.tsx", "TextInput"],
    ["omnibox/CommandPanel.tsx", "Omnibox"],
  ]) {
    for (const hit of placed(file, field)) assert.deepEqual(hit.markers, [], `<${field}> in ${file}`);
    assert.deepEqual(elements(file).filter((element) => element.name === MARKER), [], `${file} marks no content area`);
  }
  const app = new URL("../App.tsx", import.meta.url);
  assert.ok(!readFileSync(app, "utf8").includes(MARKER), "App.tsx, where the command bar is placed, marks no content area");
});
