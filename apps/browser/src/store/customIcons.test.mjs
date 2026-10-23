import assert from "node:assert/strict";
import { test } from "node:test";
import { ICON_CATALOG, ICON_STYLES, iconValue, isVectorIcon, normalizeIconColor, parseCustomIcon } from "../lib/iconCatalog.ts";
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

test("icon colors normalize full RGB values and reject malformed inputs", () => {
  for (const value of ["a1b2c3", "#a1b2c3", "A1B2C3", "#A1B2C3"]) assert.equal(normalizeIconColor(value), "#A1B2C3");
  for (const value of [null, undefined, "", "#abc", "#aabbccdd", "#gggggg", "##aabbcc", " #aabbcc", "#aabbcc ", "red", "#aabbcc|#ffffff"]) {
    assert.equal(normalizeIconColor(value), null);
    assert.equal(iconValue("symbols", "star", value), "symbol:star");
  }
});

test("every icon style round trips an explicit color and restores the exact theme-driven value", () => {
  for (const { id: style } of ICON_STYLES) {
    for (const { name } of ICON_CATALOG) {
      const legacy = iconValue(style, name);
      assert.deepEqual(parseCustomIcon(legacy), { style, name });
      assert.equal(iconValue(style, name, null), legacy);
      assert.equal(iconValue(style, name, undefined), legacy);
      const colored = iconValue(style, name, "a1b2c3");
      assert.equal(colored, `${legacy}|#A1B2C3`);
      assert.deepEqual(parseCustomIcon(colored), { style, name, color: "#A1B2C3" });
      const parsed = parseCustomIcon(colored);
      assert.equal(iconValue(parsed.style, parsed.name, null), legacy);
    }
  }
  assert.deepEqual(parseCustomIcon("symbol:future.symbol|#a1b2c3"), { style: "symbols", name: "future.symbol", color: "#A1B2C3" });
});

test("malformed icon metadata is rejected for every reserved style prefix", () => {
  for (const { id: style } of ICON_STYLES) {
    const value = iconValue(style, "heart");
    for (const suffix of ["|", "|aabbcc", "|#abc", "|#aabbccdd", "|#gggggg", "| #aabbcc", "|#aabbcc ", "|#aabbcc|#112233", "||#aabbcc", "|#aabbcc|", "|#aabbcc\n"]) {
      assert.equal(parseCustomIcon(value + suffix), null, value + suffix);
      assert.equal(isVectorIcon(value + suffix), true);
    }
  }
  for (const value of ["lucide:missing|#AABBCC", "duotone:missing|#AABBCC", "symbol:|#AABBCC", "📚|#AABBCC"]) assert.equal(parseCustomIcon(value), null);
  assert.equal(isVectorIcon("📚"), false);
  assert.equal(isVectorIcon(null), false);
});

test("explicit icon colors persist on tabs and groups and resetting the color restores theme-driven storage", () => {
  docs.clear();
  useBrowser.getState().hydrate({});
  const stop = startPersistence();
  try {
    const window = useBrowser.getState().createWindow();
    const records = ICON_STYLES.map(({ id: style }, index) => {
      const tab = useBrowser.getState().newTab(window, { url: "https://example.com" });
      const sibling = useBrowser.getState().newTab(window, { url: "https://example.org" });
      const group = useBrowser.getState().groupTabs([tab, sibling]);
      const color = ["#EF4444", "#0FBA4F", "#6750A4"][index];
      useBrowser.getState().updateTab(tab, { customIcon: iconValue(style, "heart", color) });
      useBrowser.getState().updateGroup(group, { icon: iconValue(style, "folder", color) });
      return { style, tab, group, color };
    });
    const emoji = useBrowser.getState().newTab(window, { url: "https://example.net" });
    useBrowser.getState().updateTab(emoji, { customIcon: "📚" });
    const emojiGroup = useBrowser.getState().createGroup([emoji], { icon: "⭐️" });
    flushPersistence();
    useBrowser.getState().hydrate(loadSession());
    for (const { style, tab, group, color } of records) {
      assert.deepEqual(parseCustomIcon(useBrowser.getState().tabs[tab].customIcon), { style, name: "heart", color });
      assert.deepEqual(parseCustomIcon(useBrowser.getState().groups[group].icon), { style, name: "folder", color });
      useBrowser.getState().updateTab(tab, { customIcon: iconValue(style, "heart", null) });
      useBrowser.getState().updateGroup(group, { icon: iconValue(style, "folder", null) });
    }
    flushPersistence();
    useBrowser.getState().hydrate(loadSession());
    for (const { style, tab, group } of records) {
      assert.equal(useBrowser.getState().tabs[tab].customIcon, iconValue(style, "heart"));
      assert.equal(useBrowser.getState().groups[group].icon, iconValue(style, "folder"));
      assert.deepEqual(parseCustomIcon(useBrowser.getState().tabs[tab].customIcon), { style, name: "heart" });
    }
    assert.equal(useBrowser.getState().tabs[emoji].customIcon, "📚");
    assert.equal(useBrowser.getState().groups[emojiGroup].icon, "⭐️");
  } finally {
    stop();
  }
});
