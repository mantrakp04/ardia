import assert from "node:assert/strict";
import { after, test } from "node:test";
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
const accounts = await import("./accounts.ts");
const fillModule = await import("./fill.ts");

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
  native.docs.delete(accounts.VAULT_ACCOUNTS_DOC);
  accounts.reloadVaultAccounts();
  S().updateSettings({ vaultSuggestOnFocus: true, vaultSaveOffer: true, vaultAutoSave: true, vaultSaveTarget: "" });
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
  assert.deepEqual({ ...fill }, { frameId: "f1", origin: "https://github.com", provider: "bitwarden", id: "gh", fields: ["username", "password"], userChose: false, submit: false });
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

test("typing in the field closes the menu, and the field's own focus reports don't bring it back", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field());
  await settle();
  noteVaultKey(tabId, { frameId: "f1", key: "Typed" });
  assert.equal(menu.vaultMenuOf(tabId), null);
  assert.deepEqual(calls.at(-1), ["menu", false, false]);
  menu.noteVaultField(tabId, field({ rect: { x: 10, y: 100, width: 240, height: 28 } }));
  await settle();
  assert.equal(menu.vaultMenuOf(tabId), null);
});

test("a touch fills the selected login, and nothing once it's disarmed", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field());
  await settle();
  const seq = menu.vaultMenuOf(tabId).seq;
  touch.armVaultTouchID(tabId, null);
  assert.equal(touch.grantVaultTouch(tabId, seq), false);
  touch.armVaultTouchID(tabId, seq);
  assert.equal(touch.grantVaultTouch("another-tab", seq), false, "a grant for another tab fills nothing here");
  assert.equal(touch.grantVaultTouch(tabId, seq + 1), false, "nor one for another menu");
  assert.equal(touch.grantVaultTouch(tabId, seq), true);
  await settle();
  assert.equal(calls.find((c) => c[0] === "fill")?.[1].id, "gh");
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

test("Chrome's own dropdown never closes a menu that has logins to fill", async () => {
  const { tabId } = await setup();
  menu.noteVaultField(tabId, field());
  await settle();
  menu.noteAutofillSuggestions(tabId, 2);
  assert.ok(menu.vaultMenuOf(tabId), "the login row keeps our menu up");
  menu.closeVaultMenu(tabId);
});

test("Chrome's dropdown takes over a menu with only unlock rows, which stays away until asked for", async () => {
  const { tabId } = await setup("locked");
  const stop = menu.startVaultMenus();
  try {
    menu.noteVaultField(tabId, field());
    await settle();
    menu.noteAutofillSuggestions(tabId, 0);
    assert.ok(menu.vaultMenuOf(tabId), "an empty dropdown changes nothing");
    menu.noteAutofillSuggestions(tabId, 2);
    assert.equal(menu.vaultMenuOf(tabId), null);
    assert.deepEqual(calls.at(-1), ["menu", false, false]);
    menu.offerToFocusedField(tabId);
    await settle();
    assert.equal(menu.vaultMenuOf(tabId), null, "an automatic offer doesn't fight Chrome's dropdown");
    assert.equal(menu.openVaultMenuOnDemand(tabId), true);
    menu.noteAutofillSuggestions(tabId, 2);
    assert.equal(menu.vaultMenuOf(tabId)?.onDemand, true, "a menu asked for stays");
  } finally {
    stop();
    menu.closeVaultMenu(tabId);
  }
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
  assert.deepEqual(vaultBarActions(S(), w).map((a) => a.id), ["vault:fill", "vault:copyPassword", "vault:copyUsername", "vault:lock"]);
  native.vaultFakes.providers = [provider("signedOut")];
  await store.loadVaultProviders();
  store.applyProviderState(provider("signedOut"));
  assert.deepEqual(vaultBarActions(S(), w), []);
});

const second = { provider: "bitwarden", id: "work", title: "GitHub", username: "octo-work", urls: ["https://github.com"], hasTotp: false };
const openMenuNow = async (tabId, over = {}) => {
  menu.noteVaultField(tabId, field(over));
  await settle();
  return menu.vaultMenuOf(tabId);
};
const fills = () => calls.filter((c) => c[0] === "fill").map((c) => c[1]);
const saves = () => calls.filter((c) => c[0] === "save").map((c) => c[1]);
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function withHandle(patch, run) {
  const saved = Object.fromEntries(Object.keys(patch).map((k) => [k, handle[k]]));
  Object.assign(handle, patch);
  try {
    await run();
  } finally {
    Object.assign(handle, saved);
  }
}

test("a click on the focused field always brings the menu back, even after Escape and with Suggest on Focus off", async () => {
  const { tabId } = await setup();
  await openMenuNow(tabId);
  noteVaultKey(tabId, { frameId: "f1", key: "Escape" });
  menu.noteVaultField(tabId, field());
  await settle();
  assert.equal(menu.vaultMenuOf(tabId), null, "a plain focus report changes nothing");
  menu.noteVaultField(tabId, field({ clicked: true }));
  assert.ok(menu.vaultMenuOf(tabId), "the click reopens it at once");
  assert.deepEqual(calls.at(-1), ["menu", true, true]);
  menu.closeVaultMenu(tabId);
  S().updateSettings({ vaultSuggestOnFocus: false });
  menu.noteVaultField(tabId, field({ focused: false, rect: null }));
  await openMenuNow(tabId);
  assert.equal(menu.vaultMenuOf(tabId), null, "nothing on focus with suggestions off");
  menu.noteVaultField(tabId, field({ clicked: true }));
  assert.equal(menu.vaultMenuOf(tabId)?.onDemand, true, "a click still asks for it");
});

test("a click on a field with no saved login still opens the menu", async () => {
  const { tabId } = await setup();
  await openMenuNow(tabId, { origin: "https://example.com" });
  assert.equal(menu.vaultMenuOf(tabId), null);
  menu.noteVaultField(tabId, field({ origin: "https://example.com", clicked: true }));
  assert.deepEqual(menu.rowsOfMenu(menu.vaultMenuOf(tabId)).map((r) => r.kind), ["allPasswords", "suggest", "settings"]);
});

test("ArrowDown with the menu closed opens it and lifts Escape's quiet", async () => {
  const { tabId } = await setup();
  await openMenuNow(tabId);
  noteVaultKey(tabId, { frameId: "f1", key: "Escape" });
  noteVaultKey(tabId, { frameId: "other", key: "ArrowDown" });
  assert.equal(menu.vaultMenuOf(tabId), null, "another frame's arrow opens nothing");
  noteVaultKey(tabId, { frameId: "f1", key: "ArrowDown" });
  assert.equal(menu.vaultMenuOf(tabId)?.selected, 0, "opens resting on the login, not one row further");
  menu.closeVaultMenu(tabId);
  menu.noteVaultField(tabId, field({ focused: false, rect: null }));
  await openMenuNow(tabId);
  assert.ok(menu.vaultMenuOf(tabId), "the quiet is gone, so the next focus offers again");
});

test("Typed is not Escape: coming back to the field offers the menu again", async () => {
  const { tabId } = await setup();
  await openMenuNow(tabId);
  noteVaultKey(tabId, { frameId: "f1", key: "Typed" });
  assert.equal(menu.vaultMenuOf(tabId), null);
  menu.noteVaultField(tabId, field({ focused: false, rect: null }));
  await openMenuNow(tabId);
  assert.ok(menu.vaultMenuOf(tabId));
});

test("Typed doesn't come back by itself while the person keeps typing", async () => {
  const { tabId } = await setup();
  const stop = menu.startVaultMenus();
  try {
    await openMenuNow(tabId);
    noteVaultKey(tabId, { frameId: "f1", key: "Typed" });
    menu.offerToFocusedField(tabId);
    await settle();
    assert.equal(menu.vaultMenuOf(tabId), null);
  } finally {
    stop();
  }
});

test("emptying the field offers the menu again, even after Escape", async () => {
  const { tabId } = await setup();
  await openMenuNow(tabId);
  noteVaultKey(tabId, { frameId: "f1", key: "Escape" });
  noteVaultKey(tabId, { frameId: "f1", key: "Cleared" });
  await settle();
  assert.ok(menu.vaultMenuOf(tabId));
  assert.equal(menu.vaultMenuOf(tabId).onDemand, false);
});

test("a field scrolled out of view hides the menu, hands keys back to the page, and shows it again on return", async () => {
  const { tabId } = await setup();
  const opened = await openMenuNow(tabId);
  menu.setVaultMenuOffscreen(tabId, opened.seq, true);
  assert.equal(menu.vaultMenuOf(tabId)?.hidden, true, "still open for the same field");
  assert.deepEqual(calls.at(-1), ["menu", false, false]);
  noteVaultKey(tabId, { frameId: "f1", key: "Enter" });
  await settle();
  assert.deepEqual(fills(), [], "Enter never fills from a menu nobody can see");
  menu.noteVaultField(tabId, field({ rect: { x: 10, y: 300, width: 240, height: 28 } }));
  menu.setVaultMenuOffscreen(tabId, opened.seq, false);
  assert.equal(menu.vaultMenuOf(tabId)?.hidden, false);
  assert.deepEqual(calls.at(-1), ["menu", true, true]);
  assert.equal(menu.vaultMenuOf(tabId).rect.y, 300);
});

test("logins that arrive after the field was focused open the menu", async () => {
  const { tabId } = await setup();
  const stop = menu.startVaultMenus();
  try {
    store.clearVaultIndex();
    native.vaultFakes.items = null;
    await openMenuNow(tabId);
    assert.equal(menu.vaultMenuOf(tabId), null, "the list failed to load");
    native.vaultFakes.items = [login];
    await store.loadVaultItems("bitwarden", true);
    await settle();
    assert.ok(menu.vaultMenuOf(tabId), "the late list opens it");
  } finally {
    native.vaultFakes.items = [login];
    stop();
  }
});

test("a menu message the page missed is sent again, and a page that still routes keys to a closed menu is told it's closed", async () => {
  const { tabId } = await setup();
  let failures = 1;
  await withHandle(
    { setVaultMenu: async (r) => (calls.push(["menu", r.open, r.highlighted]), failures-- > 0 ? Promise.reject(new Error("gone")) : undefined) },
    async () => {
      await openMenuNow(tabId);
      await settle();
      assert.deepEqual(calls.filter((c) => c[0] === "menu"), [["menu", true, true], ["menu", true, true]]);
    },
  );
  menu.closeVaultMenu(tabId);
  calls.length = 0;
  noteVaultKey(tabId, { frameId: "f1", key: "Enter" });
  assert.deepEqual(calls, [["menu", false, false]]);
});

test("the login used last on a site comes first and is the one selected next time", async () => {
  const { tabId } = await setup();
  native.vaultFakes.items = [login, second];
  await store.loadAllVaultItems(true);
  const first = await openMenuNow(tabId);
  const rows = menu.rowsOfMenu(first);
  const workAt = rows.findIndex((r) => r.key === "login:bitwarden/work");
  menu.selectVaultRow(tabId, workAt);
  noteVaultKey(tabId, { frameId: "f1", key: "Enter" });
  await settle();
  assert.equal(fills().at(-1).id, "work");
  menu.noteVaultField(tabId, field({ focused: false, rect: null }));
  menu.noteVaultField(tabId, field({ origin: "https://www.github.com", frameId: "f2", clicked: true }));
  const again = menu.vaultMenuOf(tabId);
  assert.equal(menu.rowsOfMenu(again)[0].key, "login:bitwarden/work");
  assert.equal(again.selected, 0);
  accounts.reloadVaultAccounts();
  assert.equal(accounts.rememberedVaultAccount("https://accounts.github.com"), "bitwarden/work", "kept on disk, for the whole site");
});

test("a remembered login that's gone falls back to the first match", async () => {
  const { tabId } = await setup();
  accounts.rememberVaultAccount("https://github.com", { provider: "bitwarden", id: "deleted" });
  const opened = await openMenuNow(tabId);
  assert.equal(opened.selected, 0);
  assert.equal(menu.rowsOfMenu(opened)[0].key, "login:bitwarden/gh");
});

test("a Touch ID retry flips back to ready, and lockout takes the fingerprint away for this menu", async () => {
  const { tabId } = await setup();
  const opened = await openMenuNow(tabId);
  touch.noteVaultTouchStatus(tabId, opened.seq, "ready");
  touch.noteVaultTouchStatus(tabId, opened.seq, "retry");
  assert.equal(menu.vaultMenuOf(tabId).touch, "retry");
  assert.equal(menu.vaultMenuOf(tabId).touchRetries, 1);
  touch.noteVaultTouchStatus(tabId, opened.seq, "ready");
  touch.noteVaultTouchStatus(tabId, opened.seq, "retry");
  touch.noteVaultTouchStatus(tabId, opened.seq, "ready");
  assert.equal(menu.vaultMenuOf(tabId).touch, "ready");
  assert.equal(menu.vaultMenuOf(tabId).touchRetries, 2);
  touch.noteVaultTouchStatus(tabId, opened.seq + 99, "lockout");
  assert.equal(menu.vaultMenuOf(tabId).touch, "ready", "a status from an older menu is ignored");
  touch.noteVaultTouchStatus(tabId, opened.seq, "lockout");
  touch.armVaultTouchID(tabId, opened.seq);
  assert.equal(touch.grantVaultTouch(tabId, opened.seq), false);
  assert.deepEqual(fills(), []);
  noteVaultKey(tabId, { frameId: "f1", key: "Enter" });
  await settle();
  assert.equal(fills().at(-1).submit, false, "Return still fills, through the system prompt");
});

test("a Touch ID grant fills the row selected at that moment and submits, even if the pointer moves on", async () => {
  const { tabId } = await setup();
  native.vaultFakes.items = [login, second];
  await store.loadAllVaultItems(true);
  const pending = deferred();
  await withHandle({ fillFromVault: async (r) => (calls.push(["fill", r]), pending.promise) }, async () => {
    const opened = await openMenuNow(tabId);
    menu.hoverVaultMenu(tabId, true);
    menu.selectVaultRow(tabId, 1);
    const armedKey = menu.rowsOfMenu(opened)[1].key;
    touch.armVaultTouchID(tabId, opened.seq);
    touch.noteVaultTouchStatus(tabId, opened.seq, "granted");
    menu.selectVaultRow(tabId, 0);
    touch.noteVaultTouchStatus(tabId, opened.seq, "granted");
    assert.equal(fills().length, 1, "one touch fills once");
    assert.equal(`login:bitwarden/${fills()[0].id}`, armedKey);
    assert.equal(fills()[0].submit, true);
    assert.equal(menu.vaultMenuOf(tabId).touch, "granted");
    pending.resolve({ filled: ["username", "password"] });
    await settle();
  });
  assert.equal(menu.vaultMenuOf(tabId), null);
});

test("a click fills without submitting", async () => {
  const { tabId } = await setup();
  const opened = await openMenuNow(tabId);
  fillModule.activateVaultRow(tabId, menu.rowsOfMenu(opened)[0]);
  await settle();
  assert.equal(fills()[0].submit, false);
});

test("an expired Touch ID grant says so and arms again", async () => {
  const { tabId } = await setup();
  const opened = await openMenuNow(tabId);
  await withHandle({ fillFromVault: async (r) => (calls.push(["fill", r]), { filled: [], error: "notAuthorized" }) }, async () => {
    touch.armVaultTouchID(tabId, opened.seq);
    touch.noteVaultTouchStatus(tabId, opened.seq, "granted");
    await settle();
  });
  const now = menu.vaultMenuOf(tabId);
  assert.equal(now.error, fillModule.TOUCH_ID_EXPIRED);
  assert.equal(now.busy, null);
  assert.ok(touch.touchIDGlyphShown(now.touch));
  assert.equal(touch.grantVaultTouch(tabId, opened.seq), true, "the next touch can fill");
  await settle();
  assert.equal(menu.vaultMenuOf(tabId), null);
});

test("new password fields offer four generators and pass the field's length limit", async () => {
  const { tabId } = await setup();
  let request = null;
  await withHandle({ fillGeneratedPassword: async (r) => ((request = r), { filled: ["newPassword"] }) }, async () => {
    const opened = await openMenuNow(tabId, { kind: "newPassword", maxLength: 16 });
    const rows = menu.rowsOfMenu(opened);
    assert.deepEqual(rows.map((r) => r.key), ["generate:strong", "generate:alphanumeric", "generate:easyToType", "generate:passphrase", "openPasswords"]);
    assert.equal(opened.selected, 0);
    fillModule.activateVaultRow(tabId, rows[3]);
    await settle();
  });
  assert.deepEqual({ ...request }, { frameId: "f1", origin: "https://github.com", style: "passphrase", maxLength: 16 });
  assert.equal(menu.vaultMenuOf(tabId), null);
});

test("Suggest New Password uses the strong style and leaves out a missing length limit", async () => {
  const { tabId } = await setup();
  let request = null;
  await withHandle({ fillGeneratedPassword: async (r) => ((request = r), { filled: ["newPassword"] }) }, async () => {
    const opened = await openMenuNow(tabId, { maxLength: 0 });
    fillModule.activateVaultRow(tabId, menu.rowsOfMenu(opened).find((r) => r.kind === "suggest"));
    await settle();
  });
  assert.deepEqual({ ...request }, { frameId: "f1", origin: "https://github.com", style: "strong" });
});

test("filling a login never copies its one-time code", async () => {
  const { w, tabId } = await setup();
  await openMenuNow(tabId);
  noteVaultKey(tabId, { frameId: "f1", key: "Enter" });
  await new Promise((r) => setTimeout(r, 2200));
  assert.deepEqual(native.vaultFakes.copied, []);
  assert.ok(!vaultBarActions(S(), w).some((a) => /code/i.test(a.id) || /code/i.test(a.title)));
});

const submitted = (over = {}) => ({ frameId: "f1", origin: "https://github.com", username: "", usernameFrom: over.username ? "form" : "", trusted: true, newPassword: false, generated: false, ...over });
const offerOf = (tabId) => offers.useVaultSaveOffers.getState()[tabId] ?? null;

test("a new password with a known username saves at once", async () => {
  const { tabId } = await setup();
  await offers.noteVaultSubmitted(tabId, submitted({ username: "new@example.com", newPassword: true }));
  assert.deepEqual(saves(), [{ provider: "bitwarden", origin: "https://github.com", title: "github.com" }]);
  assert.equal(offerOf(tabId), null);
});

test("a remembered login's username never saves by itself; it's the suggestion in the offer", async () => {
  const { tabId } = await setup();
  accounts.rememberVaultAccount("https://login.example.com", login);
  native.vaultFakes.items = [{ ...login, urls: ["https://login.example.com"] }];
  await store.loadAllVaultItems(true);
  await offers.noteVaultSubmitted(tabId, submitted({ origin: "https://signup.example.com", generated: true }));
  assert.deepEqual(saves(), []);
  assert.equal(offerOf(tabId)?.username, "octo");
  assert.equal(offerOf(tabId)?.needsUsername, false);
  await offers.saveVaultOffer(tabId);
  assert.equal(saves()[0].username, "octo", "the guess is sent as the username");
});

test("a generated password with no username anywhere asks for one, and saves with what's typed", async () => {
  const { tabId } = await setup();
  await offers.noteVaultSubmitted(tabId, submitted({ origin: "https://example.com", generated: true }));
  assert.deepEqual(saves(), []);
  const offer = offerOf(tabId);
  assert.equal(offer.needsUsername, true);
  assert.equal(offer.editing, true);
  assert.equal(offers.canSaveVaultOffer(offer), false);
  offers.setVaultOfferUsername(tabId, "   ");
  await offers.saveVaultOffer(tabId);
  assert.deepEqual(saves(), [], "blank doesn't save");
  offers.setVaultOfferUsername(tabId, " me@example.com ");
  await offers.saveVaultOffer(tabId);
  assert.equal(saves()[0].username, "me@example.com");
  assert.equal(offerOf(tabId), null);
});

test("the same submission twice in a row is handled once", async () => {
  const { tabId } = await setup();
  const event = submitted({ username: "twice@example.com", newPassword: true });
  await Promise.all([offers.noteVaultSubmitted(tabId, event), offers.noteVaultSubmitted(tabId, event)]);
  assert.equal(saves().length, 1);
});

test("a new password for a login already saved, like a Touch ID fill that submitted, is left alone", async () => {
  const { tabId } = await setup();
  await offers.noteVaultSubmitted(tabId, submitted({ username: "octo", newPassword: true }));
  await offers.noteVaultSubmitted(tabId, submitted({ username: "OCTO" }));
  assert.deepEqual(saves(), []);
  assert.equal(offerOf(tabId), null);
});

test("an automatic save that fails shows the offer with the error", async () => {
  const { tabId } = await setup();
  await withHandle({ saveToVault: async (r) => (calls.push(["save", r]), { saved: false }) }, async () => {
    await offers.noteVaultSubmitted(tabId, submitted({ username: "new@example.com", newPassword: true }));
  });
  assert.equal(saves().length, 1);
  assert.equal(offerOf(tabId)?.error, "Couldn't save to Bitwarden. Try again.");
  assert.equal(offerOf(tabId)?.username, "new@example.com");
});

test("with automatic saving off, or several managers and no default, a new password gets the offer", async () => {
  const { tabId } = await setup();
  S().updateSettings({ vaultAutoSave: false });
  await offers.noteVaultSubmitted(tabId, submitted({ username: "a@example.com", newPassword: true }));
  assert.deepEqual(saves(), []);
  assert.equal(offerOf(tabId)?.username, "a@example.com");
  offers.dismissVaultOffer(tabId);
  S().updateSettings({ vaultAutoSave: true });
  native.vaultFakes.providers = [provider("unlocked"), { ...provider("unlocked"), id: "protonpass", name: "Proton Pass" }];
  await store.loadVaultProviders();
  await offers.noteVaultSubmitted(tabId, submitted({ username: "b@example.com", generated: true }));
  assert.deepEqual(saves(), []);
  assert.deepEqual(offerOf(tabId)?.targets, ["bitwarden", "protonpass"]);
});

test("the username in an ordinary offer can be changed before saving", async () => {
  const { tabId } = await setup();
  await offers.noteVaultSubmitted(tabId, submitted({ username: "typo@example.con" }));
  assert.equal(offerOf(tabId).editing, false);
  offers.editVaultOfferUsername(tabId);
  offers.setVaultOfferUsername(tabId, "typo@example.com");
  await offers.saveVaultOffer(tabId);
  assert.equal(saves()[0].username, "typo@example.com");
});

test("a saved login becomes the remembered one for its site", async () => {
  const { tabId } = await setup();
  await withHandle({ saveToVault: async (r) => (calls.push(["save", r]), { saved: true, item: { ...second, id: "fresh" } }) }, async () => {
    await offers.noteVaultSubmitted(tabId, submitted({ username: "fresh@example.com", newPassword: true }));
  });
  assert.equal(accounts.rememberedVaultAccount("https://github.com"), "bitwarden/fresh");
});

after(() => {
  for (const tabId of Object.keys(offers.useVaultSaveOffers.getState())) offers.dismissVaultOffer(tabId);
});

test("the login just filled in this tab is only a suggestion for a new password", async () => {
  const { tabId } = await setup();
  native.vaultFakes.items = [{ ...login, urls: ["https://login.example.com"] }];
  await store.loadAllVaultItems(true);
  menu.noteVaultField(tabId, field({ origin: "https://login.example.com", clicked: true }));
  noteVaultKey(tabId, { frameId: "f1", key: "Enter" });
  await settle();
  native.docs.delete(accounts.VAULT_ACCOUNTS_DOC);
  accounts.reloadVaultAccounts();
  await offers.noteVaultSubmitted(tabId, submitted({ origin: "https://app.example.com", newPassword: true }));
  assert.deepEqual(saves(), []);
  assert.equal(offerOf(tabId)?.username, "octo");
});

test("a password change whose username only came from a fallback still gets the offer", async () => {
  const { tabId } = await setup();
  accounts.rememberVaultAccount("https://github.com", login);
  await offers.noteVaultSubmitted(tabId, submitted({ newPassword: true }));
  assert.deepEqual(saves(), []);
  assert.equal(offerOf(tabId)?.username, "octo", "kept, so the person decides");
});

test("a username guessed from the page, not the form, never saves by itself", async () => {
  const { tabId } = await setup();
  await offers.noteVaultSubmitted(tabId, submitted({ username: "guess@example.com", usernameFrom: "nearby", newPassword: true }));
  assert.deepEqual(saves(), []);
  assert.equal(offerOf(tabId)?.username, "guess@example.com");
  offers.dismissVaultOffer(tabId);
  await offers.noteVaultSubmitted(tabId, submitted({ username: "octo", usernameFrom: "page", newPassword: true }));
  assert.equal(offerOf(tabId)?.username, "octo", "a page guess that matches a saved login is not a password change");
});

test("a submit the page made itself never saves by itself", async () => {
  const { tabId } = await setup();
  await offers.noteVaultSubmitted(tabId, submitted({ username: "script@example.com", newPassword: true, trusted: false }));
  assert.deepEqual(saves(), []);
  assert.equal(offerOf(tabId)?.username, "script@example.com");
});

test("one automatic save per page load; the next asks, and a new page saves again", async () => {
  const { tabId } = await setup();
  await offers.noteVaultSubmitted(tabId, submitted({ username: "one@example.com", newPassword: true }));
  await offers.noteVaultSubmitted(tabId, submitted({ username: "two@example.com", newPassword: true }));
  assert.deepEqual(saves().map((s) => s.origin), ["https://github.com"]);
  assert.equal(offerOf(tabId)?.username, "two@example.com");
  offers.dismissVaultOffer(tabId);
  menu.forgetVaultPage(tabId);
  await offers.noteVaultSubmitted(tabId, submitted({ username: "three@example.com", newPassword: true }));
  assert.equal(saves().length, 2);
});

test("a submission that arrives while the same save is running is ignored", async () => {
  const { tabId } = await setup();
  const pending = deferred();
  await withHandle({ saveToVault: async (r) => (calls.push(["save", r]), pending.promise) }, async () => {
    const first = offers.noteVaultSubmitted(tabId, submitted({ username: "slow@example.com", newPassword: true }));
    await settle();
    await settle();
    assert.equal(saves().length, 1);
    await new Promise((r) => setTimeout(r, offers.SAME_SUBMISSION_MS + 50));
    await offers.noteVaultSubmitted(tabId, submitted({ username: "SLOW@example.com", newPassword: true }));
    pending.resolve({ saved: true });
    await first;
  });
  assert.equal(saves().length, 1);
  assert.equal(offerOf(tabId), null);
});

test("a grant with nothing left to fill re-arms the sensor", async () => {
  const { tabId } = await setup();
  const opened = await openMenuNow(tabId);
  touch.armVaultTouchID(tabId, opened.seq);
  menu.selectVaultRow(tabId, menu.rowsOfMenu(opened).findIndex((r) => r.kind === "allPasswords"));
  touch.noteVaultTouchStatus(tabId, opened.seq, "granted");
  assert.deepEqual(fills(), []);
  assert.equal(menu.vaultMenuOf(tabId).touchRearms, 1);
});
