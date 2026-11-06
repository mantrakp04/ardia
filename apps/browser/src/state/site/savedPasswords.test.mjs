import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
globalThis.require = createRequire(import.meta.url);
let csv = [];
globalThis.acTestNativeModules = {
  ArdiaImport: {
    chooseImportFile: async () => "/scratch/passwords.csv",
    importPasswordsCSV: async () => JSON.stringify(csv),
  },
};
const { emitAppEvent } = await import("../../test-native/shell.ts");
const { importPasswordsCsv, lockPasswords, originOfLogin, revealPassword, unlockPasswordsFor, usePasswordUnlocks } = await import("./savedPasswords.ts");
const stub = await import("../../test-native/index.ts");
stub.passwordStores.set(stub.current.device, new Map());

const unlocked = (profile) => !!usePasswordUnlocks.getState().unlocked[profile];

test("unlocked passwords lock again when the Mac locks or sleeps", async () => {
  assert.equal(await unlockPasswordsFor("work"), true);
  assert.equal(await unlockPasswordsFor(""), true);
  assert.ok(unlocked("work") && unlocked(""));
  emitAppEvent({ type: "screenLocked" });
  assert.ok(unlocked("work"), "a quiet screen lock alone isn't the signal; lockedOrAsleep is");
  emitAppEvent({ type: "lockedOrAsleep" });
  assert.ok(!unlocked("work") && !unlocked(""));
  lockPasswords();
});

test("an unlock lasts five minutes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await unlockPasswordsFor("work");
  t.mock.timers.tick(5 * 60_000 - 1);
  assert.ok(unlocked("work"));
  t.mock.timers.tick(1);
  assert.ok(!unlocked("work"));
});

test("a lock that lands while authentication is pending wins", async () => {
  const pending = unlockPasswordsFor("work");
  emitAppEvent({ type: "lockedOrAsleep" });
  assert.equal(await pending, false);
  assert.ok(!unlocked("work"));
});

test("a password revealed across a lock comes back empty", async () => {
  await unlockPasswordsFor("work");
  const pending = revealPassword("work", "https://example.com", "me");
  lockPasswords();
  assert.equal(await pending, null);
  assert.equal(await revealPassword("work", "https://example.com", "me"), null);
});

const login = (url, username, password) => ({ url, username, password });

const importing = (rows) => {
  csv = rows;
  return importPasswordsCsv("work");
};

const revealed = async (origin, username) => {
  await unlockPasswordsFor("work");
  const password = await revealPassword("work", origin, username);
  lockPasswords();
  return password;
};

test("a CSV login whose url has no scheme saves under https", async () => {
  assert.deepEqual(await importing([login("example.com/login?next=/", "me", "hunter2")]), { saved: 1, skipped: 0 });
  assert.equal(await revealed("https://example.com", "me"), "hunter2");
});

test("a CSV login whose url is protocol-relative saves under https", async () => {
  assert.deepEqual(await importing([login("//proto.example.com/login", "me", "hunter3")]), { saved: 1, skipped: 0 });
  assert.equal(await revealed("https://proto.example.com", "me"), "hunter3");
});

test("a CSV login with no host or no password is skipped before it reaches the engine", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const before = (await stub.readLogins()).length;
  const rows = [login("/login", "me", "pw"), login("?next=1", "me", "pw"), login("https://", "me", "pw"), login("", "me", "pw"), login("example.org", "me", "")];
  assert.deepEqual(await importing(rows), { saved: 0, skipped: 5 });
  assert.equal(warn.mock.callCount(), 0);
  assert.equal((await stub.readLogins()).length, before);
});

test("importing the same CSV login twice counts it as saved both times", async () => {
  const rows = [login("https://again.example", "me", "same")];
  assert.deepEqual(await importing(rows), { saved: 1, skipped: 0 });
  assert.deepEqual(await importing(rows), { saved: 1, skipped: 0 });
  assert.equal(await revealed("https://again.example", "me"), "same");
});

test("a CSV login with another password than the saved one is skipped and the saved one stays", async (t) => {
  t.mock.method(console, "warn", () => {});
  await importing([login("https://changed.example", "me", "first")]);
  assert.deepEqual(await importing([login("https://changed.example", "me", "second")]), { saved: 0, skipped: 1 });
  assert.equal(await revealed("https://changed.example", "me"), "first");
});

test("a login's origin is its scheme, host and port, whatever follows", () => {
  assert.equal(originOfLogin("https://Example.com:8443/a/b?c#d"), "https://Example.com:8443");
  assert.equal(originOfLogin("http://example.com"), "http://example.com");
  assert.equal(originOfLogin("  mail.example.com/inbox "), "https://mail.example.com");
  assert.equal(originOfLogin("//example.com/login"), "https://example.com");
  assert.equal(originOfLogin("localhost:3000/login"), "https://localhost:3000");
});

test("a login url with no host has no origin", () => {
  for (const url of ["", "   ", "/login", "?next=1", "#top", "https://", "https:///x"]) assert.equal(originOfLogin(url), "", JSON.stringify(url));
});
