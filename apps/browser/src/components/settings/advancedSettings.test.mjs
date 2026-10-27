import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { ADVANCED_SETTINGS } = await import("./rows/advanced.ts");
const { ADVANCED_PANES, SETTINGS } = await import("./settingsIndex.ts");

test("every advanced setting names a row in the settings index", () => {
  const ids = new Set(SETTINGS.map((s) => s.id));
  assert.deepEqual([...ADVANCED_SETTINGS].filter((id) => !ids.has(id)), []);
});

test("only the Engines and Advanced panes hide whole", () => {
  assert.deepEqual([...ADVANCED_PANES].sort(), ["advanced", "engines"]);
});

test("every pane keeps a basic setting unless it hides whole", () => {
  const panes = new Set(SETTINGS.map((s) => s.pane));
  for (const pane of panes) if (!ADVANCED_PANES.has(pane)) assert.ok(SETTINGS.some((s) => s.pane === pane && !s.advanced), pane);
});
