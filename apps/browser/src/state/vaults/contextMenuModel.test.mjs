import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTEXT_NOTES, contextMenuModel, contextMenuOptions, fillFieldOf, MAX_CONTEXT_LOGINS, menuFieldOf, pickedFillFields } from "./contextMenuModel.ts";

const provider = (id, state = "unlocked", name = id) => ({ id, name, state, capabilities: { totp: true, save: true, selfHosted: false, masterPassword: false, touchID: false }, install: { command: "", url: "" } });
const item = (id, urls, extra = {}) => ({ provider: "bitwarden", id, title: id, username: "octo", urls, hasTotp: false, ...extra });
const base = { origin: "https://github.com", providers: [provider("bitwarden")], items: [], remembered: null };

test("each matching login is a submenu named for its account and site, with the code only when it has one", () => {
  const menu = contextMenuModel({
    ...base,
    items: [item("gh", ["https://github.com/login"], { hasTotp: true }), item("gist", ["gist.github.com"], { username: "", title: "Gist" }), item("other", ["example.com"])],
  });
  assert.deepEqual(menu.logins, [
    { key: "bitwarden/gh", title: "octo · github.com", fields: ["username", "password", "otp"] },
    { key: "bitwarden/gist", title: "Gist · gist.github.com", fields: ["password"] },
  ]);
  assert.equal(menu.other, true);
  assert.equal(menu.unlock, false);
  assert.equal(menu.note, null);
});

test("an unknown code flag, as 1Password reports, offers no Verification Code", () => {
  const menu = contextMenuModel({ ...base, items: [item("gh", ["github.com"], { hasTotp: undefined })] });
  assert.deepEqual(menu.logins[0].fields, ["username", "password"]);
});

test("the list keeps the fill menu's order: exact site first, the remembered account ahead of its tier", () => {
  const items = [item("sub", ["api.github.com"]), item("a", ["github.com"], { username: "a" }), item("b", ["github.com"], { username: "b" })];
  assert.deepEqual(
    contextMenuModel({ ...base, items }).logins.map((l) => l.key),
    ["bitwarden/a", "bitwarden/b", "bitwarden/sub"],
  );
  assert.deepEqual(
    contextMenuModel({ ...base, items, remembered: "bitwarden/b" }).logins.map((l) => l.key),
    ["bitwarden/b", "bitwarden/a", "bitwarden/sub"],
  );
});

test("the list is capped and the same account in two managers names each manager", () => {
  const many = Array.from({ length: MAX_CONTEXT_LOGINS + 3 }, (_, i) => item(`i${i}`, ["github.com"], { username: `user${i}` }));
  assert.equal(contextMenuModel({ ...base, items: many }).logins.length, MAX_CONTEXT_LOGINS);
  const twins = contextMenuModel({
    ...base,
    providers: [provider("bitwarden", "unlocked", "Bitwarden"), provider("onepassword", "unlocked", "1Password")],
    items: [item("x", ["github.com"]), item("y", ["github.com"], { provider: "onepassword" })],
  });
  assert.deepEqual(
    twins.logins.map((l) => l.title).sort(),
    ["octo · github.com (1Password)", "octo · github.com (Bitwarden)"],
  );
});

test("locked managers hide their logins and offer Unlock Passwords; nothing unlocked offers no Other Passwords", () => {
  const menu = contextMenuModel({ ...base, providers: [provider("bitwarden", "locked")], items: [item("gh", ["github.com"])] });
  assert.deepEqual(menu, { logins: [], unlock: true, other: false, note: null });
  const mixed = contextMenuModel({ ...base, providers: [provider("bitwarden", "locked"), provider("protonpass")], items: [item("gh", ["github.com"])] });
  assert.deepEqual(mixed, { logins: [], unlock: true, other: true, note: CONTEXT_NOTES.noLogins });
});

test("an insecure page lists nothing and says so", () => {
  const menu = contextMenuModel({ ...base, origin: "http://github.com", items: [item("gh", ["github.com"])] });
  assert.deepEqual(menu, { logins: [], unlock: false, other: false, note: CONTEXT_NOTES.insecure });
  assert.equal(contextMenuModel({ ...base, origin: "http://localhost:3000", items: [item("dev", ["http://localhost:3000"])] }).logins.length, 1);
});

test("a pick from the list fills the classified field's whole login, or only the guessed value into a plain input", () => {
  assert.deepEqual(pickedFillFields({ kind: "username", guess: "username" }), ["username", "password"]);
  assert.deepEqual(pickedFillFields({ kind: "password", guess: "password" }), ["username", "password"]);
  assert.deepEqual(pickedFillFields({ kind: "otp", guess: "otp" }), ["totp"]);
  assert.deepEqual(pickedFillFields({ kind: null, guess: "username" }), ["username"]);
  assert.deepEqual(pickedFillFields({ kind: null, guess: "password" }), ["password"]);
  assert.deepEqual(pickedFillFields({ kind: "newPassword", guess: "password" }), ["password"]);
  assert.equal(menuFieldOf({ kind: "newPassword", guess: "password" }), "password");
  assert.equal(menuFieldOf({ kind: null, guess: "otp" }), "otp");
  assert.equal(fillFieldOf("otp"), "totp");
  assert.equal(fillFieldOf("username"), "username");
});

test("Autofill shows once a manager is connected; Generate Password needs the setting too, with the fill menu's four styles", () => {
  assert.deepEqual(contextMenuOptions(false, true), { autofill: false, generate: [] });
  assert.deepEqual(contextMenuOptions(true, false), { autofill: true, generate: [] });
  assert.deepEqual(
    contextMenuOptions(true, true).generate.map((g) => g.style),
    ["strong", "alphanumeric", "easyToType", "passphrase"],
  );
  assert.ok(contextMenuOptions(true, true).generate.every((g) => g.title.length > 0));
});
