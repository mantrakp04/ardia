import assert from "node:assert/strict";
import { test } from "node:test";
const native = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { webviews } = await import("../../platform/webviews.ts");
const store = await import("./store.ts");
const menu = await import("./menu.ts");
const accounts = await import("./accounts.ts");
const { activateVaultRow } = await import("./fill.ts");
const model = await import("./totpSetupModel.ts");
const setup = await import("./totpSetup.ts");
const { useToasts } = await import("../app/toasts.ts");

const S = () => useBrowser.getState();
const caps = (addTotp) => ({ totp: true, save: true, selfHosted: false, masterPassword: false, touchID: false, addTotp });
const manager = (id, state = "unlocked", addTotp = true, name = id) => ({ id, name, state, capabilities: caps(addTotp), install: { command: "", url: "" } });
const octo = { provider: "bitwarden", id: "gh", title: "GitHub", username: "octo", urls: ["https://github.com"], hasTotp: false };
const work = { provider: "bitwarden", id: "gh2", title: "GitHub work", username: "octo-work", urls: ["https://github.com"], hasTotp: true };
const proton = { provider: "protonpass", id: "s/p", title: "GitHub", username: "octo-proton", urls: ["https://github.com"], hasTotp: false };
const elsewhere = { provider: "bitwarden", id: "gl", title: "GitLab", username: "octo", urls: ["https://gitlab.com"], hasTotp: false };
const calls = [];
const handle = {
  setVaultMenu: async (r) => void calls.push(["menu", r.open]),
  setVaultCodeMenu: async (r) => void calls.push(["codeMenu", r]),
  setVaultContextMenu: async () => undefined,
  fillFromVault: async (r) => (calls.push(["fill", r]), { filled: ["username"] }),
  discardVaultCapture: async () => undefined,
  focus: async () => undefined,
};
const found = (over = {}) => ({ frameId: "f1", origin: "https://github.com", main: true, rect: { x: 400, y: 300, width: 180, height: 180 }, token: "t1", issuer: "GitHub", account: "octo", ...over });
const settle = () => new Promise((r) => setTimeout(r, 0));
const lastMenu = () => calls.filter(([kind]) => kind === "codeMenu").at(-1)?.[1];
const toastOf = (tabId) => useToasts.getState().toasts[S().tabs[tabId].windowId]?.title;

async function start(providers = [manager("bitwarden", "unlocked", true, "Bitwarden"), manager("protonpass", "unlocked", false, "Proton Pass")]) {
  S().hydrate({});
  const w = S().createWindow({ url: "https://github.com/settings/security" });
  const tabId = S().windows[w].tabIds[0];
  webviews.set(tabId, handle);
  native.vaultFakes.providers = providers;
  native.vaultFakes.items = [octo, work, proton, elsewhere];
  native.vaultFakes.addedTotps = [];
  native.vaultFakes.nextAddTotp = null;
  native.docs.delete(accounts.VAULT_ACCOUNTS_DOC);
  accounts.reloadVaultAccounts();
  calls.length = 0;
  store.clearVaultIndex();
  await store.loadVaultProviders();
  await store.loadAllVaultItems(true);
  return { tabId };
}

test("the submenu lists the site's logins that can hold a code, the QR's account first, never another site or a manager that can't store codes", () => {
  const items = [work, octo, proton, elsewhere];
  const providers = [manager("bitwarden"), manager("protonpass", "unlocked", false)];
  const menu = model.codeMenuModel({ origin: "https://github.com", account: "octo", providers, items, remembered: "bitwarden/gh2" });
  assert.deepEqual(menu, {
    logins: [
      { key: "bitwarden/gh", title: "octo · github.com" },
      { key: "bitwarden/gh2", title: "octo-work · github.com (Has Code)" },
    ],
    unlock: false,
    other: true,
    note: null,
  });
  const locked = model.codeMenuModel({ origin: "https://github.com", account: "", providers: [manager("bitwarden", "locked")], items, remembered: null });
  assert.deepEqual(locked, { logins: [], unlock: true, other: false, note: null });
  const none = model.codeMenuModel({ origin: "https://github.com", account: "", providers: [manager("protonpass", "unlocked", false)], items, remembered: null });
  assert.equal(none.note, model.CODE_NOTES.noManager);
  assert.equal(model.codeMenuModel({ origin: "http://github.com", account: "", providers, items, remembered: null }).note, model.CODE_NOTES.insecure);
  const empty = model.codeMenuModel({ origin: "https://example.com", account: "", providers, items, remembered: null });
  assert.deepEqual(empty, { logins: [], unlock: false, other: true, note: model.CODE_NOTES.noLogins });
});

test("the header shows the issuer and account from the code", () => {
  assert.equal(model.codeHeader({ issuer: "GitHub", account: "octo" }), "GitHub: octo");
  assert.equal(model.codeHeader({ issuer: "github.com", account: "github.com" }), "github.com");
  assert.equal(model.codeHeader({ issuer: "", account: "octo@example.com" }), "octo@example.com");
});

test("a found code sends its submenu with metadata only, and choosing a login without a code adds it with a toast", async () => {
  const { tabId } = await start();
  setup.noteVaultCode(tabId, found());
  await settle();
  const sent = lastMenu();
  assert.equal(sent.token, "t1");
  assert.deepEqual(sent.menu.logins.map((l) => l.key), ["bitwarden/gh", "bitwarden/gh2"]);
  assert.doesNotMatch(JSON.stringify(sent), /secret|otpauth/);
  setup.runVaultCodeAction(tabId, { frameId: "f1", origin: "https://github.com", token: "t1", action: "save", login: "bitwarden/gh" });
  await settle();
  await settle();
  assert.deepEqual(native.vaultFakes.addedTotps.map(({ provider, id, token }) => ({ provider, id, token })), [{ provider: "bitwarden", id: "gh", token: "t1" }]);
  assert.equal(toastOf(tabId), "Verification code added to octo");
});

test("a login that already has a code asks before replacing it, and No keeps the old one", async () => {
  const { tabId } = await start();
  const asked = [];
  await setup.saveCodeTo(tabId, found(), work, async (options) => (asked.push(options), { confirmed: false }));
  assert.equal(asked[0].title, "Replace the verification code for octo-work?");
  assert.equal(asked[0].confirmTitle, "Replace");
  assert.match(asked[0].message, /The one for GitHub: octo takes its place\./);
  assert.deepEqual(native.vaultFakes.addedTotps, []);
  await setup.saveCodeTo(tabId, found(), work, async () => ({ confirmed: true }));
  assert.equal(native.vaultFakes.addedTotps.length, 1);
  assert.equal(toastOf(tabId), "Verification code added to octo-work");
});

test("a failed save shows why, a declined owner check shows nothing, and a manager that can't store codes is refused before any call", async () => {
  const { tabId } = await start();
  native.vaultFakes.nextAddTotp = { added: false, error: "failed", message: "Bitwarden CLI: item is read-only" };
  await setup.saveCodeTo(tabId, found(), octo, async () => ({ confirmed: true }));
  assert.equal(toastOf(tabId), "Bitwarden CLI: item is read-only");
  native.vaultFakes.nextAddTotp = { added: false, error: "locked" };
  await setup.saveCodeTo(tabId, found({ token: "t2" }), octo);
  assert.equal(toastOf(tabId), "Bitwarden is locked. Unlock it and try again.");
  native.vaultFakes.nextAddTotp = { added: false, error: "expired" };
  await setup.saveCodeTo(tabId, found({ token: "t3" }), octo);
  assert.equal(toastOf(tabId), model.CODE_TEXT.expired);
  useToasts.setState({ toasts: {} });
  native.vaultFakes.nextAddTotp = { added: false, error: "declined" };
  await setup.saveCodeTo(tabId, found({ token: "t4" }), octo);
  assert.equal(toastOf(tabId), undefined);
  const before = native.vaultFakes.addedTotps.length;
  await setup.saveCodeTo(tabId, found({ token: "t5" }), proton);
  assert.equal(native.vaultFakes.addedTotps.length, before);
  assert.equal(toastOf(tabId), "Proton Pass can't store verification codes from Ardia.");
});

test("Other Logins opens the search under the image, and a pick there stores the code instead of filling", async () => {
  const { tabId } = await start();
  setup.noteVaultCode(tabId, found());
  setup.runVaultCodeAction(tabId, { frameId: "f1", origin: "https://github.com", token: "t1", action: "other" });
  const open = menu.vaultMenuOf(tabId);
  assert.equal(open.mode, "search");
  assert.deepEqual(open.rect, { x: 400, y: 300, width: 180, height: 180 });
  const row = menu.rowsOfMenu(open).find((r) => r.kind === "login" && r.item.id === "gl");
  activateVaultRow(tabId, row);
  await settle();
  await settle();
  assert.equal(calls.filter(([kind]) => kind === "fill").length, 0, "nothing is filled");
  assert.deepEqual(native.vaultFakes.addedTotps.map((a) => a.id), ["gl"]);
  assert.equal(menu.vaultMenuOf(tabId), null);
});

test("an action for another code, frame or origin is ignored", async () => {
  const { tabId } = await start();
  setup.noteVaultCode(tabId, found());
  setup.runVaultCodeAction(tabId, { frameId: "f1", origin: "https://github.com", token: "old", action: "save", login: "bitwarden/gh" });
  setup.runVaultCodeAction(tabId, { frameId: "f2", origin: "https://github.com", token: "t1", action: "save", login: "bitwarden/gh" });
  setup.runVaultCodeAction(tabId, { frameId: "f1", origin: "https://evil.example", token: "t1", action: "save", login: "bitwarden/gh" });
  await settle();
  assert.deepEqual(native.vaultFakes.addedTotps, []);
});

test("code setup is on only while a manager that can store codes is connected", () => {
  assert.equal(setup.codeSetupWanted([manager("bitwarden", "locked")]), true);
  assert.equal(setup.codeSetupWanted([manager("bitwarden", "signedOut")]), false);
  assert.equal(setup.codeSetupWanted([manager("protonpass", "unlocked", false)]), false);
});
