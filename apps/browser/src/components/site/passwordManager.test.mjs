import assert from "node:assert/strict";
import { mock, test } from "node:test";
const stub = await import("../../test-native-stub.mjs");
const { useBrowser } = await import("../../store/browser.ts");
const { DEFAULT_SETTINGS } = await import("../../store/settings.ts");
const { ICLOUD_PASSWORDS_EXTENSION_ID, PASSWORD_PREF_RETRY_MS, effectivePasswordManager, startPasswordManager } = await import("./passwordManager.ts");
const { useExtensions } = await import("../extensions/store.ts");

const engine = stub.passwordManagerEngine;
const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };

const calls = (kind) => engine.calls.filter((c) => c[0] === kind).map((c) => c.slice(1));
const takeCalls = () => engine.calls.splice(0);

test("Apple Passwords falls back to Ardia's manager on a Mac that can't show it", () => {
  engine.available = false;
  assert.equal(effectivePasswordManager({ passwordManager: "apple" }), "ardia");
  assert.equal(effectivePasswordManager(DEFAULT_SETTINGS), "ardia");
  assert.equal(effectivePasswordManager({ passwordManager: "none" }), "none");
  engine.available = true;
  assert.equal(effectivePasswordManager(DEFAULT_SETTINGS), "apple");
  assert.equal(effectivePasswordManager({ passwordManager: "ardia" }), "ardia");
  assert.equal(effectivePasswordManager({ passwordManager: "none" }), "none");
  assert.equal(effectivePasswordManager({ passwordManager: "keychain" }), "apple", "an unknown saved value is the default");
});

test("switching managers turns Apple Passwords and Chrome's offer to save on and off for every profile", () => {
  engine.available = true;
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const work = S().createProfile({ name: "Work" });
  S().createWindow({ url: "https://a.example/", profileId: "default" });
  S().updateSettings({ passwordManager: "ardia" });
  takeCalls();

  startPasswordManager();
  assert.deepEqual(calls("applePasswords"), [[false]]);
  assert.deepEqual(calls("offerToSave"), [], "starting in Ardia mode leaves each profile's own choice alone");
  takeCalls();

  S().updateSettings({ passwordManager: "apple" });
  assert.deepEqual(calls("applePasswords"), [[true]]);
  assert.deepEqual(new Set(calls("offerToSave").map(JSON.stringify)), new Set([JSON.stringify(["", false]), JSON.stringify([work, false])]));
  takeCalls();

  S().updateSettings({ showFullUrl: true });
  assert.deepEqual(engine.calls, [], "another setting changes nothing");

  S().updateSettings({ passwordManager: "ardia" });
  assert.deepEqual(calls("applePasswords"), [[false]]);
  assert.deepEqual(new Set(calls("offerToSave").map(JSON.stringify)), new Set([JSON.stringify(["", true]), JSON.stringify([work, true])]));
  takeCalls();

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    S().createWindow({ url: "https://b.example/", profileId: work });
    assert.deepEqual(calls("offerToSave"), [[work, true]], "a profile Chrome loads after the switch gets the pref once it shows");
    takeCalls();
    mock.timers.tick(PASSWORD_PREF_RETRY_MS);
    assert.deepEqual(calls("offerToSave"), [[work, true]], "and once more after a moment, in case it was still loading");
    takeCalls();
    S().createWindow({ url: "https://c.example/", profileId: work });
    mock.timers.tick(PASSWORD_PREF_RETRY_MS);
    assert.deepEqual(calls("offerToSave"), [], "in Ardia mode a profile is turned on once, then the person's choice stands");
  } finally {
    mock.timers.reset();
  }

  S().updateSettings({ passwordManager: "none" });
  assert.deepEqual(calls("applePasswords"), [[false]]);
  assert.deepEqual(new Set(calls("offerToSave").map(JSON.stringify)), new Set([JSON.stringify(["", false]), JSON.stringify([work, false])]));
});

test("Apple's iCloud Passwords extension takes over from the key in the profiles that run it, once Ardia may start its helper", () => {
  const work = Object.keys(S().profiles).find((id) => id !== "default");
  const icloud = { id: ICLOUD_PASSWORDS_EXTENSION_ID, name: "iCloud Passwords", enabled: true };
  const other = { id: "aeblfdkhhhdcdjpifhhbdiojplfjncoa", name: "1Password", enabled: true };
  S().updateSettings({ passwordManager: "apple" });
  takeCalls();

  useExtensions.setState({ lists: { "": [other], [work]: [icloud] } });
  assert.deepEqual(calls("applePasswords"), [], "without Apple's grant the helper can't start, so the key stays everywhere");

  engine.extensionSupported = true;
  useExtensions.setState({ lists: { "": [other], [work]: [icloud, other] } });
  assert.deepEqual(calls("applePasswords"), [[true, [work]]]);
  takeCalls();

  useExtensions.setState({ lists: { "": [other], [work]: [{ ...icloud, enabled: false }, other] } });
  assert.deepEqual(calls("applePasswords"), [[true]], "turning the extension off brings the key back");
  takeCalls();

  useExtensions.setState({ lists: { "": [icloud], [work]: [icloud] } });
  S().updateSettings({ passwordManager: "ardia" });
  assert.deepEqual(calls("applePasswords"), [[true, ["", work]], [false, ["", work]]]);
  engine.extensionSupported = false;
  useExtensions.setState({ lists: {} });
});
