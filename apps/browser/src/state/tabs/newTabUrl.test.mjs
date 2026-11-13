import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { activeTabId } = await import("../browser/model.ts");
const { customNewTabUrl } = await import("../settings/settings.ts");
const { runCommand } = await import("../commands/commands.ts");
const { settingsSnapshot } = await import("../telemetry/settingsSnapshot.ts");
const { unshownSettings } = await import("../../components/settings/settingsIndex.ts");

const S = () => useBrowser.getState();
const shownUrl = (w) => S().tabs[activeTabId(S(), w)].url;
const hidden = () => unshownSettings(S().settings, { top: false, glass: true }).split("\n");
const reset = (settings = {}) => {
  S().hydrate({});
  S().updateSettings(settings);
};

test("with no address set, ⌘T, the New Tab row and a new window open the New Tab page", () => {
  reset();
  const w = S().createWindow();
  assert.equal(shownUrl(w), "");
  runCommand({ command: "newTab", arg: null, windowId: w });
  assert.equal(shownUrl(w), "");
  S().newTab(w, { newTabCommand: true });
  assert.equal(shownUrl(w), "");
});

test("with an address set, ⌘T opens it in a new tab", () => {
  reset({ newTabUrl: "example.com" });
  const w = S().createWindow({ url: "https://a.com/" });
  const before = S().windows[w].tabIds.length;
  runCommand({ command: "newTab", arg: null, windowId: w });
  assert.equal(S().windows[w].tabIds.length, before + 1);
  assert.equal(shownUrl(w), "https://example.com");
});

test("the sidebar's New Tab row, a group's New Tab and a new window open it too", () => {
  reset({ newTabUrl: "https://start.example.org/home" });
  const w = S().createWindow();
  assert.equal(shownUrl(w), "https://start.example.org/home", "a new window");
  S().newTab(w, { newTabCommand: true });
  assert.equal(shownUrl(w), "https://start.example.org/home", "the New Tab row");
  const group = S().groupTabs([activeTabId(S(), w)]);
  const id = S().newTabInGroup(group);
  assert.equal(S().tabs[id].url, "https://start.example.org/home", "a group's New Tab");
});

test("links, typed addresses and Little Ardia keep their own address", () => {
  reset({ newTabUrl: "example.com" });
  const w = S().createWindow({ url: "https://a.com/" });
  const id = S().newTab(w, { url: "https://b.com/", newTabCommand: true });
  assert.equal(S().tabs[id].url, "https://b.com/");
  const link = S().newTab(w, { url: "https://c.com/", openerId: id });
  assert.equal(S().tabs[link].url, "https://c.com/");
  const small = S().createWindow({ kind: "small", url: "https://d.com/" });
  assert.equal(shownUrl(small), "https://d.com/");
  const blank = S().newTab(w);
  assert.equal(S().tabs[blank].url, "", "a tab made by the app, not by New Tab, stays empty");
});

test("an address that isn't one, or Ardia's own New Tab or Settings, falls back to the New Tab page", () => {
  for (const newTabUrl of ["", "   ", "hello world", "javascript:alert(1)", "ardia://newtab", "ardia://settings/tabs"]) {
    reset({ newTabUrl });
    assert.equal(customNewTabUrl(S().settings), undefined, newTabUrl);
    const w = S().createWindow({ url: "https://a.com/" });
    runCommand({ command: "newTab", arg: null, windowId: w });
    assert.equal(shownUrl(w), "", newTabUrl);
  }
});

test("with ⌘T opening the command bar, the address is ignored and its row is hidden", () => {
  reset({ newTabOpens: "commandBar", newTabUrl: "example.com" });
  assert.equal(customNewTabUrl(S().settings), undefined);
  const w = S().createWindow();
  assert.equal(shownUrl(w), "");
  assert.ok(hidden().includes("tabs.newTabUrl"));
  S().updateSettings({ newTabOpens: "page" });
  assert.ok(!hidden().includes("tabs.newTabUrl"));
});

test("the address syncs like the other New Tab settings, and telemetry gets only whether one is set", () => {
  reset({ newTabUrl: "https://secret.example.com/path" });
  const snapshot = settingsSnapshot(S().settings);
  assert.equal(snapshot.custom_new_tab_url, "true");
  assert.ok(!JSON.stringify(snapshot).includes("secret"));
  reset({ newTabUrl: "hello world" });
  assert.equal(settingsSnapshot(S().settings).custom_new_tab_url, "false");
});
