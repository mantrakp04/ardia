import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The command bar (⌘T / ⌘L) edits in RCTUIPlainPasteFieldEditor, a field editor the react-native-macos patch builds by hand. AppKit's shared field
// editor records undo (allowsUndo is YES); a bare NSTextView does not (NO), so with the bar focused Edit › Undo and Redo were disabled and ⌘Z did
// nothing (#1332). The app can't run here, so this reads the patch the way the other source-reading tests read Swift.
const patch = readFileSync(new URL("../../../../patches/react-native-macos@0.81.9.patch", import.meta.url), "utf8");
const added = patch
  .split("\n")
  .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
  .map((line) => line.slice(1))
  .join("\n");

function fieldEditorForView() {
  const start = added.indexOf("- (NSTextView *)fieldEditorForView:(NSView *)controlView");
  assert.notEqual(start, -1, "the patch no longer overrides fieldEditorForView:");
  const end = added.indexOf("} // Ardia]", start);
  assert.notEqual(end, -1, "fieldEditorForView: lost its closing Ardia marker");
  return added.slice(start, end);
}

test("the command bar's own field editor records undo, like AppKit's shared field editor", () => {
  const body = fieldEditorForView();
  assert.match(body, /\[\[RCTUIPlainPasteFieldEditor alloc\] initWithFrame:NSZeroRect\]/);
  assert.match(body, /_plainPasteEditor\.allowsUndo = YES;/, "the field editor is built without allowsUndo, so Edit › Undo and Redo are disabled while the bar has focus");
});

test("allowsUndo is set where the field editor is made, before it is handed to AppKit", () => {
  const body = fieldEditorForView();
  const made = body.indexOf("initWithFrame:NSZeroRect");
  const undo = body.indexOf("allowsUndo = YES");
  const returned = body.indexOf("return _plainPasteEditor;");
  assert.ok(made !== -1 && undo > made && returned > undo);
});
