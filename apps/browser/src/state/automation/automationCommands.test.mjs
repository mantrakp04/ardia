import assert from "node:assert/strict";
import { test } from "node:test";
const { COMMANDS } = await import("../commands/commandCatalog.ts");
const { AUTOMATION, automationCommands, automationDecision, isAutomatable, settingOf } = await import("./automationCommands.ts");
const { isConfigSettingKey } = await import("../settings/configAllowlist.ts");

const ids = Object.keys(COMMANDS);

test("every catalog command has an automation decision, and nothing else does", () => {
  const unclassified = ids.filter((id) => !Object.hasOwn(AUTOMATION, id));
  assert.deepEqual(unclassified, [], `classify these in AUTOMATION: ${unclassified.join(", ")}`);
  assert.deepEqual(Object.keys(AUTOMATION).filter((id) => !Object.hasOwn(COMMANDS, id)), []);
});

test("a command whose setting config files leave out is never automatable", () => {
  for (const id of ids) {
    const setting = settingOf(id);
    if (setting && !isConfigSettingKey(setting)) assert.notEqual(automationDecision(id), "run", id);
  }
  assert.equal(automationDecision("toggleJavaScriptFromAppleEvents"), "leftOutSetting");
});

test("commands that set a setting in runCommand's own cases touch only allowlisted settings", () => {
  for (const [command, key] of [["toggleAddressBar", "addressBar"], ["toggleBookmarksBar", "bookmarksBar"], ["toggleOpenLinksInLittleArdia", "openLinksInLittleArdia"]]) {
    assert.ok(isAutomatable(command), command);
    assert.ok(isConfigSettingKey(key), key);
  }
});

test("the engine switch and commands needing a free argument are refused", () => {
  assert.equal(automationDecision("togglePageEngine"), "changesEngine");
  for (const id of ["switchProfile", "moveTabToWindow", "openBookmark", "addFolderToSidebar", "restoreClosed"]) assert.equal(automationDecision(id), "needsArgument", id);
});

test("commands lists exactly the automatable commands, with titles and variants", () => {
  const listed = automationCommands();
  assert.deepEqual(listed.map((c) => c.id), ids.filter(isAutomatable));
  assert.ok(!listed.some((c) => c.id === "togglePageEngine" || c.id === "toggleJavaScriptFromAppleEvents"));
  for (const c of listed) assert.ok(typeof c.title === "string" && c.title.length > 0, c.id);
  assert.deepEqual(listed.find((c) => c.id === "setAppearance").variants, ["auto", "light", "dark"]);
  assert.equal(listed.find((c) => c.id === "newTab").variants, null);
  assert.equal(listed.find((c) => c.id === "reload").scope, "page");
});
