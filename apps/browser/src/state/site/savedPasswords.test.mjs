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
const passwords = await import("../../platform/passwords.ts");
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

test("saving a login again with the same password leaves the stored record alone", async (t) => {
  const now = t.mock.method(Date, "now", () => 1000);
  assert.equal(await passwords.savePassword("work", "https://stamp.example", "me", "same"), true);
  now.mock.mockImplementation(() => 2000);
  assert.equal(await passwords.savePassword("work", "https://stamp.example", "me", "same"), true);
  const [stored] = (await stub.readLogins()).filter((l) => l.url === "https://stamp.example");
  assert.equal(stored.created, 1000);
});

test("a login is edited through the origin the list reports for it", async () => {
  await importing([login("https://listed.example/login", "me", "old")]);
  const listed = (await passwords.listPasswords("work")).find((p) => p.username === "me" && p.origin.includes("listed.example"));
  assert.ok(listed);
  assert.equal(await passwords.updatePassword("work", listed.origin, "me", { password: "new" }), true);
  assert.equal(await revealed(listed.origin, "me"), "new");
});

test("a CSV login with another password than the saved one is skipped and the saved one stays", async (t) => {
  t.mock.method(console, "warn", () => {});
  await importing([login("https://changed.example", "me", "first")]);
  assert.deepEqual(await importing([login("https://changed.example", "me", "second")]), { saved: 0, skipped: 1 });
  assert.equal(await revealed("https://changed.example", "me"), "first");
});

test("a CSV login with capitals in the host or the default port saves under the origin the store keeps", async (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (message) => warnings.push(message));
  const rows = [login("Caps.Example/login", "me", "caps"), login("https://port.example:443/x", "me", "port"), login("HTTP://Plain.Example:80", "me", "plain")];
  const first = await importing(rows);
  assert.deepEqual(warnings, []);
  assert.deepEqual(first, { saved: 3, skipped: 0 });
  assert.deepEqual(await importing(rows), { saved: 3, skipped: 0 });
  assert.deepEqual(warnings, []);
  assert.equal(await revealed("https://caps.example", "me"), "caps");
  assert.equal(await revealed("https://port.example", "me"), "port");
  assert.equal(await revealed("http://plain.example", "me"), "plain");
});

test("a login's origin is its scheme, host and port, whatever follows, left for Chrome to canonicalise", () => {
  assert.equal(originOfLogin("https://Example.com:8443/a/b?c#d"), "https://Example.com:8443");
  assert.equal(originOfLogin("https://example.com/a path/b"), "https://example.com");
  assert.equal(originOfLogin("http://example.com"), "http://example.com");
  assert.equal(originOfLogin("  mail.example.com/inbox "), "https://mail.example.com");
  assert.equal(originOfLogin("//example.com/login"), "https://example.com");
  assert.equal(originOfLogin("localhost:3000/login"), "https://localhost:3000");
  assert.equal(originOfLogin("https://straße.de/login"), "https://straße.de");
  assert.equal(originOfLogin("https://[2001:DB8::1]/login"), "https://[2001:DB8::1]");
});

test("a CSV login on an international or IPv6 host is saved", async () => {
  const rows = [login("https://straße.de/login", "me", "idn"), login("https://[2001:DB8::1]/login", "me", "ip")];
  assert.deepEqual(await importing(rows), { saved: 2, skipped: 0 });
  assert.equal(await revealed(new URL("https://straße.de").origin, "me"), "idn");
  assert.equal(await revealed("https://[2001:db8::1]", "me"), "ip");
});

test("a login url with no host has no origin", () => {
  for (const url of ["", "   ", "/login", "?next=1", "#top", "https://", "https:///x"]) assert.equal(originOfLogin(url), "", JSON.stringify(url));
});
