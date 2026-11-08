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
const touch = await import("./touchID.ts");

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

test("focusing a login field with a match opens the menu on its first login and tells the page", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field());
  await settle();
  assert.equal(menu.vaultMenuOf(tabId)?.field, "password");
  assert.equal(menu.vaultMenuOf(tabId)?.selected, 0);
  assert.deepEqual(calls.at(-1), ["menu", true, true], "the page hands Enter to the menu");
  menu.noteVaultField(tabId, field({ rect: { x: 10, y: 60, width: 240, height: 28 } }));
  assert.equal(menu.vaultMenuOf(tabId)?.rect.y, 60, "rect updates follow the field");
});

test("enter fills the highlighted login into the reporting frame, and remembers its code", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field());
  await settle();
  noteVaultKey(tabId, { frameId: "other", key: "ArrowDown" });
  assert.equal(menu.vaultMenuOf(tabId)?.selected, 0, "keys from another frame are ignored");
  noteVaultKey(tabId, { frameId: "f1", key: "Enter" });
  await settle();
  const fill = calls.find((c) => c[0] === "fill")[1];
  assert.deepEqual({ ...fill }, { frameId: "f1", origin: "https://github.com", provider: "bitwarden", id: "gh", fields: ["username", "password"], userChose: false });
  assert.equal(menu.vaultMenuOf(tabId), null);
  assert.equal(pendingFor(store.currentPendingTotp(), "https://github.com", Date.now())?.id, "gh");
});

test("declining Touch ID or the Mac password keeps the menu open with no error and fills nothing", async () => {
  const { tabId } = await setup();
  const fill = handle.fillFromVault;
  handle.fillFromVault = async (r) => (calls.push(["fill", r]), { filled: [], error: "notAuthorized" });
  try {
    menu.noteVaultField(tabId, field());
    await settle();
    noteVaultKey(tabId, { frameId: "f1", key: "ArrowDown" });
    noteVaultKey(tabId, { frameId: "f1", key: "Enter" });
    await settle();
    const open = menu.vaultMenuOf(tabId);
    assert.ok(open, "the menu stays up to try again");
    assert.equal(open.error, null);
    assert.equal(open.busy, null);
    assert.equal(pendingFor(store.currentPendingTotp(), "https://github.com", Date.now()), null, "no code is queued for a login that wasn't filled");
  } finally {
    handle.fillFromVault = fill;
  }
});

test("Escape keeps the menu away when the same field gets focus back, until it's clicked", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field());
  await settle();
  noteVaultKey(tabId, { frameId: "f1", key: "Escape" });
  assert.equal(menu.vaultMenuOf(tabId), null);
  menu.noteVaultField(tabId, field({ focused: false, rect: null }));
  menu.noteVaultField(tabId, field());
  await settle();
  assert.equal(menu.vaultMenuOf(tabId), null, "coming back from another app doesn't reopen it");
  menu.noteVaultField(tabId, field({ clicked: true }));
  await settle();
  assert.ok(menu.vaultMenuOf(tabId), "a click on the field brings it back");
});

test("a field focused again while the menu is open hands the keys back to the menu", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field());
  await settle();
  noteVaultKey(tabId, { frameId: "f1", key: "ArrowDown" });
  calls.length = 0;
  menu.noteVaultField(tabId, field({ focused: false, rect: null }));
  menu.noteVaultField(tabId, field());
  assert.deepEqual(calls.at(-1), ["menu", true, true]);
});

test("a field already focused gets the menu once its manager unlocks", async () => {
  const { tabId } = await setup("locked");
  native.vaultFakes.items = [login];
  menu.noteVaultField(tabId, field({ kind: "username" }));
  await settle();
  menu.closeVaultMenu(tabId);
  const stop = menu.startVaultMenus();
  try {
    native.vaultFakes.providers = [provider("unlocked")];
    await store.loadVaultProviders();
    await settle();
    await settle();
    assert.ok(menu.vaultMenuOf(tabId), "the menu offers the login without a refocus");
  } finally {
    stop();
  }
});

test("on demand needs a focused field with a position", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field({ focused: false, rect: null }));
  assert.equal(menu.openVaultMenuOnDemand(tabId), false);
  assert.equal(menu.vaultMenuOf(tabId), null);
});

test("leaving the menu puts the highlight back on the first login", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field());
  await settle();
  menu.hoverVaultMenu(tabId, true);
  menu.selectVaultRow(tabId, 1);
  assert.equal(menu.vaultMenuOf(tabId)?.selected, 1, "hovering Other Passwords highlights it");
  menu.hoverVaultMenu(tabId, false);
  assert.equal(menu.vaultMenuOf(tabId)?.selected, 0);
  assert.deepEqual(calls.at(-1), ["menu", true, true]);
});

test("typing in the field closes the menu and keeps it closed until the field is clicked", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field());
  await settle();
  noteVaultKey(tabId, { frameId: "f1", key: "Escape" });
  assert.equal(menu.vaultMenuOf(tabId), null);
  menu.noteVaultField(tabId, field({ rect: { x: 10, y: 100, width: 240, height: 28 } }));
  await settle();
  assert.equal(menu.vaultMenuOf(tabId), null);
});

test("a touch fills the row the fingerprint is on, and nothing once it's disarmed", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field());
  await settle();
  touch.armVaultTouchID(tabId, null);
  assert.equal(touch.fillArmedRow(), false);
  touch.armVaultTouchID(tabId, "login:bitwarden/gh");
  assert.equal(touch.fillArmedRow(), true);
  await settle();
  assert.equal(calls.find((c) => c[0] === "fill")?.[1].id, "gh");
  touch.armVaultTouchID(tabId, null);
  assert.equal(touch.fillArmedRow(), false);
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
  assert.deepEqual(rows.map((r) => r.kind), ["unlock", "allPasswords"]);
  assert.equal(menu.vaultMenuOf(tabId).selected, 0, "with nothing to fill, the unlock row is the one Touch ID acts on");
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
