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

const ALL = { logins: true, codes: true, usernames: true, newPasswords: true, generated: true };

test("Autofill is offered with or without a connected manager; Generate Password follows New Passwords, any field only when asked", () => {
  assert.deepEqual(contextMenuOptions(ALL, false).autofill, true);
  assert.deepEqual(
    contextMenuOptions(ALL, false).generate.map((g) => g.style),
    ["strong", "alphanumeric", "easyToType", "passphrase"],
  );
  assert.ok(contextMenuOptions(ALL, false).generate.every((g) => g.title.length > 0));
  assert.equal(contextMenuOptions(ALL, false).generateAnyField, false);
  assert.equal(contextMenuOptions(ALL, true).generateAnyField, true);
  assert.deepEqual(contextMenuOptions({ ...ALL, newPasswords: false }, true), { autofill: true, generate: [], generateAnyField: false });
  assert.equal(contextMenuOptions({ ...ALL, logins: false }, false).autofill, true, "codes alone keep Autofill");
  assert.equal(contextMenuOptions({ ...ALL, logins: false, codes: false }, false).autofill, false);
});

test("with no manager connected the Autofill submenu says No Saved Logins, so the item is still there", () => {
  assert.deepEqual(contextMenuModel({ ...base, providers: [] }), { logins: [], unlock: false, other: false, note: CONTEXT_NOTES.noManager });
  const signedOut = contextMenuModel({ ...base, providers: [provider("bitwarden", "signedOut"), provider("protonpass", "notInstalled")] });
  assert.equal(signedOut.note, CONTEXT_NOTES.noManager);
});

test("Saved Logins off leaves only the logins with a code, offering just Verification Code", () => {
  const items = [item("gh", ["github.com"], { hasTotp: true }), item("plain", ["github.com"], { username: "other" })];
  const menu = contextMenuModel({ ...base, items, suggest: { ...ALL, logins: false } });
  assert.deepEqual(menu.logins, [{ key: "bitwarden/gh", title: "octo · github.com", fields: ["otp"] }]);
});

test("Verification Codes off drops the code choice and keeps username and password", () => {
  const menu = contextMenuModel({ ...base, items: [item("gh", ["github.com"], { hasTotp: true })], suggest: { ...ALL, codes: false } });
  assert.deepEqual(menu.logins[0].fields, ["username", "password"]);
});
