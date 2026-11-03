import assert from "node:assert/strict";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";
await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { useProfileDataStats } = await import("./hooks.ts");

test("unopened profile stats distinguish unknown history from a loaded empty view", () => {
  useBrowser.getState().hydrate({});
  const profile = useBrowser.getState().createProfile({ name: "Unopened" });
  const row = mount(() => useProfileDataStats(profile));
  try {
    assert.match(row.value, /^History not loaded/);
    useBrowser.setState({ history: { [profile]: { list: [], floor: -Infinity, ready: true } } });
    assert.match(row.value, /^0 pages in history/);
  } finally {
    row.unmount();
  }
});
