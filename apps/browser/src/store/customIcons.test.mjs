import assert from "node:assert/strict";
import { test } from "node:test";
import { iconValue, parseCustomIcon } from "../lib/iconCatalog.ts";
import { flushPersistence, loadSession, startPersistence } from "../lib/persist.ts";
import { docs } from "../test-native-stub.mjs";
import { useBrowser } from "./browser.ts";

test("icon styles survive a session reload on tabs and groups without losing legacy emoji", () => {
  docs.clear();
  useBrowser.getState().hydrate({});
  const stop = startPersistence();
  const window = useBrowser.getState().createWindow();
  const ids = ["symbols", "lucide", "duotone"].map((style) => {
    const id = useBrowser.getState().newTab(window, { url: "https://example.com" });
    useBrowser.getState().updateTab(id, { customIcon: iconValue(style, "heart") });
    return id;
  });
  const emoji = useBrowser.getState().newTab(window, { url: "https://example.org" });
  useBrowser.getState().updateTab(emoji, { customIcon: "📚" });
  const group = useBrowser.getState().groupTabs(ids);
  useBrowser.getState().updateGroup(group, { icon: "duotone:folder" });
  flushPersistence();
  stop();
  useBrowser.getState().hydrate(loadSession());
  for (const [index, style] of ["symbols", "lucide", "duotone"].entries()) {
    const value = useBrowser.getState().tabs[ids[index]].customIcon;
    assert.deepEqual(parseCustomIcon(value), { style, name: "heart" });
  }
  assert.equal(useBrowser.getState().tabs[emoji].customIcon, "📚");
  assert.equal(useBrowser.getState().groups[group].icon, "duotone:folder");
});

test("malformed new icon styles are rejected while legacy SF names remain usable", () => {
  for (const value of ["lucide:missing-icon", "duotone:", "duotone:star:extra", "📚", null]) assert.equal(parseCustomIcon(value), null);
  assert.deepEqual(parseCustomIcon("symbol:star.fill"), { style: "symbols", name: "star.fill" });
});
