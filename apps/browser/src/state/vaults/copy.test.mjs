import assert from "node:assert/strict";
import { test } from "node:test";
const native = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { useToasts } = await import("../app/toasts.ts");
const store = await import("./store.ts");
const accounts = await import("./accounts.ts");
const { copyChoice, runVaultAction } = await import("./barActions.ts");
const { copyFailureMessage, copyOutcomeOf } = await import("./actions.ts");

const S = () => useBrowser.getState();
const caps = { totp: true, save: true, selfHosted: true, masterPassword: true, touchID: false };
const bitwarden = { id: "bitwarden", name: "Bitwarden", state: "unlocked", capabilities: caps, install: { command: "", url: "" } };
const personal = { provider: "bitwarden", id: "home", title: "GitHub", username: "octo", urls: ["https://github.com"], hasTotp: false, updatedAt: 2 };
const work = { provider: "bitwarden", id: "work", title: "GitHub", username: "octo-work", urls: ["https://github.com"], hasTotp: false, updatedAt: 1 };
const settle = () => new Promise((r) => setTimeout(r, 0));

async function setup() {
  S().hydrate({});
  const w = S().createWindow({ url: "https://github.com/login" });
  const tabId = S().windows[w].tabIds[0];
  native.vaultFakes.providers = [bitwarden];
  native.vaultFakes.items = [personal, work];
  native.vaultFakes.copied.length = 0;
  native.docs.delete(accounts.VAULT_ACCOUNTS_DOC);
  accounts.reloadVaultAccounts();
  store.clearVaultIndex();
  await store.loadVaultProviders();
  await store.loadAllVaultItems(true);
  return { w, tabId };
}

test("the copy reply maps to what the person is told", () => {
  assert.equal(copyOutcomeOf({ copied: true, clearsAfter: 90 }), "copied");
  assert.equal(copyOutcomeOf({ copied: false, declined: true, clearsAfter: 0 }), "declined");
  assert.equal(copyOutcomeOf({ copied: false, error: "locked", clearsAfter: 0 }), "locked");
  assert.equal(copyOutcomeOf({ copied: false, error: "notFound", clearsAfter: 0 }), "notFound");
  assert.equal(copyOutcomeOf({ copied: false, error: "clipboard", clearsAfter: 0 }), "failed");
  assert.equal(copyOutcomeOf({ copied: false, clearsAfter: 0 }), "failed");
  assert.equal(copyOutcomeOf(null), "failed");
});

test("a refused copy says why, a declined one says nothing", () => {
  assert.equal(copyFailureMessage("copied", "password", "bitwarden"), "");
  assert.equal(copyFailureMessage("declined", "password", "bitwarden"), "");
  assert.equal(copyFailureMessage("locked", "username", "bitwarden"), "Unlock Bitwarden to copy the username.");
  assert.equal(copyFailureMessage("notFound", "password", "bitwarden"), "Bitwarden has no password for this login.");
  assert.equal(copyFailureMessage("failed", "password", "bitwarden"), "Couldn't copy the password from Bitwarden. Try again.");
});

test("the command bar copies the login filled in the tab, else the one used last on the site", () => {
  const items = [personal, work];
  assert.equal(copyChoice(items, "https://github.com")?.id, "home");
  assert.equal(copyChoice(items, "https://github.com", "", "bitwarden/work")?.id, "work");
  assert.equal(copyChoice(items, "https://github.com", "OCTO-WORK", "bitwarden/home")?.id, "work");
  assert.equal(copyChoice(items, "https://github.com", "someone-else")?.id, "home");
  assert.equal(copyChoice(items, "https://example.com"), null);
});

test("Copy Username and Copy Password in the command bar reach the manager and confirm", async () => {
  const { w, tabId } = await setup();
  accounts.rememberVaultAccount("https://github.com", work);
  runVaultAction("vault:copyUsername", S(), w);
  await settle();
  assert.deepEqual(native.vaultFakes.copied.at(-1), { provider: "bitwarden", id: "work", field: "username" });
  assert.equal(useToasts.getState().toasts[w]?.title, "Copied Username");
  accounts.noteFilledUsername(tabId, "https://github.com", "octo");
  runVaultAction("vault:copyPassword", S(), w);
  await settle();
  assert.deepEqual(native.vaultFakes.copied.at(-1), { provider: "bitwarden", id: "home", field: "password" });
  assert.equal(useToasts.getState().toasts[w]?.title, "Copied Password");
});
