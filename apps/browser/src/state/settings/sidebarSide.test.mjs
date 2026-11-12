import assert from "node:assert/strict";
import { test } from "node:test";
globalThis.acTestNativeModules = { ArdiaSharedFolders: { location: () => ({ path: "/scratch", iCloudAvailable: true, iCloudPath: "/scratch" }) } };
const { useBrowser } = await import("../browser/store.ts");
const { sidebarSideOf } = await import("../browser/model.ts");
const { SETTING_SPECS } = await import("./settings.ts");
const { isConfigSettingKey } = await import("./configAllowlist.ts");
const { chooseSidebarSide, toggleSidebarSide } = await import("./actions.ts");
const { menuState } = await import("../commands/menuState.ts");
const { runCommand } = await import("../commands/commands.ts");
const { unshownSettings } = await import("../../components/settings/settingsIndex.ts");

const S = () => useBrowser.getState();

function oneWindow() {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.example/" });
  S().setFocusedWindow(w);
  return w;
}

test("the sidebar sits on the left unless the owner picks the right", () => {
  const w = oneWindow();
  assert.equal(S().settings.sidebarSide, "left");
  assert.equal(SETTING_SPECS.sidebarSide.default, "left");
  assert.ok(SETTING_SPECS.sidebarSide.valid("right"));
  assert.ok(!SETTING_SPECS.sidebarSide.valid("top"));
  assert.ok(isConfigSettingKey("sidebarSide"));
  assert.equal(sidebarSideOf(S(), w), "left");
  chooseSidebarSide("right");
  assert.equal(sidebarSideOf(S(), w), "right");
  toggleSidebarSide();
  assert.equal(S().settings.sidebarSide, "left");
});

test("tabs along the top and Little Ardia never put a sidebar on the right", () => {
  const w = oneWindow();
  chooseSidebarSide("right");
  S().toggleTabLayout(w);
  assert.equal(sidebarSideOf(S(), w), "left");
  S().toggleTabLayout(w);
  assert.equal(sidebarSideOf(S(), w), "right");
  const small = S().createWindow({ kind: "small", url: "https://b.example/" });
  assert.equal(sidebarSideOf(S(), small), "left");
  chooseSidebarSide("left");
});

test("Sidebar on Right is checked when it is, and off for tabs along the top", () => {
  const w = oneWindow();
  assert.ok(!menuState(S()).checked.includes("toggleSidebarSide"));
  assert.ok(!menuState(S()).disabled.includes("toggleSidebarSide"));
  runCommand({ command: "toggleSidebarSide", arg: null, windowId: w });
  assert.equal(S().settings.sidebarSide, "right");
  assert.ok(menuState(S()).checked.includes("toggleSidebarSide"));
  S().toggleTabLayout(w);
  assert.ok(menuState(S()).disabled.includes("toggleSidebarSide"));
  S().toggleTabLayout(w);
  runCommand({ command: "toggleSidebarSide", arg: null, windowId: w });
  assert.equal(S().settings.sidebarSide, "left");
});

test("the Sidebar position row shows only while tabs are in the sidebar", () => {
  const settings = S().settings;
  assert.ok(!unshownSettings(settings, { top: false }).split("\n").includes("tabs.sidebarSide"));
  assert.ok(unshownSettings(settings, { top: true }).split("\n").includes("tabs.sidebarSide"));
});
