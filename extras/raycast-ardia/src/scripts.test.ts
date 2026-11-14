import assert from "node:assert/strict";
import { test } from "node:test";
import {
  closeTabScript,
  focusTabScript,
  listProfilesScript,
  listTabsScript,
  newTabScript,
  newWindowScript,
  parseProfiles,
  parseTabs,
  profileNamed,
  quote,
  showProfileScript,
  tabSections,
} from "./scripts.ts";

const fs = "\u001f";
const rs = "\u001e";

test("quotes ids and targets the app by bundle id", () => {
  assert.equal(quote('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(
    focusTabScript({ windowId: "w-1", profileId: "p-1", tabId: "tab-2" }),
    'tell application id "com.ardia.browser" to focus (tab id "tab-2" of window id "w-1")',
  );
  assert.equal(
    closeTabScript({ windowId: "w-1", profileId: "p-1", tabId: "tab-2" }, "current application"),
    'tell current application to close (tab id "tab-2" of window id "w-1")',
  );
  assert.equal(
    focusTabScript({ windowId: "", profileId: 'p"2', tabId: "tab-3" }, "current application"),
    'tell current application to focus (tab id "tab-3" of profile id "p\\"2")',
  );
  assert.equal(
    closeTabScript({ windowId: "", profileId: "p-2", tabId: "tab-3" }, "current application"),
    'tell current application to close (tab id "tab-3" of profile id "p-2")',
  );
  assert.match(listTabsScript(), /tell application id "com\.ardia\.browser"/);
  assert.match(listProfilesScript(), /tell application id "com\.ardia\.browser"/);
});

test("reads tabs and profiles from the separated answer", () => {
  assert.deepEqual(parseTabs(`w-1${fs}1${fs}p-1${fs}tab-2${fs}Example${fs}missing value${fs}true${fs}false${rs}`), [
    {
      windowId: "w-1",
      windowIndex: 1,
      profileId: "p-1",
      tabId: "tab-2",
      title: "Example",
      url: "",
      isPinned: true,
      isFocused: false,
    },
  ]);
  assert.deepEqual(parseProfiles(`p-1${fs}Personal${fs}3${fs}true${rs}p-2${fs}Work${fs}1${fs}false${rs}`), [
    { id: "p-1", name: "Personal", tabCount: 3, isCurrent: true },
    { id: "p-2", name: "Work", tabCount: 1, isCurrent: false },
  ]);
  assert.deepEqual(parseProfiles(""), []);
});

test("finds a profile by its name, or by a start no other profile shares", () => {
  const profiles = parseProfiles(
    `p-1${fs}Work Archive${fs}0${fs}false${rs}p-2${fs}Work${fs}0${fs}false${rs}p-3${fs}Personal${fs}0${fs}false${rs}`,
  );
  assert.equal(profileNamed(profiles, " work ").id, "p-2");
  assert.equal(profileNamed(profiles, "pers").id, "p-3");
  assert.equal(profileNamed(profiles, "work a").id, "p-1");
  assert.throws(() => profileNamed(profiles, " wo "), { message: "“wo” matches Work Archive, Work." });
  assert.throws(() => profileNamed(profiles, "School"), {
    message: "No profile is named “School”. Ardia has Work Archive, Work, Personal.",
  });
  const twins = parseProfiles(`p-1${fs}Work${fs}0${fs}false${rs}p-2${fs}work${fs}0${fs}false${rs}`);
  assert.throws(() => profileNamed(twins, "Work"), { message: "“Work” matches Work, work." });
});

test("shows a profile in the front window, or in a new one when the front can't show it", () => {
  assert.equal(
    showProfileScript({ id: 'p"1' }, "current application"),
    `tell current application
  try
    focus (profile id "p\\"1")
  on error
    make new window with properties {active profile:(profile id "p\\"1")}
  end try
end tell`,
  );
});

test("makes windows in a profile or incognito", () => {
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

test("lists every profile's tabs once, keeping the window a shown tab is in, and skips private windows", () => {
  const script = listTabsScript();
  assert.match(script, /repeat with p in profiles/);
  assert.match(script, /if pId is not "" then/);
  const tabs = parseTabs(
    `w-1${fs}1${fs}p-1${fs}tab-1${fs}Shown${fs}https://a.example/${fs}false${fs}true${rs}` +
      `${fs}0${fs}p-1${fs}tab-1${fs}Shown${fs}https://a.example/${fs}false${fs}false${rs}` +
      `${fs}0${fs}p-2${fs}tab-2${fs}Hidden${fs}https://b.example/${fs}true${fs}false${rs}`,
  );
  assert.deepEqual(
    tabs.map(({ tabId, windowId, windowIndex, profileId, isFocused }) => ({
      tabId,
      windowId,
      windowIndex,
      profileId,
      isFocused,
    })),
    [
      { tabId: "tab-1", windowId: "w-1", windowIndex: 1, profileId: "p-1", isFocused: true },
      { tabId: "tab-2", windowId: "", windowIndex: 0, profileId: "p-2", isFocused: false },
    ],
  );
});

test("groups tabs by profile with the current profile first, or shows one profile's tabs", () => {
  const tabs = parseTabs(
    `w-1${fs}1${fs}p-2${fs}tab-1${fs}Work${fs}${fs}false${fs}true${rs}` +
      `${fs}0${fs}p-1${fs}tab-3${fs}Personal${fs}${fs}false${fs}false${rs}`,
  );
  const profiles = [
    { id: "p-1", name: "Personal", isCurrent: false },
    { id: "p-2", name: "Work", isCurrent: true },
    { id: "p-3", name: "Empty", isCurrent: false },
  ];
  const ids = (sections: ReturnType<typeof tabSections>) =>
    sections.map((section) => [section.title, section.tabs.map((tab) => tab.tabId)]);
  assert.deepEqual(ids(tabSections(tabs, profiles)), [
    ["Work", ["tab-1"]],
    ["Personal", ["tab-3"]],
  ]);
  assert.deepEqual(ids(tabSections(tabs, profiles, "p-1")), [[undefined, ["tab-3"]]]);
  assert.deepEqual(ids(tabSections(tabs, profiles, "gone")), ids(tabSections(tabs, profiles)));
  assert.deepEqual(ids(tabSections(tabs, [profiles[0]])), [[undefined, ["tab-1", "tab-3"]]]);
});
