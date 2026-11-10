import assert from "node:assert/strict";
import { test } from "node:test";
const native = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { webviews } = await import("../../platform/webviews.ts");
const store = await import("./store.ts");
const menu = await import("./menu.ts");
const accounts = await import("./accounts.ts");
const { activateVaultRow } = await import("./fill.ts");
const { rowsOfMenu } = menu;
const context = await import("./contextFill.ts");

const S = () => useBrowser.getState();
const caps = { totp: true, save: true, selfHosted: true, masterPassword: true, touchID: false };
const provider = (state) => ({ id: "bitwarden", name: "Bitwarden", state, capabilities: caps, install: { command: "", url: "" } });
const login = { provider: "bitwarden", id: "gh", title: "GitHub", username: "octo", urls: ["https://github.com"], hasTotp: true };
const calls = [];
const handle = {
  setVaultMenu: async (r) => void calls.push(["menu", r.open]),
  setVaultContextMenu: async (r) => void calls.push(["contextMenu", r]),
  fillFromVault: async (r) => (calls.push(["fill", r]), { filled: r.fields.map((f) => (f === "totp" ? "otp" : f)) }),
  fillGeneratedPassword: async (r) => (calls.push(["generate", r]), { filled: ["newPassword"] }),
  discardVaultCapture: async () => undefined,
  focus: async () => undefined,
};
const plain = (over = {}) => ({ frameId: "f1", origin: "https://github.com", main: true, kind: null, guess: "username", rect: { x: 10, y: 100, width: 240, height: 28 }, maxLength: 0, ...over });
const settle = () => new Promise((r) => setTimeout(r, 0));

async function setup(state = "unlocked") {
  S().hydrate({});
  const w = S().createWindow({ url: "https://github.com/settings" });
  const tabId = S().windows[w].tabIds[0];
  webviews.set(tabId, handle);
  native.vaultFakes.providers = [provider(state)];
  native.vaultFakes.items = [login];
  native.docs.delete(accounts.VAULT_ACCOUNTS_DOC);
  accounts.reloadVaultAccounts();
  calls.length = 0;
  store.clearVaultIndex();
  await store.loadVaultProviders();
  await store.loadAllVaultItems(true);
  return { tabId };
}

test("a right-clicked input gets the site's logins as the Autofill submenu, metadata only", async () => {
  const { tabId } = await setup();
  context.noteVaultContext(tabId, plain());
  await settle();
  const sent = calls.filter(([kind]) => kind === "contextMenu").at(-1)[1];
  assert.equal(sent.frameId, "f1");
  assert.equal(sent.origin, "https://github.com");
  assert.deepEqual(sent.menu, { logins: [{ key: "bitwarden/gh", title: "octo · github.com", fields: ["username", "password", "otp"] }], unlock: false, other: true, note: null });
  assert.doesNotMatch(JSON.stringify(sent), /password"\s*:\s*"/, "no secret is ever in the list");
});

test("choosing Password fills that one value into the right-clicked input as the person's choice, never submitting", async () => {
  const { tabId } = await setup();
  context.noteVaultContext(tabId, plain());
  context.runVaultContextAction(tabId, { frameId: "f1", origin: "https://github.com", action: "fill", login: "bitwarden/gh", field: "password" });
  await settle();
  const fill = calls.find(([kind]) => kind === "fill")[1];
  assert.deepEqual(fill, { frameId: "f1", origin: "https://github.com", provider: "bitwarden", id: "gh", fields: ["password"], userChose: true, submit: false, target: "contextMenu" });
  context.runVaultContextAction(tabId, { frameId: "f1", origin: "https://github.com", action: "fill", login: "bitwarden/gh", field: "otp" });
  await settle();
  assert.deepEqual(calls.filter(([kind]) => kind === "fill").at(-1)[1].fields, ["totp"]);
});

test("an action for another frame or origin than the right-clicked field does nothing", async () => {
  const { tabId } = await setup();
  context.noteVaultContext(tabId, plain());
  context.runVaultContextAction(tabId, { frameId: "f2", origin: "https://github.com", action: "fill", login: "bitwarden/gh", field: "password" });
  context.runVaultContextAction(tabId, { frameId: "f1", origin: "https://evil.example", action: "fill", login: "bitwarden/gh", field: "password" });
  await settle();
  assert.equal(calls.filter(([kind]) => kind === "fill").length, 0);
});

test("Generate Password fills the chosen style into the right-clicked input, within its maxlength", async () => {
  const { tabId } = await setup();
  context.noteVaultContext(tabId, plain({ guess: "password", maxLength: 16 }));
  context.runVaultContextAction(tabId, { frameId: "f1", origin: "https://github.com", action: "generate", style: "passphrase" });
  await settle();
  assert.deepEqual(calls.find(([kind]) => kind === "generate")[1], { frameId: "f1", origin: "https://github.com", style: "passphrase", target: "contextMenu", maxLength: 16 });
});

test("Other Passwords opens the search under the field, and a pick fills only the guessed value into it", async () => {
  const { tabId } = await setup();
  context.noteVaultContext(tabId, plain());
  context.runVaultContextAction(tabId, { frameId: "f1", origin: "https://github.com", action: "other" });
  const open = menu.vaultMenuOf(tabId);
  assert.equal(open?.mode, "search");
  assert.equal(open?.frameId, "f1");
  const row = rowsOfMenu(open).find((r) => r.kind === "login");
  activateVaultRow(tabId, row);
  await settle();
  const fill = calls.filter(([kind]) => kind === "fill").at(-1)[1];
  assert.deepEqual(fill.fields, ["username"]);
  assert.equal(fill.target, "contextMenu");
  assert.equal(fill.submit, false);
});

test("on a classified login field the pick fills the whole login around it", async () => {
  const { tabId } = await setup();
  context.noteVaultContext(tabId, plain({ frameId: "f3", kind: "password", guess: "password" }));
  context.runVaultContextAction(tabId, { frameId: "f3", origin: "https://github.com", action: "other" });
  const row = rowsOfMenu(menu.vaultMenuOf(tabId)).find((r) => r.kind === "login");
  activateVaultRow(tabId, row);
  await settle();
  assert.deepEqual(calls.filter(([kind]) => kind === "fill").at(-1)[1].fields, ["username", "password"]);
});

test("with the managers locked the list offers Unlock Passwords, which unlocks and then opens the picker", async () => {
  const { tabId } = await setup("locked");
  context.noteVaultContext(tabId, plain());
  await settle();
  assert.deepEqual(calls.filter(([kind]) => kind === "contextMenu").at(-1)[1].menu, { logins: [], unlock: true, other: false, note: null });
  native.vaultFakes.providers = [provider("unlocked")];
  context.runVaultContextAction(tabId, { frameId: "f1", origin: "https://github.com", action: "unlock" });
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(menu.vaultMenuOf(tabId)?.mode, "matches");
  assert.ok(rowsOfMenu(menu.vaultMenuOf(tabId)).some((r) => r.kind === "login"));
});
