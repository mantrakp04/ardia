import assert from "node:assert/strict";
import { test } from "node:test";
import { hasMatchRow, menuKey, menuRows, MAX_CODE_ROWS } from "./menuModel.ts";

const provider = (id, state = "unlocked") => ({ id, name: id, state, capabilities: { totp: true, save: true, selfHosted: false, masterPassword: false, touchID: false }, install: { command: "", url: "" } });
const item = (id, urls, extra = {}) => ({ provider: "bitwarden", id, title: id, username: "me", urls, hasTotp: false, ...extra });
const base = { field: "password", mode: "matches", origin: "https://example.com", query: "", providers: [provider("bitwarden")], items: [], pending: null, noTotp: new Set() };
const kinds = (rows) => rows.map((r) => (r.kind === "login" || r.kind === "otp" ? `${r.kind}:${r.item.id}` : r.kind === "unlock" ? `unlock:${r.provider}` : r.kind));

test("no matches leaves only the footer, which never counts as a match", () => {
  const rows = menuRows(base);
  assert.deepEqual(kinds(rows), ["allPasswords", "settings"]);
  assert.equal(hasMatchRow(rows), false);
});

test("items of a locked manager never show, its unlock row does", () => {
  const rows = menuRows({ ...base, providers: [provider("bitwarden", "locked")], items: [item("a", ["example.com"])] });
  assert.deepEqual(kinds(rows), ["unlock:bitwarden", "allPasswords", "settings"]);
  assert.equal(hasMatchRow(rows), true);
});

test("signed out and missing managers add nothing", () => {
  const rows = menuRows({ ...base, providers: [provider("bitwarden", "signedOut"), provider("protonpass", "notInstalled")] });
  assert.equal(hasMatchRow(rows), false);
});

test("login fields list matches best first; a sibling is marked as the person's own choice", () => {
  const rows = menuRows({ ...base, origin: "https://app.example.com", items: [item("sib", ["login.example.com"]), item("own", ["app.example.com"])] });
  assert.deepEqual(kinds(rows), ["login:own", "login:sib", "allPasswords", "settings"]);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.userChose), [false, true]);
});

test("new password fields offer a strong password first, only with a manager unlocked", () => {
  assert.equal(menuRows({ ...base, field: "newPassword" })[0].kind, "generate");
  assert.notEqual(menuRows({ ...base, field: "newPassword", providers: [provider("bitwarden", "locked")] })[0].kind, "generate");
});

test("one-time code fields put the pending item first and skip items without codes", () => {
  const items = [item("a", ["example.com"], { hasTotp: true }), item("none", ["example.com"]), item("unknown", ["example.com"], { hasTotp: undefined }), item("p", ["other.test"], { hasTotp: true })];
  const pending = { origin: "https://example.com", provider: "bitwarden", id: "p", at: 0 };
  const rows = menuRows({ ...base, field: "otp", items, pending });
  assert.deepEqual(kinds(rows), ["otp:p", "otp:a", "otp:unknown", "allPasswords", "settings"]);
  assert.equal(rows[0].pending, true);
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
