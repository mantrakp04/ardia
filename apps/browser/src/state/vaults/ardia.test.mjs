import assert from "node:assert/strict";
import { test } from "node:test";

const native = await import("../../test-native/index.ts");
const { generatedFakes, resetGeneratedFakes } = await import("../../test-native/vaultGenerated.ts");
const { useBrowser } = await import("../browser/store.ts");
const { webviews } = await import("../../platform/webviews.ts");
const { pageOf } = await import("../tabs/pageState.ts");
const { showPasswordPrompt } = await import("../site/prompts.ts");
const store = await import("./store.ts");
const menu = await import("./menu.ts");
const { noteVaultKey } = await import("./fill.ts");
const offers = await import("./saveOffer.ts");
const generated = await import("./generated.ts");
const ardia = await import("./ardia.ts");
const { menuRows } = await import("./menuModel.ts");

const S = () => useBrowser.getState();
const caps = { totp: true, save: true, selfHosted: false, masterPassword: false, touchID: false, addTotp: true };
const manager = (id, state = "unlocked", name = id) => ({ id, name, state, capabilities: caps, install: { command: "", url: "" } });
const ARDIA = manager("ardia", "unlocked", "Ardia");
const ardiaLogin = (id, profile, over = {}) => ({ provider: "ardia", id, title: "github.com", username: "octo", urls: ["https://github.com"], hasTotp: false, profile, ...over });
const field = (over = {}) => ({ frameId: "f1", origin: "https://github.com", main: true, kind: "password", focused: true, rect: { x: 10, y: 100, width: 240, height: 28 }, formHasPassword: true, ...over });
const settle = () => new Promise((r) => setTimeout(r, 0));
const calls = [];
const handle = {
  setVaultMenu: async () => {},
  fillFromVault: async (r) => (calls.push(["fill", r]), { filled: r.fields.includes("totp") ? ["otp"] : ["username", "password"] }),
  saveToVault: async (r) => (calls.push(["save", r]), { saved: true, item: ardiaLogin("new", "") }),
  discardVaultCapture: async () => {},
  focus: async () => {},
};

async function setup({ providers = [ARDIA, manager("bitwarden", "signedOut")], items = [ardiaLogin("mine", ""), ardiaLogin("work", "work")], target = "" } = {}) {
  S().hydrate({});
  const w = S().createWindow({ url: "https://github.com/login" });
  const tabId = S().windows[w].tabIds[0];
  webviews.set(tabId, handle);
  native.vaultFakes.providers = providers;
  native.vaultFakes.items = items;
  resetGeneratedFakes();
  S().updateSettings({ vaultSuggestOnFocus: true, vaultSaveOffer: true, vaultAutoSave: true, vaultSaveTarget: target, vaultKeepGenerated: 7 });
  calls.length = 0;
  store.clearVaultIndex();
  await store.loadVaultProviders();
  await store.loadAllVaultItems(true);
  return { tabId };
}

const loginIds = (rows) => rows.flatMap((r) => (r.kind === "login" || r.kind === "otp" ? [`${r.kind}:${r.item.id}`] : []));

test("Ardia's logins fill from the menu like any manager's, only in the tab's own profile", async () => {
  const { tabId } = await setup();
  assert.equal(ardia.passwordProfileOfTab(tabId), "");
  menu.noteVaultField(tabId, field());
  await settle();
  const opened = menu.vaultMenuOf(tabId);
  assert.equal(opened?.profile, "");
  assert.deepEqual(loginIds(menu.rowsOfMenu(opened)), ["login:mine"], "the work profile's login stays out");
  noteVaultKey(tabId, { frameId: "f1", key: "Enter" });
  await settle();
  const fill = calls.find((c) => c[0] === "fill")?.[1];
  assert.deepEqual({ provider: fill?.provider, id: fill?.id, fields: fill?.fields }, { provider: "ardia", id: "mine", fields: ["username", "password"] });
  webviews.delete(tabId);
});

test("an Ardia login with a kept code gets a code row; one without doesn't", () => {
  const base = { field: "otp", mode: "matches", origin: "https://github.com", query: "", providers: [ARDIA], pending: null, noTotp: new Set() };
  assert.deepEqual(loginIds(menuRows({ ...base, items: [ardiaLogin("coded", "", { hasTotp: true })] })), ["otp:coded"]);
  assert.deepEqual(loginIds(menuRows({ ...base, items: [ardiaLogin("plain", "")] })), []);
  const scoped = ardia.itemsForProfile([ardiaLogin("a", ""), ardiaLogin("b", "work"), { provider: "bitwarden", id: "c" }], "");
  assert.deepEqual(scoped.map((i) => i.id), ["a", "c"], "other managers' logins aren't per profile");
  assert.deepEqual(ardia.itemsForProfile([ardiaLogin("a", "")], null).length, 0, "no profile, no Ardia logins");
});

test("Save New Logins To can pick Ardia; with no choice the one connected manager wins, else Ardia", () => {
  const bitwarden = manager("bitwarden");
  assert.deepEqual(offers.connectedSavers([ARDIA, bitwarden]).map((p) => p.id), ["ardia", "bitwarden"]);
  assert.equal(offers.preferredSaveTarget([ARDIA, bitwarden], ""), "bitwarden", "a connected manager keeps saving like before");
  assert.equal(offers.preferredSaveTarget([ARDIA, manager("bitwarden", "signedOut")], ""), "ardia");
  assert.equal(offers.preferredSaveTarget([ARDIA, bitwarden, manager("1password")], ""), "", "two managers ask");
  assert.equal(offers.preferredSaveTarget([ARDIA, bitwarden], "ardia"), "ardia");
  const decision = offers.decideSave({ enabled: true, origin: "https://github.com", username: "new", providers: [ARDIA], items: [], preferred: "" });
  assert.deepEqual(decision, { offer: true, targets: ["ardia"], target: "ardia" });
});

test("a generated password saves into Ardia on its own, and Chrome's own save prompt stays hidden", async () => {
  const { tabId } = await setup();
  await offers.noteVaultSubmitted(tabId, { frameId: "f1", origin: "https://github.com", username: "new@example.com", usernameFrom: "form", trusted: true, newPassword: true, generated: true });
  const save = calls.find((c) => c[0] === "save")?.[1];
  assert.equal(save?.provider, "ardia");
  showPasswordPrompt(tabId, { state: "save", origin: "https://github.com", username: "new@example.com", passwordLength: 20, federation: "", usernames: [] });
  assert.equal(pageOf(tabId).passwordPrompt, null);
  webviews.delete(tabId);
});

test("Generated Passwords' Save always asks, every connected manager listed with the sensible default first", async () => {
  const bitwarden = manager("bitwarden");
  assert.deepEqual(generated.generatedSaveTargets([ARDIA]), ["ardia"]);
  assert.deepEqual(generated.generatedSaveTargets([ARDIA, bitwarden]), ["bitwarden", "ardia"]);
  assert.deepEqual(generated.generatedSaveTargets([ARDIA, bitwarden, manager("1password")]), ["ardia", "bitwarden", "1password"]);
  assert.deepEqual(generated.generatedSaveTargets([ARDIA, bitwarden], "ardia"), ["ardia", "bitwarden"]);
  assert.deepEqual(generated.generatedSaveTargets([manager("bitwarden", "locked")]), []);
  const items = generated.generatedSaveMenu(["bitwarden", "ardia"], (id) => (id === "ardia" ? "Ardia" : "Bitwarden"));
  assert.deepEqual(items, [
    { id: "bitwarden", title: "Save to Bitwarden", checked: true },
    { id: "ardia", title: "Save to Ardia", checked: false },
  ]);
  await setup({ providers: [ARDIA] });
  generatedFakes.entries = [{ id: "g1", origin: "https://github.com", username: "me@example.com", createdAt: Date.now(), submitted: true, password: "pw" }];
  await generated.loadGeneratedPasswords();
  const result = await generated.saveGenerated("g1", "ardia", null, "work");
  assert.equal(result.saved, true);
  assert.deepEqual(generatedFakes.saves, [{ id: "g1", provider: "ardia", profile: "work" }], "Ardia saves into the profile shown in Settings");
});

test("Settings lists Ardia once, as its own row and its own saved passwords", () => {
  assert.deepEqual(ardia.passwordManagersOnly([ARDIA, manager("bitwarden")]).map((p) => p.id), ["bitwarden"]);
  assert.deepEqual(ardia.managerItemsOnly([ardiaLogin("a", ""), { provider: "bitwarden", id: "b" }]).map((i) => i.id), ["b"]);
});
