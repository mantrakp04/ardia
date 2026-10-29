import assert from "node:assert/strict";
import test from "node:test";
import * as shared from "../../browser/src/state/settings/settingsWindows.ts";
import { windows } from "../../browser/src/test-native/index.ts";
import * as linux from "./settingsWindows.ts";
import { setSessionFlush } from "./session.ts";

test("Linux Settings shares navigation actions and opens the requested native utility only after saving", async () => {
  assert.equal(linux.useSettingsNav, shared.useSettingsNav);
  assert.equal(linux.goToSettingsPane, shared.goToSettingsPane);
  windows.open.clear();
  shared.useSettingsNav.setState({ pane: "general", profileId: null, detail: null, back: [], forward: [] });
  let saved;
  setSessionFlush(() => new Promise((resolve) => { saved = resolve; }));

  assert.equal(linux.openSettings("profiles", "work"), undefined);
  assert.equal(windows.open.has("settings"), false);
  assert.equal(shared.useSettingsNav.getState().pane, "profiles");
  assert.equal(shared.useSettingsNav.getState().profileId, "work");
  saved();
  await new Promise(setImmediate);
  assert.deepEqual(windows.open.get("settings"), {
    kind: "settings",
    title: "Settings",
    settings: { pane: "profiles", profileId: "work", detail: null },
  });
  assert.deepEqual(shared.useSettingsNav.getState().back, [{ pane: "general", profileId: null, detail: null }]);

  linux.settingsBack();
  assert.equal(shared.useSettingsNav.getState().pane, "general");
  linux.settingsForward();
  assert.equal(shared.useSettingsNav.getState().pane, "profiles");
});

test("Linux Import retains its consume-once source and waits for the session save before native opening", async () => {
  windows.open.clear();
  linux.setPreferredImportSource("firefox");
  assert.equal(linux.takePreferredImportSource(), "firefox");
  assert.equal(linux.takePreferredImportSource(), null);
  let saved;
  setSessionFlush(() => new Promise((resolve) => { saved = resolve; }));
  assert.equal(linux.openImport("chromium"), undefined);
  assert.equal(windows.open.has("import"), false);
  saved();
  await new Promise(setImmediate);
  assert.deepEqual(windows.open.get("import"), {
    kind: "import",
    title: "Import from Another Browser",
    importSource: "chromium",
  });
});
