import assert from "node:assert/strict";
import { test } from "node:test";
import { hasFillRow, hasMatchRow, menuKey, menuRows, MAX_CODE_ROWS, restingRow } from "./menuModel.ts";

const provider = (id, state = "unlocked") => ({ id, name: id, state, capabilities: { totp: true, save: true, selfHosted: false, masterPassword: false, touchID: false }, install: { command: "", url: "" } });
const item = (id, urls, extra = {}) => ({ provider: "bitwarden", id, title: id, username: "me", urls, hasTotp: false, ...extra });
const base = { field: "password", mode: "matches", origin: "https://example.com", query: "", providers: [provider("bitwarden")], items: [], pending: null, noTotp: new Set() };
const kinds = (rows) => rows.map((r) => (r.kind === "login" || r.kind === "otp" ? `${r.kind}:${r.item.id}` : r.kind === "unlock" ? `unlock:${r.provider}` : r.kind));

const GENERATORS = ["generate", "generate", "generate", "generate"];

test("no matches leaves Suggest New Password and the footer, which never count as a match, even opened", () => {
  assert.deepEqual(kinds(menuRows(base)), ["suggest", "allPasswords", "settings"]);
  assert.equal(hasMatchRow(menuRows(base)), false);
  const rows = menuRows({ ...base, suggestOpen: true });
  assert.deepEqual(kinds(rows), [...GENERATORS, "allPasswords", "settings"]);
  assert.equal(hasMatchRow(rows), false);
  assert.equal(hasFillRow(rows), false);
  assert.equal(restingRow(rows), -1, "nothing is ready for Return or Touch ID");
});

test("items of a locked manager never show, its unlock row does", () => {
  const rows = menuRows({ ...base, providers: [provider("bitwarden", "locked")], items: [item("a", ["example.com"])] });
  assert.deepEqual(kinds(rows), ["unlock:bitwarden", "allPasswords"]);
  assert.equal(hasMatchRow(rows), true);
});

test("signed out and missing managers add nothing", () => {
  const rows = menuRows({ ...base, providers: [provider("bitwarden", "signedOut"), provider("protonpass", "notInstalled")] });
  assert.equal(hasMatchRow(rows), false);
});

test("login fields list matches best first; a sibling is marked as the person's own choice", () => {
  const rows = menuRows({ ...base, origin: "https://app.example.com", items: [item("sib", ["login.example.com"]), item("own", ["app.example.com"])] });
  assert.deepEqual(kinds(rows), ["login:own", "login:sib", "suggest", "allPasswords"]);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.userChose), [false, true]);
});

test("new password fields offer the four generators, then Open Passwords, and no saved logins", () => {
  const rows = menuRows({ ...base, field: "newPassword", items: [item("a", ["example.com"])] });
  assert.deepEqual(rows.map((r) => r.key), ["generate:strong", "generate:alphanumeric", "generate:easyToType", "generate:passphrase", "openPasswords"]);
  assert.deepEqual(rows.slice(0, 4).map((r) => r.style), ["strong", "alphanumeric", "easyToType", "passphrase"]);
  assert.equal(restingRow(rows), 0, "New Strong Password is ready for Return");
});

test("new password fields keep unlock rows between the generators and the footer", () => {
  const providers = [provider("bitwarden"), provider("protonpass", "locked")];
  assert.deepEqual(kinds(menuRows({ ...base, field: "newPassword", providers })).slice(-2), ["unlock:protonpass", "openPasswords"]);
  const locked = menuRows({ ...base, field: "newPassword", providers: [provider("bitwarden", "locked")] });
  assert.deepEqual(kinds(locked), ["unlock:bitwarden", "openPasswords"], "nothing to generate into until a manager unlocks");
});

test("any password field suggests a new password after logins and unlock rows, opening into the four generators", () => {
  for (const field of ["username", "otp"]) {
    const rows = kinds(menuRows({ ...base, field, suggestOpen: true }));
    assert.ok(!rows.includes("generate") && !rows.includes("suggest"), field);
  }
  assert.ok(!kinds(menuRows({ ...base, providers: [provider("bitwarden", "locked")] })).includes("suggest"));
  const providers = [provider("bitwarden"), provider("protonpass", "locked")];
  assert.deepEqual(kinds(menuRows({ ...base, providers, items: [item("a", ["example.com"])] })), ["login:a", "unlock:protonpass", "suggest", "allPasswords"]);
  const rows = menuRows({ ...base, providers, items: [item("a", ["example.com"])], suggestOpen: true });
  assert.deepEqual(kinds(rows), ["login:a", "unlock:protonpass", ...GENERATORS, "allPasswords"]);
  assert.deepEqual(rows.slice(2, 6).map((r) => [r.style, r.spare]), [["strong", true], ["alphanumeric", true], ["easyToType", true], ["passphrase", true]]);
  assert.equal(restingRow(rows), 0, "the login stays the resting row");
});

test("the remembered login is first among equals and the resting row", () => {
  const items = [item("a", ["example.com"], { favorite: true }), item("b", ["example.com"])];
  const rows = menuRows({ ...base, items, remembered: "bitwarden/b" });
  assert.deepEqual(kinds(rows).slice(0, 2), ["login:b", "login:a"]);
  assert.equal(restingRow(rows, "bitwarden/b"), 0);
  const sibling = menuRows({ ...base, items: [item("own", ["example.com"]), item("sib", ["login.example.com"])], remembered: "bitwarden/sib" });
  assert.deepEqual(kinds(sibling).slice(0, 2), ["login:own", "login:sib"]);
  assert.equal(restingRow(sibling, "bitwarden/sib"), 1, "still the one selected, below the better match");
  assert.equal(restingRow(sibling, "bitwarden/gone"), 0);
});

test("only login, code and generator rows count as something to fill", () => {
  assert.equal(hasFillRow(menuRows({ ...base, providers: [provider("bitwarden", "locked")] })), false);
  assert.equal(hasFillRow(menuRows({ ...base, field: "newPassword" })), true);
  assert.equal(hasFillRow(menuRows({ ...base, items: [item("a", ["example.com"])] })), true);
});

test("one-time code fields put the pending item first and skip items without codes", () => {
  const items = [item("a", ["example.com"], { hasTotp: true }), item("none", ["example.com"]), item("unknown", ["example.com"], { hasTotp: undefined }), item("p", ["other.test"], { hasTotp: true })];
  const pending = { origin: "https://example.com", provider: "bitwarden", id: "p", at: 0 };
  const rows = menuRows({ ...base, field: "otp", items, pending });
  assert.deepEqual(kinds(rows), ["otp:p", "otp:a", "otp:unknown", "allPasswords"]);
  assert.equal(rows[0].pending, true);
  assert.deepEqual(rows.slice(0, 3).map((r) => r.userChose), [true, false, false], "the login just filled fills its code wherever the code step lives");
  const failed = menuRows({ ...base, field: "otp", items, pending, noTotp: new Set(["bitwarden/unknown"]) });
  assert.ok(!kinds(failed).includes("otp:unknown"));
});

test("code rows are capped", () => {
  const items = Array.from({ length: 10 }, (_, i) => item(`i${i}`, ["example.com"], { hasTotp: true }));
  assert.equal(menuRows({ ...base, field: "otp", items }).filter((r) => r.kind === "otp").length, MAX_CODE_ROWS);
});

test("search covers every unlocked item, with no footer, and marks items saved for other sites", () => {
  const items = [item("GitHub", ["github.com"]), item("Example", ["example.com"])];
  const rows = menuRows({ ...base, mode: "search", query: "", items });
  assert.deepEqual(kinds(rows), ["login:Example", "login:GitHub"]);
  assert.deepEqual(rows.map((r) => r.userChose), [false, true]);
  assert.deepEqual(kinds(menuRows({ ...base, mode: "search", query: "git", items })), ["login:GitHub"]);
});

test("arrows move and wrap, starting from nothing selected", () => {
  assert.deepEqual(menuKey(-1, 3, "ArrowDown"), { selected: 0, action: "move" });
  assert.deepEqual(menuKey(2, 3, "ArrowDown"), { selected: 0, action: "move" });
  assert.deepEqual(menuKey(-1, 3, "ArrowUp"), { selected: 2, action: "move" });
  assert.deepEqual(menuKey(0, 3, "ArrowUp"), { selected: 2, action: "move" });
  assert.deepEqual(menuKey(1, 3, "ArrowUp"), { selected: 0, action: "move" });
  assert.deepEqual(menuKey(7, 3, "ArrowDown"), { selected: 0, action: "move" });
});

test("an empty menu ignores arrows", () => {
  assert.deepEqual(menuKey(-1, 0, "ArrowDown"), { selected: -1, action: "none" });
  assert.deepEqual(menuKey(-1, 0, "ArrowUp"), { selected: -1, action: "none" });
});

test("enter picks the selected row, or closes when nothing is selected so the next enter reaches the page", () => {
  assert.deepEqual(menuKey(1, 3, "Enter"), { selected: 1, action: "activate" });
  assert.deepEqual(menuKey(-1, 3, "Enter"), { selected: -1, action: "close" });
  assert.deepEqual(menuKey(5, 3, "Enter"), { selected: -1, action: "close" });
});

test("escape and tab close, other keys change nothing", () => {
  assert.equal(menuKey(1, 3, "Escape").action, "close");
  assert.equal(menuKey(1, 3, "Tab").action, "close");
  assert.deepEqual(menuKey(1, 3, "KeyA"), { selected: 1, action: "none" });
});

test("a pending code from a sibling subdomain is the person's choice, so native skips the URL match", () => {
  const items = [item("acct", ["https://accounts.example.com"], { hasTotp: true })];
  const pending = { origin: "https://accounts.example.com", provider: "bitwarden", id: "acct", at: 0 };
  const rows = menuRows({ ...base, origin: "https://verify.example.com", field: "otp", items, pending });
  assert.deepEqual(kinds(rows), ["otp:acct", "allPasswords"]);
  assert.equal(rows[0].userChose, true);
});

test("username fields add usernames used before after the matching logins, emails first on an email field", () => {
  const items = [
    item("site", ["example.com"], { username: "me@example.com" }),
    item("x", ["x.test"], { username: "Me@Example.com" }),
    item("y", ["y.test"], { username: "handle", updatedAt: 9 }),
    item("z", ["z.test"], { username: "handle", updatedAt: 3 }),
    item("w", ["w.test"], { username: "work@corp.test", updatedAt: 5 }),
  ];
  const rows = menuRows({ ...base, field: "username", items });
  assert.deepEqual(kinds(rows), ["login:site", "username", "username", "allPasswords"]);
  assert.deepEqual(rows.slice(1, 3).map((r) => [r.username, r.item.id]), [["handle", "y"], ["work@corp.test", "w"]], "the login's own username isn't repeated");
  const email = menuRows({ ...base, field: "username", items, email: true });
  assert.deepEqual(email.slice(1, 3).map((r) => r.username), ["work@corp.test", "handle"]);
  const signUp = menuRows({ ...base, field: "username", origin: "https://new.test", items });
  assert.deepEqual(kinds(signUp).slice(0, 3), ["username", "username", "username"]);
  assert.equal(hasMatchRow(signUp), true, "a sign-up form gets the menu");
  assert.equal(restingRow(signUp), 0);
  assert.ok(!kinds(menuRows({ ...base, items })).includes("username"), "password fields don't list usernames");
});
