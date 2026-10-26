import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../../store/browser.ts");
const { DEFAULT_SETTINGS } = await import("../../store/settings.ts");
const { SYNCED_SETTINGS } = await import("../../sync/adapters.ts");
const { SETTINGS } = await import("../settings/settingsIndex.ts");
const { dotGlyph } = await import("./icons.tsx");

const S = () => useBrowser.getState();
const profile = (id, name, icon) => ({ id, name, color: "plum", icon, createdAt: 0 });
const glyphOf = (id, showIcons) => dotGlyph(S().profiles[id], showIcons);

test("profile icons in the sidebar are off by default, synced, and listed in Settings › Tabs", () => {
  assert.equal(DEFAULT_SETTINGS.profileIconsInSidebar, false);
  assert.ok(SYNCED_SETTINGS.includes("profileIconsInSidebar"));
  assert.equal(SETTINGS.find((s) => s.id === "tabs.profileIconsInSidebar")?.pane, "tabs");
  S().hydrate({});
  assert.equal(S().settings.profileIconsInSidebar, false);
});

test("the switcher draws dots until the setting is on, then each profile's symbol, emoji or initial", () => {
  S().hydrate({
    profiles: {
      work: profile("work", "Work", "symbol:briefcase.fill"),
      fun: profile("fun", "Fun", "🎮"),
      home: profile("home", "  home", null),
      blank: profile("blank", " ", null),
    },
    profileOrder: ["work", "fun", "home", "blank"],
  });
  for (const id of S().profileOrder) assert.deepEqual(glyphOf(id, S().settings.profileIconsInSidebar), { kind: "dot" }, id);
  S().updateSettings({ profileIconsInSidebar: true });
  assert.deepEqual(glyphOf("work", S().settings.profileIconsInSidebar), { kind: "symbol", name: "briefcase.fill" });
  assert.deepEqual(glyphOf("fun", S().settings.profileIconsInSidebar), { kind: "text", text: "🎮" });
  assert.deepEqual(glyphOf("home", S().settings.profileIconsInSidebar), { kind: "text", text: "H" });
  assert.deepEqual(glyphOf("blank", S().settings.profileIconsInSidebar), { kind: "text", text: "?" });
  S().updateSettings({ profileIconsInSidebar: false });
  assert.deepEqual(glyphOf("work", S().settings.profileIconsInSidebar), { kind: "dot" });
});
