import assert from "node:assert/strict";
import { test } from "node:test";
const { emitAppEvent } = await import("../../test-native/shell.ts");
const { lockPasswords, originOfLogin, revealPassword, unlockPasswordsFor, usePasswordUnlocks } = await import("./savedPasswords.ts");
const { savePassword } = await import("./passwords.ts");
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

test("a CSV login whose url has no scheme saves under https", async () => {
  await savePassword("work", originOfLogin("example.com/login?next=/"), "me", "hunter2");
  await unlockPasswordsFor("work");
  assert.equal(await revealPassword("work", "https://example.com", "me"), "hunter2");
  lockPasswords();
});

test("a login's origin is its scheme, host and port, whatever follows", () => {
  assert.equal(originOfLogin("https://Example.com:8443/a/b?c#d"), "https://Example.com:8443");
  assert.equal(originOfLogin("http://example.com"), "http://example.com");
  assert.equal(originOfLogin("  mail.example.com/inbox "), "https://mail.example.com");
});
