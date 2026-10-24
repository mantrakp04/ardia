import assert from "node:assert/strict";
import { test } from "node:test";
import {
  closeTabScript,
  findProfile,
  focusProfileScript,
  focusTabScript,
  listProfilesScript,
  listTabsScript,
  newTabScript,
  newWindowScript,
  parseProfiles,
  parseTabs,
  quote,
} from "./scripts.ts";

const fs = "\u001f";
const rs = "\u001e";

test("quotes ids and targets the app by bundle id", () => {
  assert.equal(quote('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(
    focusTabScript({ windowId: "w-1", tabId: "tab-2" }),
    'tell application id "com.ardia.browser" to focus (tab id "tab-2" of window id "w-1")',
  );
  assert.equal(
    closeTabScript({ windowId: "w-1", tabId: "tab-2" }, "current application"),
    'tell current application to close (tab id "tab-2" of window id "w-1")',
  );
  assert.match(listTabsScript(), /tell application id "com\.ardia\.browser"/);
  assert.match(listProfilesScript(), /tell application id "com\.ardia\.browser"/);
});

test("reads tabs and profiles from the separated answer", () => {
  assert.deepEqual(parseTabs(`w-1${fs}1${fs}tab-2${fs}Example${fs}missing value${fs}true${fs}false${rs}`), [
    { windowId: "w-1", windowIndex: 1, tabId: "tab-2", title: "Example", url: "", isPinned: true, isFocused: false },
  ]);
  assert.deepEqual(parseProfiles(`p-1${fs}Personal${fs}3${fs}true${rs}p-2${fs}Work${fs}1${fs}false${rs}`), [
    { id: "p-1", name: "Personal", tabCount: 3, isCurrent: true },
    { id: "p-2", name: "Work", tabCount: 1, isCurrent: false },
  ]);
  assert.deepEqual(parseProfiles(""), []);
});

test("finds a profile by its name, then by how it starts", () => {
  const profiles = parseProfiles(
    `p-1${fs}Work Archive${fs}0${fs}false${rs}p-2${fs}Work${fs}0${fs}false${rs}p-3${fs}Personal${fs}0${fs}false${rs}`,
  );
  assert.equal(findProfile(profiles, " work ")?.id, "p-2");
  assert.equal(findProfile(profiles, "pers")?.id, "p-3");
  assert.equal(findProfile(profiles, "School"), undefined);
});

test("shows a profile and makes windows in one", () => {
  assert.equal(
    focusProfileScript({ id: "p-1" }),
    'tell application id "com.ardia.browser" to focus (profile id "p-1")',
  );
  assert.equal(newWindowScript(), 'tell application id "com.ardia.browser" to make new window');
  assert.equal(
    newWindowScript({ incognito: true }, "current application"),
    "tell current application to make new window with properties {incognito:true}",
  );
  assert.equal(
    newWindowScript({ profileId: 'p"1' }, "current application"),
    'tell current application to make new window with properties {active profile:(profile id "p\\"1")}',
  );
});

test("makes a tab with what was typed, or an empty one", () => {
  assert.equal(newTabScript("  "), 'tell application id "com.ardia.browser" to make new tab');
  assert.equal(
    newTabScript(" ardia.dev ", "current application"),
    'tell current application to make new tab with properties {URL:"ardia.dev"}',
  );
  assert.equal(
    newTabScript('say "hi"', "current application"),
    'tell current application to make new tab with properties {URL:"say \\"hi\\""}',
  );
});
