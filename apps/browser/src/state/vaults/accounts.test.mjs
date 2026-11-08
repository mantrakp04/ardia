import assert from "node:assert/strict";
import { test } from "node:test";
const native = await import("../../test-native/index.ts");
const accounts = await import("./accounts.ts");

const fresh = () => {
  native.docs.delete(accounts.VAULT_ACCOUNTS_DOC);
  accounts.reloadVaultAccounts();
};

test("a remembered login survives a relaunch and covers the whole site", () => {
  fresh();
  accounts.rememberVaultAccount("https://accounts.google.com", { provider: "bitwarden", id: "me" });
  accounts.reloadVaultAccounts();
  assert.equal(accounts.rememberedVaultAccount("https://mail.google.com"), "bitwarden/me");
  assert.equal(accounts.rememberedVaultAccount("https://google.co.uk"), null);
  assert.equal(accounts.rememberedVaultAccount("https://alice.github.io"), null);
});

test("the last login used wins, and shared hosting keeps tenants apart", () => {
  fresh();
  accounts.rememberVaultAccount("https://alice.github.io", { provider: "bitwarden", id: "alice" });
  accounts.rememberVaultAccount("https://bob.github.io", { provider: "bitwarden", id: "bob" });
  accounts.rememberVaultAccount("https://alice.github.io", { provider: "1password", id: "alice2" });
  assert.equal(accounts.rememberedVaultAccount("https://alice.github.io"), "1password/alice2");
  assert.equal(accounts.rememberedVaultAccount("https://bob.github.io"), "bitwarden/bob");
});

test("the store keeps the most recently used sites up to its cap", () => {
  fresh();
  const cap = accounts.MAX_REMEMBERED_ACCOUNTS;
  for (let i = 0; i <= cap; i++) accounts.rememberVaultAccount(`https://site${i}.example`, { provider: "bitwarden", id: `i${i}` }, i);
  accounts.rememberVaultAccount("https://site1.example", { provider: "bitwarden", id: "again" }, cap + 1);
  accounts.rememberVaultAccount("https://extra.example", { provider: "bitwarden", id: "extra" }, cap + 2);
  const saved = JSON.parse(native.docs.get(accounts.VAULT_ACCOUNTS_DOC));
  assert.equal(Object.keys(saved.sites).length, cap);
  accounts.reloadVaultAccounts();
  assert.equal(accounts.rememberedVaultAccount("https://site0.example"), null, "the oldest went first");
  assert.equal(accounts.rememberedVaultAccount("https://site2.example"), null, "then the next oldest");
  assert.equal(accounts.rememberedVaultAccount("https://site1.example"), "bitwarden/again", "using a site again keeps it");
  assert.equal(accounts.rememberedVaultAccount("https://extra.example"), "bitwarden/extra");
});

test("a damaged file reads as nothing remembered, and nothing secret is written", () => {
  native.docs.set(accounts.VAULT_ACCOUNTS_DOC, "{not json");
  accounts.reloadVaultAccounts();
  assert.equal(accounts.rememberedVaultAccount("https://example.com"), null);
  accounts.rememberVaultAccount("https://example.com", { provider: "bitwarden", id: "x", username: "me@example.com", password: "hunter2" });
  const text = native.docs.get(accounts.VAULT_ACCOUNTS_DOC);
  assert.ok(!text.includes("hunter2") && !text.includes("me@example.com"));
});

test("the username filled in a tab is offered only for the same site and tab", () => {
  accounts.noteFilledUsername("t1", "https://login.example.com", "me");
  assert.equal(accounts.filledUsername("t1", "https://app.example.com"), "me");
  assert.equal(accounts.filledUsername("t1", "https://example.org"), "");
  assert.equal(accounts.filledUsername("t2", "https://app.example.com"), "");
});
