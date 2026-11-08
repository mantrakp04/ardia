import assert from "node:assert/strict";
import { test } from "node:test";
const native = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { webviews } = await import("../../platform/webviews.ts");
const { pageOf } = await import("../tabs/pageState.ts");
const { showPasswordPrompt } = await import("../site/prompts.ts");
const store = await import("./store.ts");
const menu = await import("./menu.ts");
const { noteVaultKey } = await import("./fill.ts");
const offers = await import("./saveOffer.ts");
const { pendingFor } = await import("./pendingTotp.ts");
const { vaultBarActions } = await import("./barActions.ts");

const S = () => useBrowser.getState();
const caps = { totp: true, save: true, selfHosted: true, masterPassword: true, touchID: false };
const provider = (state) => ({ id: "bitwarden", name: "Bitwarden", state, capabilities: caps, install: { command: "brew install bitwarden-cli", url: "" } });
const login = { provider: "bitwarden", id: "gh", title: "GitHub", username: "octo", urls: ["https://github.com"], hasTotp: true };
const calls = [];
const handle = {
  setVaultMenu: async (r) => void calls.push(["menu", r.open, r.highlighted]),
  fillFromVault: async (r) => (calls.push(["fill", r]), { filled: ["username", "password"] }),
  fillGeneratedPassword: async () => ({ filled: ["newPassword"] }),
  saveToVault: async (r) => (calls.push(["save", r]), { saved: true }),
  discardVaultCapture: async (r) => void calls.push(["discard", r.origin]),
  focus: async () => void calls.push(["focus"]),
};
const field = (over = {}) => ({ frameId: "f1", origin: "https://github.com", main: true, kind: "password", focused: true, rect: { x: 10, y: 100, width: 240, height: 28 }, formHasPassword: true, ...over });
const settle = () => new Promise((r) => setTimeout(r, 0));

async function setup(state = "unlocked") {
  S().hydrate({});
  const w = S().createWindow({ url: "https://github.com/login" });
  const tabId = S().windows[w].tabIds[0];
  webviews.set(tabId, handle);
  native.vaultFakes.providers = [provider(state)];
  native.vaultFakes.items = [login];
  native.vaultFakes.copied.length = 0;
  calls.length = 0;
  store.clearVaultIndex();
  await store.loadVaultProviders();
  await store.loadAllVaultItems(true);
  return { w, tabId };
}

test("nothing opens on an insecure page or with suggestions turned off", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field({ origin: "http://github.com" }));
  await settle();
  assert.equal(menu.vaultMenuOf(tabId), null);
  S().updateSettings({ vaultSuggestOnFocus: false });
  menu.noteVaultField(tabId, field({ frameId: "f2" }));
  await settle();
  assert.equal(menu.vaultMenuOf(tabId), null);
  S().updateSettings({ vaultSuggestOnFocus: true });
});

test("focusing a login field with a match opens the menu and tells the page", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field());
  await settle();
  assert.equal(menu.vaultMenuOf(tabId)?.field, "password");
  assert.deepEqual(calls.at(-1), ["menu", true, false]);
  menu.noteVaultField(tabId, field({ rect: { x: 10, y: 60, width: 240, height: 28 } }));
  assert.equal(menu.vaultMenuOf(tabId)?.rect.y, 60, "rect updates follow the field");
});

test("arrow then enter fills the highlighted login into the reporting frame, and remembers its code", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field());
  await settle();
  noteVaultKey(tabId, { frameId: "other", key: "ArrowDown" });
  assert.equal(menu.vaultMenuOf(tabId)?.selected, -1, "keys from another frame are ignored");
  noteVaultKey(tabId, { frameId: "f1", key: "ArrowDown" });
  assert.deepEqual(calls.at(-1), ["menu", true, true], "the page takes Enter once a row is highlighted");
  noteVaultKey(tabId, { frameId: "f1", key: "Enter" });
  await settle();
  const fill = calls.find((c) => c[0] === "fill")[1];
  assert.deepEqual({ ...fill }, { frameId: "f1", origin: "https://github.com", provider: "bitwarden", id: "gh", fields: ["username", "password"], userChose: false });
  assert.equal(menu.vaultMenuOf(tabId), null);
  assert.equal(pendingFor(store.currentPendingTotp(), "https://github.com", Date.now())?.id, "gh");
});

test("enter with nothing highlighted closes the menu so the form can submit", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field());
  await settle();
  noteVaultKey(tabId, { frameId: "f1", key: "ArrowDown" });
  noteVaultKey(tabId, { frameId: "f1", key: "ArrowUp" });
  assert.deepEqual(calls.at(-1), ["menu", true, true]);
  menu.selectVaultRow(tabId, -1);
  assert.deepEqual(calls.at(-1), ["menu", true, false], "clearing the highlight lets the page keep Enter");
  noteVaultKey(tabId, { frameId: "f1", key: "Enter" });
  assert.equal(menu.vaultMenuOf(tabId), null);
  assert.deepEqual(calls.at(-1), ["menu", false, false]);
  assert.equal(calls.some((c) => c[0] === "fill"), false);
});

test("Chrome's own dropdown closes a menu opened on focus but not one opened on demand", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field());
  await settle();
  menu.noteAutofillSuggestions(tabId, 0);
  assert.ok(menu.vaultMenuOf(tabId), "an empty dropdown changes nothing");
  menu.noteAutofillSuggestions(tabId, 2);
  assert.equal(menu.vaultMenuOf(tabId), null);
  assert.deepEqual(calls.at(-1), ["menu", false, false]);
  assert.equal(menu.openVaultMenuOnDemand(tabId), true);
  menu.noteAutofillSuggestions(tabId, 2);
  assert.equal(menu.vaultMenuOf(tabId)?.onDemand, true, "a menu asked for stays");
  menu.closeVaultMenu(tabId);
});

test("a blur closes the menu after a short grace unless the pointer is on it", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field());
  await settle();
  menu.hoverVaultMenu(tabId, true);
  menu.noteVaultField(tabId, field({ focused: false }));
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(menu.vaultMenuOf(tabId), "kept while hovered");
  menu.hoverVaultMenu(tabId, false);
  assert.equal(menu.vaultMenuOf(tabId), null, "leaving after the blur closes it");
});

test("a locked manager offers its unlock row and keeps its items out of memory", async () => {
  const { tabId } = await setup("locked");
  assert.deepEqual(store.allVaultItems(), []);
  menu.noteVaultField(tabId, field());
  await settle();
  const rows = menu.rowsOfMenu(menu.vaultMenuOf(tabId));
  assert.deepEqual(rows.map((r) => r.kind), ["unlock", "allPasswords", "settings"]);
});

test("locking drops the index and pending codes", async () => {
  await setup();
  assert.equal(store.allVaultItems().length, 1);
  store.applyProviderState(provider("locked"));
  assert.deepEqual(store.allVaultItems(), []);
  assert.deepEqual(store.currentPendingTotp(), []);
});

test("a new login gets the save offer and Chrome's prompt for it stays hidden", async () => {
  const { tabId } = await setup();
  await offers.noteVaultSubmitted(tabId, { frameId: "f1", origin: "https://github.com", username: "someone-new" });
  assert.equal(offers.useVaultSaveOffers.getState()[tabId]?.target, "bitwarden");
  showPasswordPrompt(tabId, { state: "save", origin: "https://github.com", username: "someone-new", passwordLength: 8, federation: "", usernames: [] });
  assert.equal(pageOf(tabId).passwordPrompt, null);
  await offers.saveVaultOffer(tabId);
  assert.deepEqual(calls.find((c) => c[0] === "save")[1], { provider: "bitwarden", origin: "https://github.com", title: "github.com" });
  assert.equal(offers.useVaultSaveOffers.getState()[tabId], null);
});

test("a login already in the manager gets no offer, its capture is discarded, and Chrome's save prompt stays hidden", async () => {
  const { tabId } = await setup();
  await offers.noteVaultSubmitted(tabId, { frameId: "f1", origin: "https://github.com", username: "OCTO" });
  assert.equal(offers.useVaultSaveOffers.getState()[tabId] ?? null, null);
  assert.deepEqual(calls.at(-1), ["discard", "https://github.com"]);
  showPasswordPrompt(tabId, { state: "save", origin: "https://github.com", username: "OCTO", passwordLength: 8, federation: "", usernames: [] });
  assert.equal(pageOf(tabId).passwordPrompt, null);
  showPasswordPrompt(tabId, { state: "update", origin: "https://github.com", username: "OCTO", passwordLength: 8, federation: "", usernames: [] });
  assert.equal(pageOf(tabId).passwordPrompt?.state, "update", "an update prompt still shows");
});

test("Not Now discards the captured login", async () => {
  const { tabId } = await setup();
  await offers.noteVaultSubmitted(tabId, { frameId: "f1", origin: "https://github.com", username: "new" });
  offers.dismissVaultOffer(tabId);
  assert.deepEqual(calls.at(-1), ["discard", "https://github.com"]);
});

test("command bar actions show only with a connected manager, copies only with a match", async () => {
  const { w } = await setup();
  assert.deepEqual(vaultBarActions(S(), w).map((a) => a.id), ["vault:fill", "vault:copyPassword", "vault:copyUsername", "vault:copyCode", "vault:lock"]);
  native.vaultFakes.providers = [provider("signedOut")];
  await store.loadVaultProviders();
  store.applyProviderState(provider("signedOut"));
  assert.deepEqual(vaultBarActions(S(), w), []);
});
