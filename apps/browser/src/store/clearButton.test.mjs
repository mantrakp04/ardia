import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const organize = await import("./organize.ts");

const S = () => useBrowser.getState();

test("the Clear button setting is on by default, and clearing unpinned tabs works with it off", () => {
  S().hydrate({});
  assert.equal(S().settings.showClearButton, true);
  S().updateSettings({ showClearButton: false });
  assert.equal(S().settings.showClearButton, false);
  const w = S().createWindow({ url: "https://a.com/" });
  S().newTab(w, { url: "https://b.com/" });
  S().newTab(w, { url: "https://c.com/" });
  S().pinTabs([S().windows[w].tabIds[0]], true);
  assert.equal(S().clearUnpinnedTabs(w).entries.length, 2);
  assert.equal(organize.unpinnedTabIds(S(), w).length, 0);
  assert.equal(S().settings.showClearButton, false);
});

test("the sidebar draws the Clear divider only with the setting on, on screen, and with tabs", async () => {
  const { clearDividerShown } = await import("../components/sidebar/clearDividerShown.ts");
  assert.equal(clearDividerShown(true, false, 3), true);
  assert.equal(clearDividerShown(false, false, 3), false);
  assert.equal(clearDividerShown(true, true, 3), false);
  assert.equal(clearDividerShown(true, false, 0), false);
});
