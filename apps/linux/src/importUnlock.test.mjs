import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHostImport } from "./hostImport.ts";
import { asksPrimaryPassword, createSecretSlot, unlockCopy, unlockFailure, unlockSource, withoutEncrypted } from "./importUnlock.ts";

class ImportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const MACOS = /\bMac\b|macOS|Keychain|keychain|iCloud|Touch ID/;
const CHROME = { id: "chrome", name: "Google Chrome", family: "chromium", needsKeychain: true, keychainService: "Chrome Safe Storage", profiles: [{ id: "Default" }, { id: "Profile 1" }] };
const FIREFOX = {
  id: "firefox", name: "Firefox", family: "firefox", needsKeychain: true,
  profiles: [{ id: "locked.default", needsPrimaryPassword: true }, { id: "plain.default" }, { id: "cards.default", cardsNeedKeyring: true }],
};

function host() {
  const listeners = new Set();
  const calls = [];
  const replies = [];
  const bridge = {
    bootstrap: { windowId: "import", profileId: "default", capabilities: [] },
    call: async () => "null",
    invoke: async (method, { args }) => {
      calls.push({ method, args });
      if (method === "ArdiaImport.listBrowsers") return [CHROME, FIREFOX];
      if (method === "ArdiaImport.unlockBrowser") {
        const reply = replies.shift() ?? { type: "unlocked" };
        setTimeout(() => { for (const listener of [...listeners]) listener("ArdiaImport", "onImportEvent", { jobId: args[0], ...reply }); }, 0);
      }
      return true;
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { api: createHostImport(bridge, ImportError), calls, replies };
}

test("the Linux unlock step names the system keyring, never the Mac or its keychain", () => {
  const one = unlockCopy(CHROME, ["Default"], ["passwords"]);
  const many = unlockCopy(CHROME, ["Default", "Profile 1"], ["passwords"]);
  for (const copy of [one, many, unlockCopy(FIREFOX, ["locked.default"], ["passwords"]), unlockCopy(FIREFOX, ["cards.default"], ["autofill"])]) {
    for (const text of [copy.title, copy.subtitle, copy.lead, copy.detail, copy.waiting]) assert.doesNotMatch(text, MACOS);
  }
  assert.match(one.detail, /Secret Service or KWallet/);
  assert.match(one.detail, /“Chrome Safe Storage”/);
  assert.match(many.lead, /once for each selected profile/);
  assert.equal(one.field, false);
  for (const code of ["locked", "denied", "notFound", "unavailable", "timeout", "cancelled", "unreadable", undefined]) {
    for (const source of [CHROME, FIREFOX]) assert.doesNotMatch(unlockFailure(source, code), MACOS);
  }
  assert.match(unlockFailure(CHROME, "locked"), /system keyring is locked/);
  assert.match(unlockFailure(CHROME, "denied"), /didn't allow access to Chrome Safe Storage/);
  assert.match(unlockFailure(CHROME, "notFound"), /has no Chrome Safe Storage key/);
  assert.match(unlockFailure(CHROME, "unavailable"), /Secret Service or KWallet/);
  assert.match(unlockFailure(FIREFOX, "denied"), /isn't Firefox's primary password/);
});

test("a Firefox primary password is asked for only when a selected profile has one", () => {
  assert.equal(asksPrimaryPassword(FIREFOX, ["locked.default"]), true);
  assert.equal(asksPrimaryPassword(FIREFOX, ["plain.default"]), false);
  assert.equal(asksPrimaryPassword(FIREFOX, ["plain.default", "cards.default"]), false);
  assert.equal(asksPrimaryPassword(CHROME, ["Default"]), false);
  assert.equal(unlockCopy(FIREFOX, ["locked.default"], ["passwords"]).field, true);
  assert.match(unlockCopy(FIREFOX, ["locked.default"], ["passwords"]).lead, /primary password/);
  assert.match(unlockCopy(FIREFOX, ["cards.default"], ["autofill"]).detail, /“Firefox Encrypted Storage”/);
  assert.doesNotMatch(unlockCopy(FIREFOX, ["cards.default"], ["passwords", "cookies"]).detail, /Firefox Encrypted Storage/);
  assert.doesNotMatch(unlockCopy(FIREFOX, ["locked.default"], ["autofill"]).detail, /Firefox Encrypted Storage/);
  assert.equal(unlockCopy(FIREFOX, ["cards.default"], ["passwords"]).field, false);
});

test("the typed primary password reaches the native unlock once, through the typed invoke, and is not kept", async () => {
  const { api, calls, replies } = host();
  await api.listBrowsers();
  const slot = createSecretSlot();
  let notified = 0;
  slot.subscribe(() => ++notified);
  slot.set("primary pw");
  assert.equal(await unlockSource(api, FIREFOX, ["locked.default"], ["passwords", "autofill"], slot), null);
  const unlock = calls.find((call) => call.method === "ArdiaImport.unlockBrowser");
  assert.deepEqual(unlock.args.slice(1), ["firefox", "primary pw", ["locked.default"], ["passwords", "autofill"]]);
  assert.equal(slot.get(), "");
  assert.ok(notified >= 2);
  assert.equal(api.isBrowserUnlocked("firefox"), true);

  replies.push({ type: "failed", code: "denied", message: "wrong" });
  slot.set("wrong guess");
  assert.match(await unlockSource(api, FIREFOX, ["locked.default"], ["passwords"], slot), /isn't Firefox's primary password/);
  assert.equal(slot.get(), "");
  assert.deepEqual(calls.filter((call) => call.method === "ArdiaImport.unlockBrowser").at(-1).args.slice(1), ["firefox", "wrong guess", ["locked.default"], ["passwords"]]);

  slot.set("typed but not needed");
  assert.equal(await unlockSource(api, FIREFOX, ["cards.default"], ["autofill"], slot), null);
  assert.deepEqual(calls.filter((call) => call.method === "ArdiaImport.unlockBrowser").at(-1).args.slice(1), ["firefox", null, ["cards.default"], ["autofill"]]);
  assert.equal(slot.get(), "");

  replies.push({ type: "failed", code: "locked", message: "locked" });
  assert.match(await unlockSource(api, CHROME, ["Default"], ["passwords"], slot), /system keyring is locked/);
  assert.deepEqual(calls.filter((call) => call.method === "ArdiaImport.unlockBrowser").at(-1).args.slice(1), ["chrome", null]);
});

test("skipping encrypted data keeps what the source stores unencrypted", () => {
  const kinds = new Set(["bookmarks", "passwords", "cookies", "autofill"]);
  assert.deepEqual([...withoutEncrypted(CHROME, kinds)].sort(), ["autofill", "bookmarks"]);
  assert.deepEqual([...withoutEncrypted(FIREFOX, kinds)].sort(), ["autofill", "bookmarks", "cookies"]);
});

test("the Linux build swaps in the Linux unlock step, which never logs the typed password", () => {
  const config = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8");
  assert.match(config, /\[here\("\.\.\/browser\/src\/components\/import\/steps\/UnlockStep\.tsx"\), here\("\.\/src\/LinuxUnlockStep\.tsx"\)\]/);
  for (const file of ["LinuxUnlockStep.tsx", "importUnlock.ts"]) {
    const source = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
    assert.doesNotMatch(source, /console\.|reportHostError|telemetry|localStorage|sessionStorage/, file);
  }
  const step = readFileSync(fileURLToPath(new URL("./LinuxUnlockStep.tsx", import.meta.url)), "utf8");
  assert.match(step, /secure\b/);
  assert.match(step, /useEffect\(\(\) => \(\) => primaryPassword\.clear\(\), \[\]\)/);
  assert.doesNotMatch(step, MACOS);
});
