import assert from "node:assert/strict";
import { test } from "node:test";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { activeTabId } from "../../browser/src/state/browser/model.ts";
import { modifiersOf } from "../../browser/src/lib/keys.ts";
import { openModeFor, openUrl } from "../../browser/src/state/bookmarks/actions.ts";
import { setShortcutOverride } from "../../browser/src/state/settings/actions.ts";
import { shortcutItems } from "../../browser/src/state/settings/paneData.ts";
import { load } from "../../browser/src/state/settings/resources.ts";
import { sameShortcut } from "../../browser/src/state/commands/shortcuts.ts";
import { shortcutHint } from "../../browser/src/state/commands/commandShortcuts.ts";
import { resourceCache } from "../scripts/input-test-resources.mjs";
import { keyboardCombo, linuxBindings, linuxMenuShortcuts } from "./shortcuts.ts";

const state = () => useBrowser.getState();
const reset = () => state().hydrate({});
const cachedRows = () => resourceCache.getState()[JSON.stringify([shortcutItems.name])];
const key = (code, mods = {}) => keyboardCombo({ code, key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
const bindingAt = (bindings, combo) => bindings.find((binding) => binding.keyCode === combo.keyCode && binding.modifiers === combo.flags);

for (const caller of ["HistoryButton toolbar Button", "HistoryPopover Row"]) {
  test(`${caller}: physical event to modifiersOf to openModeFor preserves Ctrl and Ctrl+Shift history disposition`, () => {
    for (const [mods, expected] of [[{ ctrlKey: true }, "background"], [{ ctrlKey: true, shiftKey: true }, "foreground"]]) {
      reset();
      const windowId = state().createWindow({ url: "https://history-source.test" });
      const source = activeTabId(state(), windowId);
      const semantic = modifiersOf({ nativeEvent: mods });
      const mode = openModeFor(semantic);
      assert.equal(mode, expected);
      openUrl("https://history-target.test", windowId, mode);
      assert.equal(state().tabs[source].url, "https://history-source.test");
      assert.equal(state().windows[windowId].tabIds.length, 2);
      assert.equal(activeTabId(state(), windowId) === source, expected === "background");
    }
  });
}

test("semantic selection inputs retain command meaning without inferring physical modifiers", () => {
  assert.equal(openModeFor({ metaKey: true }), "background");
  assert.equal(openModeFor({ metaKey: true, shiftKey: true }), "foreground");
});

test("Settings excludes argument-requiring containers and obsolete container overrides cannot steal New Tab", () => {
  reset();
  const ids = new Set(linuxMenuShortcuts({}, state().profileOrder).map((item) => item.id));
  for (const id of ["setAppearance", "setBookmarksBar", "selectTab", "switchProfile", "moveTabToProfile", "moveTabToWindow", "addBookmarkToFolder", "openBookmark", "addFolderToSidebar", "restoreArcFolders", "openExtension", "autofill", "tabSwitcher"]) assert.ok(!ids.has(id), id);
  for (const id of ["setAppearance:auto", "setAppearance:light", "setAppearance:dark", "setBookmarksBar:always", "setBookmarksBar:newTab", "setBookmarksBar:never", "selectTab:1", `switchProfile:${state().profileOrder[0]}`]) assert.ok(ids.has(id), id);
  assert.equal(bindingAt(linuxBindings({ setAppearance: ["t", "command"] }, state().profileOrder), key("KeyT", { ctrlKey: true })).command, "newTab");
});

test("legacy disabled profile shortcuts stay disabled for existing profiles", () => {
  assert.deepEqual(linuxBindings({ switchProfile: [""] }, ["work", "home"]).filter((binding) => binding.command === "switchProfile"), []);
});

test("legacy custom profile shortcut targets the first existing profile and replaces numbered defaults", () => {
  const bindings = linuxBindings({ switchProfile: ["k", "control"] }, ["work", "home"]);
  assert.deepEqual(bindings.filter((binding) => binding.command === "switchProfile"), [{ keyCode: 75, modifiers: 16, command: "switchProfile", arg: "work", notInText: false }]);
});

test("already-loaded Settings resource gains new profile rows together with the resolver", async () => {
  reset();
  await load(shortcutItems, []);
  const added = state().createProfile({ name: "Added after resource load" });
  const row = cachedRows().find((item) => item.id === `switchProfile:${added}`);
  assert.ok(row);
  assert.equal(row.defaultKey, "2");
  assert.equal(shortcutHint(row.id), "Super+2");
});

test("already-loaded Settings resource reorders defaults before recording or removing a profile shortcut", async () => {
  reset();
  const first = state().profileOrder[0];
  const added = state().createProfile({ name: "Reordered profile" });
  await load(shortcutItems, []);
  state().reorderProfiles([added, first]);
  const row = cachedRows().find((item) => item.id === `switchProfile:${first}`);
  assert.equal(row.defaultKey, "2");
  const recorded = key("Digit1", { metaKey: true });
  setShortcutOverride(row.id, sameShortcut(recorded, { key: row.defaultKey, modifiers: row.defaultModifiers }) ? null : recorded);
  assert.equal(shortcutHint(row.id), "Super+1");
  assert.deepEqual(state().settings.shortcuts[row.id], ["1", "control"]);
  setShortcutOverride(row.id, { key: "", modifiers: [] });
  assert.equal(shortcutHint(row.id), undefined);
  setShortcutOverride(row.id, null);
  assert.equal(shortcutHint(row.id), "Super+2");
});

test("legacy disabled profile overrides migrate once by stable identity, modern overrides win, new profiles get defaults, and per-row reset restores defaults", async () => {
  reset();
  const first = state().profileOrder[0];
  const second = state().createProfile({ name: "Existing second" });
  const profiles = state().profiles;
  const saved = { switchProfile: [""], [`switchProfile:${second}`]: ["q", "control"] };
  const original = structuredClone(saved);
  state().hydrate({ profiles, profileOrder: [first, second], settings: { shortcuts: saved } });
  assert.deepEqual(saved, original);
  assert.deepEqual(state().settings.shortcuts, { [`switchProfile:${first}`]: [""], [`switchProfile:${second}`]: ["q", "control"] });
  await load(shortcutItems, []);
  assert.equal(shortcutHint(`switchProfile:${first}`), undefined);
  assert.equal(shortcutHint(`switchProfile:${second}`), "Super+Q");
  const added = state().createProfile({ name: "Created after migration" });
  state().reorderProfiles([second, added, first]);
  assert.equal(shortcutHint(`switchProfile:${first}`), undefined);
  assert.equal(shortcutHint(`switchProfile:${second}`), "Super+Q");
  assert.equal(shortcutHint(`switchProfile:${added}`), "Super+2");
  assert.equal(cachedRows().find((row) => row.id === `switchProfile:${first}`).key, "");
  setShortcutOverride(`switchProfile:${first}`, null);
  assert.equal(shortcutHint(`switchProfile:${first}`), "Super+3");
  state().deleteProfile(second);
  assert.equal(shortcutHint(`switchProfile:${second}`), undefined);
  assert.ok(!cachedRows().some((row) => row.id === `switchProfile:${second}`));
  assert.ok(!linuxBindings(state().settings.shortcuts, state().profileOrder).some((binding) => binding.command === "switchProfile" && binding.arg === second));
  state().updateSettings({ shortcuts: {} });
  assert.equal(shortcutHint(`switchProfile:${added}`), "Super+1");
  assert.equal(shortcutHint(`switchProfile:${first}`), "Super+2");
});

test("legacy custom profile target becomes stable through reorder and deletion, while explicit modern disabled/default overrides keep precedence", () => {
  reset();
  const first = state().profileOrder[0];
  const second = state().createProfile({ name: "Second custom target" });
  state().updateSettings({ shortcuts: { switchProfile: ["k", "control"] } });
  assert.deepEqual(state().settings.shortcuts, { [`switchProfile:${first}`]: ["k", "control"], [`switchProfile:${second}`]: [""] });
  state().reorderProfiles([second, first]);
  const custom = bindingAt(linuxBindings(state().settings.shortcuts, state().profileOrder), key("KeyK", { metaKey: true }));
  assert.equal(custom.arg, first);
  assert.equal(shortcutHint(`switchProfile:${second}`), undefined);
  setShortcutOverride(`switchProfile:${first}`, null);
  assert.equal(shortcutHint(`switchProfile:${first}`), "Super+2");
  state().updateSettings({ shortcuts: { switchProfile: ["k", "control"], [`switchProfile:${second}`]: [""], [`switchProfile:${first}`]: ["2", "control"] } });
  assert.deepEqual(state().settings.shortcuts, { [`switchProfile:${second}`]: [""], [`switchProfile:${first}`]: ["2", "control"] });
  state().deleteProfile(first);
  assert.ok(!bindingAt(linuxBindings(state().settings.shortcuts, state().profileOrder), key("Digit2", { metaKey: true })));
  assert.equal(shortcutHint(`switchProfile:${second}`), undefined);
  state().updateSettings({ shortcuts: {} });
  assert.equal(shortcutHint(`switchProfile:${second}`), "Super+1");
});

test("legacy saved default remains an explicit first-profile binding until reset, and absent overrides retain every numbered default", () => {
  const profiles = ["work", "home"];
  const bindings = linuxBindings({ switchProfile: ["1", "control"] }, profiles).filter((binding) => binding.command === "switchProfile");
  assert.deepEqual(bindings.map(({ keyCode, arg }) => [keyCode, arg]), [[49, "work"]]);
  const resetBindings = linuxBindings({}, profiles).filter((binding) => binding.command === "switchProfile");
  assert.deepEqual(resetBindings.map(({ keyCode, arg }) => [keyCode, arg]), [[49, "work"], [50, "home"]]);
});

test("late resource loads cannot restore stale profile rows or defaults after synchronous catalog refresh", async () => {
  reset();
  await load(shortcutItems, []);
  const first = state().profileOrder[0];
  const pending = load(shortcutItems, [], { fresh: true });
  const added = state().createProfile({ name: "Created while resource loads" });
  state().reorderProfiles([added, first]);
  await pending;
  assert.ok(cachedRows().some((row) => row.id === `switchProfile:${added}`));
  assert.equal(cachedRows().find((row) => row.id === `switchProfile:${first}`).defaultKey, "2");
  assert.equal(shortcutHint(`switchProfile:${first}`), "Super+2");
});

test("Settings cache notifications publish rows whose current defaults and effective hints already agree", async () => {
  reset();
  await load(shortcutItems, []);
  let notifications = 0;
  const unsubscribe = resourceCache.subscribe(() => {
    notifications++;
    const expected = linuxMenuShortcuts(state().settings.shortcuts, state().profileOrder);
    assert.deepEqual(cachedRows(), expected);
    for (const row of cachedRows().filter((row) => row.id.startsWith("switchProfile:"))) {
      const combo = row.key ? { key: row.key, modifiers: row.modifiers } : undefined;
      assert.deepEqual(shortcutHint(row.id), combo ? row.modifiers.includes("control") ? `Super+${row.key}` : `Ctrl+${row.key}` : undefined);
    }
  });
  try {
    const first = state().profileOrder[0];
    const added = state().createProfile({ name: "Observed update" });
    state().reorderProfiles([added, first]);
    setShortcutOverride(`switchProfile:${first}`, { key: "", modifiers: [] });
    setShortcutOverride(`switchProfile:${first}`, null);
    state().deleteProfile(added);
    assert.equal(notifications, 5);
  } finally {
    unsubscribe();
  }
});
