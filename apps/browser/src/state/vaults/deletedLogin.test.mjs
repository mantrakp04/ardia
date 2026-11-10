import assert from "node:assert/strict";
import { test } from "node:test";
const native = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { webviews } = await import("../../platform/webviews.ts");
const store = await import("./store.ts");
const menu = await import("./menu.ts");
const { noteVaultKey } = await import("./fill.ts");
const { pendingFor, keepListedPending } = await import("./pendingTotp.ts");
const accounts = await import("./accounts.ts");
const { leftPage } = await import("../tabs/pageEvents.ts");

const S = () => useBrowser.getState();
const caps = { totp: true, save: true, selfHosted: true, masterPassword: true, touchID: false };
const provider = { id: "bitwarden", name: "Bitwarden", state: "unlocked", capabilities: caps, install: { command: "", url: "" } };
const kept = { provider: "bitwarden", id: "kept", title: "GitHub", username: "octo", urls: ["https://github.com"], hasTotp: true };
const gone = { provider: "bitwarden", id: "gone", title: "GitHub work", username: "work", urls: ["https://github.com"], hasTotp: true, updatedAt: 9e12 };
const field = (over = {}) => ({ frameId: "f1", origin: "https://github.com", main: true, kind: "password", focused: true, rect: { x: 10, y: 100, width: 240, height: 28 }, formHasPassword: true, ...over });
const settle = () => new Promise((r) => setTimeout(r, 0));

async function setup(fillReply) {
  S().hydrate({});
  const w = S().createWindow({ url: "https://github.com/login" });
  const tabId = S().windows[w].tabIds[0];
  const calls = [];
  webviews.set(tabId, {
    setVaultMenu: async (r) => void calls.push(["menu", r.open]),
    fillFromVault: async (r) => (calls.push(["fill", r.id]), fillReply(r)),
    discardVaultCapture: async () => {},
    focus: async () => {},
  });
  native.vaultFakes.providers = [provider];
  native.vaultFakes.items = [kept, gone];
  native.docs.delete(accounts.VAULT_ACCOUNTS_DOC);
  accounts.reloadVaultAccounts();
  S().updateSettings({ vaultSuggestOnFocus: true });
  store.clearVaultIndex();
  await store.loadVaultProviders();
  await store.loadAllVaultItems(true);
  return { tabId, calls };
}

test("a login deleted in its manager drops its remembered key and pending code once the list comes back without it", async () => {
  const { tabId } = await setup(() => ({ filled: ["username", "password"] }));
  accounts.rememberVaultAccount("https://github.com", gone, Date.now() - accounts.JUST_REMEMBERED_MS);
  store.setPendingTotp([{ origin: "https://github.com", provider: "bitwarden", id: "gone", at: Date.now() }]);
  native.vaultFakes.items = [kept];
  await store.loadAllVaultItems(true);
  assert.equal(accounts.rememberedVaultAccount("https://github.com"), null);
  accounts.reloadVaultAccounts();
  assert.equal(accounts.rememberedVaultAccount("https://github.com"), null, "gone from disk too");
  assert.equal(pendingFor(store.currentPendingTotp(), "https://github.com", Date.now()), null);
  menu.noteVaultField(tabId, field());
  await settle();
  const opened = menu.vaultMenuOf(tabId);
  assert.ok(opened, "the site's other login is still offered");
  assert.deepEqual(menu.rowsOfMenu(opened).filter((r) => r.kind === "login").map((r) => r.item.id), ["kept"]);
  assert.equal(opened.selected, 0);
});

test("an empty list, as a locked or reconnecting manager answers, forgets nothing", async () => {
  await setup(() => ({ filled: [] }));
  accounts.rememberVaultAccount("https://github.com", gone, Date.now() - accounts.JUST_REMEMBERED_MS);
  store.setPendingTotp([{ origin: "https://github.com", provider: "bitwarden", id: "gone", at: Date.now() }]);
  native.vaultFakes.items = [];
  await store.loadAllVaultItems(true);
  assert.equal(accounts.rememberedVaultAccount("https://github.com"), "bitwarden/gone");
  assert.equal(store.currentPendingTotp().length, 1);
});

test("filling a login the manager no longer has says so, and leaving and loading the site again works", async () => {
  const { tabId, calls } = await setup(() => ({ filled: [], error: "notFound" }));
  accounts.rememberVaultAccount("https://github.com", gone, Date.now() - accounts.JUST_REMEMBERED_MS);
  menu.noteVaultField(tabId, field());
  await settle();
  const opened = menu.vaultMenuOf(tabId);
  assert.equal(menu.rowsOfMenu(opened)[opened.selected].item.id, "gone", "the stale login rests selected before the manager tells us");
  native.vaultFakes.items = [kept];
  noteVaultKey(tabId, { frameId: "f1", key: "Enter" });
  await settle();
  await settle();
  assert.match(menu.vaultMenuOf(tabId).error, /no longer in Bitwarden/);
  assert.equal(menu.vaultMenuOf(tabId).busy, null);
  assert.deepEqual(store.allVaultItems().map((i) => i.id), ["kept"], "the index refreshed");
  assert.equal(accounts.rememberedVaultAccount("https://github.com"), null);
  assert.doesNotThrow(() => leftPage(tabId, "https://github.com/session", "https://github.com/login", "chromium", false));
  assert.equal(menu.vaultMenuOf(tabId), null);
  assert.deepEqual(calls.at(-1), ["menu", false]);
  menu.noteVaultField(tabId, field({ frameId: "f2" }));
  await settle();
  const again = menu.vaultMenuOf(tabId);
  assert.equal(menu.rowsOfMenu(again)[again.selected].item.id, "kept");
});

test("pending codes of other managers and listed logins stay", () => {
  const list = [
    { origin: "https://a.com", provider: "bitwarden", id: "kept", at: 1 },
    { origin: "https://b.com", provider: "bitwarden", id: "gone", at: 1 },
    { origin: "https://c.com", provider: "1password", id: "gone", at: 1 },
  ];
  assert.deepEqual(keepListedPending(list, "bitwarden", new Set(["kept"])).map((p) => p.origin), ["https://a.com", "https://c.com"]);
});

test("a login remembered a moment ago, like one just saved, stays while the list catches up", async () => {
  await setup(() => ({ filled: [] }));
  accounts.rememberVaultAccount("https://github.com", { provider: "bitwarden", id: "fresh" });
  await store.loadAllVaultItems(true);
  assert.equal(accounts.rememberedVaultAccount("https://github.com"), "bitwarden/fresh");
});
