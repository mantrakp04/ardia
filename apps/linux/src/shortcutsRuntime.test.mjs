import assert from "node:assert/strict";
import { after, test } from "node:test";
import { runCommand } from "../../browser/src/state/commands/commands.ts";
import { activeTabId } from "../../browser/src/state/browser/model.ts";
import { setShortcutOverride } from "../../browser/src/state/settings/actions.ts";
import { shortcutItems } from "../../browser/src/state/settings/paneData.ts";
import { load } from "../../browser/src/state/settings/resources.ts";
import { sameShortcut } from "../../browser/src/state/commands/shortcuts.ts";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { shortcutHint, setMenuBarShortcuts } from "../../browser/src/state/commands/commandShortcuts.ts";
import { ardiaHost } from "../scripts/input-test-host.mjs";
import { cancelShortcutRecording, recordShortcut, startLinuxShortcuts } from "./shortcutsRuntime.ts";
import { requireNativeModule } from "./shims/expo-modules-core.ts";

const listeners = new Map();
const previousWindow = globalThis.window;
const previousDocument = globalThis.document;
globalThis.window = { addEventListener(name, listener) { listeners.set(name, listener); } };
globalThis.document = { activeElement: null };
after(() => {
  globalThis.window = previousWindow;
  globalThis.document = previousDocument;
});

const events = [];
requireNativeModule("ArdiaShell").addListener("onCommand", (event) => events.push(event));
requireNativeModule("ArdiaShell").addListener("onAppEvent", (event) => events.push(event));
const flush = () => new Promise(setImmediate);
const state = () => useBrowser.getState();
const table = () => ardiaHost.calls.filter((call) => call.method === "ArdiaShell.setKeyboardShortcuts").at(-1).payload.args[0];
const key = (type, code, value, mods = {}) => {
  const event = { code, key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  listeners.get(type)(event);
  return event;
};

await startLinuxShortcuts(ardiaHost);

test("runtime submits the effective catalog to native and records, remaps, disables and resets with the same physical modifiers", async () => {
  state().hydrate({});
  await flush();
  assert.equal(table().find((binding) => binding.keyCode === 74 && binding.modifiers === 4).command, "downloads");
  const dispatched = key("keydown", "KeyJ", "j", { ctrlKey: true });
  assert.ok(dispatched.prevented && dispatched.stopped);
  assert.equal(events.at(-1).command, "downloads");
  assert.equal(shortcutHint("downloads"), "Ctrl+J");
  setMenuBarShortcuts([]);

  for (const [mods, modifier, hint, flags] of [[{ ctrlKey: true }, "command", "Ctrl+K", 4], [{ metaKey: true }, "control", "Super+K", 16]]) {
    const promise = recordShortcut();
    await flush();
    const recorded = key("keydown", "KeyK", "k", mods);
    assert.ok(recorded.prevented && recorded.stopped);
    const combo = await promise;
    assert.deepEqual(combo, { key: "k", modifiers: [modifier] });
    state().updateSettings({ shortcuts: { downloads: [combo.key, ...combo.modifiers] } });
    await flush();
    assert.equal(shortcutHint("downloads"), hint);
    assert.equal(table().find((binding) => binding.keyCode === 75 && binding.modifiers === flags).command, "downloads");
    assert.equal(table().find((binding) => binding.keyCode === 74 && binding.modifiers === 4).suppressed, true);
    key("keydown", "KeyK", "k", mods);
    assert.equal(events.at(-1).command, "downloads");
  }
  state().updateSettings({ shortcuts: { downloads: [""] } });
  await flush();
  assert.equal(shortcutHint("downloads"), undefined);
  assert.equal(table().find((binding) => binding.keyCode === 74 && binding.modifiers === 4).suppressed, true);
  assert.equal(table().find((binding) => binding.keyCode === 76 && binding.modifiers === 12).suppressed, true);
  state().updateSettings({ shortcuts: {} });
  await flush();
  assert.equal(table().find((binding) => binding.keyCode === 74 && binding.modifiers === 4).command, "downloads");
  assert.equal(table().find((binding) => binding.keyCode === 74 && binding.modifiers === 4).suppressed, undefined);
  const calls = ardiaHost.calls.filter((call) => call.method === "ArdiaShell.setShortcutRecording");
  assert.deepEqual(calls.slice(-4).map((call) => call.payload.args[0]), [true, false, true, false]);
});

test("Ctrl and remapped Super switchers release only their held physical modifier, including native command events", async () => {
  state().updateSettings({ shortcuts: {} });
  await flush();
  key("keydown", "Tab", "Tab", { ctrlKey: true });
  assert.equal(events.at(-1).command, "tabSwitcher");
  const count = events.length;
  key("keyup", "MetaLeft", "Meta");
  assert.equal(events.length, count);
  key("keyup", "ControlLeft", "Control");
  assert.equal(events.at(-1).type, "switcherReleased");

  state().updateSettings({ shortcuts: { "tabSwitcher:forward": ["\t", "control"] } });
  await flush();
  assert.equal(shortcutHint("tabSwitcher:forward"), "Super+Tab");
  for (const listener of ardiaHost.listeners) listener("ArdiaShell", "onCommand", { command: "tabSwitcher", arg: "forward", shortcutModifiers: 16 });
  const nativeCount = events.length;
  key("keyup", "ControlLeft", "Control");
  assert.equal(events.length, nativeCount);
  key("keyup", "MetaLeft", "Meta");
  assert.equal(events.at(-1).type, "switcherReleased");
});

test("text input keeps notInText commands and ordinary keys, recording cancellation and function keys preserve their contracts", async () => {
  state().updateSettings({ shortcuts: {} });
  await flush();
  globalThis.document.activeElement = { matches: () => true };
  assert.equal(key("keydown", "Enter", "Enter", { ctrlKey: true }).prevented, false);
  assert.equal(key("keydown", "KeyA", "a").prevented, false);
  globalThis.document.activeElement = null;
  assert.equal(key("keydown", "Enter", "Enter", { ctrlKey: true }).prevented, true);
  const recording = recordShortcut();
  await flush();
  key("keydown", "ControlLeft", "Control", { ctrlKey: true });
  key("keydown", "F6", "F6");
  assert.deepEqual(await recording, { key: String.fromCharCode(0xf709), modifiers: [] });
  const cancelled = recordShortcut();
  await flush();
  key("keydown", "Escape", "Escape");
  assert.equal(await cancelled, null);
  await cancelShortcutRecording();
});

test("invokable Settings variants survive actual recording, native registration and current shared command dispatch with their required arguments", async () => {
  const dispatch = requireNativeModule("ArdiaShell").addListener("onCommand", runCommand);
  try {
    for (const command of ["setAppearance", "setBookmarksBar", "selectTab", "switchProfile"]) {
      state().hydrate({});
      const windowId = state().createWindow({ id: ardiaHost.bootstrap.windowId, url: "https://first.test" });
      const first = activeTabId(state(), windowId);
      state().newTab(windowId, { url: "https://second.test" });
      const profile = state().createProfile({ name: "Recorded target" });
      const arg = { setAppearance: "light", setBookmarksBar: "always", selectTab: "1", switchProfile: profile }[command];
      const id = `${command}:${arg}`;
      const rows = await load(shortcutItems, []);
      assert.ok(!rows.some((row) => row.id === command));
      const row = rows.find((row) => row.id === id);
      assert.ok(row?.remappable);
      const recording = recordShortcut();
      await flush();
      key("keydown", "KeyT", "t", { ctrlKey: true });
      const combo = await recording;
      setShortcutOverride(row.id, sameShortcut(combo, { key: row.defaultKey, modifiers: row.defaultModifiers }) ? null : combo);
      await flush();
      const binding = table().find((binding) => binding.keyCode === 84 && binding.modifiers === 4);
      assert.equal(binding.command, command);
      assert.equal(binding.arg, arg);
      key("keydown", "KeyT", "t", { ctrlKey: true });
      if (command === "setAppearance") assert.equal(state().settings.appearance, "light");
      if (command === "setBookmarksBar") assert.equal(state().settings.bookmarksBar, "always");
      if (command === "selectTab") assert.equal(activeTabId(state(), windowId), first);
      if (command === "switchProfile") assert.equal(state().windows[windowId].profileId, profile);
    }
  } finally {
    dispatch.remove();
  }
});
