import assert from "node:assert/strict";
import { test } from "node:test";

const native = await import("../../test-native/index.ts");
const { generatedFakes, resetGeneratedFakes } = await import("../../test-native/vaultGenerated.ts");
const { useBrowser } = await import("../browser/store.ts");
const { webviews } = await import("../../platform/webviews.ts");
const { SETTING_SPECS, parseSettings } = await import("../settings/settings.ts");
const store = await import("./store.ts");
const generated = await import("./generated.ts");
const { menuRows } = await import("./menuModel.ts");
const { generatedFillTarget, fillGeneratedNow } = await import("./generatedFill.ts");
const { useVaultMenus } = await import("./menu.ts");
const offers = await import("./saveOffer.ts");
const suggestions = await import("./usernameSuggestions.ts");
const { passwordLetsSave, stageOfferPassword } = await import("./savePassword.ts");

const S = () => useBrowser.getState();
const DAY = generated.DAY_MS;
const NOW = Date.UTC(2026, 10, 10, 12);
const caps = { totp: true, save: true, selfHosted: true, masterPassword: true, touchID: false };
const manager = (id, state = "unlocked", save = true) => ({ id, name: id === "bitwarden" ? "Bitwarden" : id, state, capabilities: { ...caps, save }, install: { command: "", url: "" } });
const entry = (id, origin, createdAt, username = "", password = `pw-${id}`) => ({ id, origin, username, createdAt, submitted: false, password });
const meta = ({ password: _secret, ...rest }) => rest;

async function setup({ providers = [manager("bitwarden")], entries = [] } = {}) {
  S().hydrate({});
  const w = S().createWindow({ url: "https://signup.example.com/join" });
  const tabId = S().windows[w].tabIds[0];
  native.vaultFakes.providers = providers;
  native.vaultFakes.items = [];
  resetGeneratedFakes();
  generatedFakes.entries = entries;
  S().updateSettings({ vaultSaveOffer: true, vaultAutoSave: true, vaultSaveTarget: "", vaultKeepGenerated: 7 });
  store.clearVaultIndex();
  await store.loadVaultProviders();
  await store.loadAllVaultItems(true);
  await generated.loadGeneratedPasswords();
  return { w, tabId };
}

test("Keep Generated Passwords offers 1, 7 and 30 days, Until Deleted and Never, and defaults to 7 days", () => {
  assert.deepEqual(generated.KEEP_GENERATED_OPTIONS, [
    { value: "1", title: "1 Day" },
    { value: "7", title: "7 Days" },
    { value: "30", title: "30 Days" },
    { value: "-1", title: "Until Deleted" },
    { value: "0", title: "Never" },
  ]);
  assert.equal(SETTING_SPECS.vaultKeepGenerated.default, 7);
  assert.equal(parseSettings({ vaultKeepGenerated: 30 }).vaultKeepGenerated, 30);
  assert.equal(parseSettings({ vaultKeepGenerated: 5 }).vaultKeepGenerated, 7, "a value that isn't an option falls back");
  assert.equal(parseSettings({ vaultKeepGenerated: "7" }).vaultKeepGenerated, 7);
});

test("a password expires once it's as old as the retention, never with Until Deleted, and at once with Never", () => {
  const made = NOW - 7 * DAY;
  assert.equal(generated.isGeneratedExpired(made, 7, NOW), true);
  assert.equal(generated.isGeneratedExpired(made + 1, 7, NOW), false);
  assert.equal(generated.isGeneratedExpired(NOW - DAY + 1, 1, NOW), false);
  assert.equal(generated.isGeneratedExpired(NOW - DAY, 1, NOW), true);
  assert.equal(generated.isGeneratedExpired(NOW - 10_000 * DAY, generated.KEEP_FOREVER, NOW), false);
  assert.equal(generated.isGeneratedExpired(NOW, generated.KEEP_NONE, NOW), true);
});

test("kept passwords list newest first and leave out the expired ones", () => {
  const list = [entry("old", "https://a.test", NOW - 8 * DAY), entry("mid", "https://b.test", NOW - 2 * DAY), entry("new", "https://c.test", NOW - 60_000)].map(meta);
  assert.deepEqual(generated.keptGenerated(list, 7, NOW).map((e) => e.id), ["new", "mid"]);
  assert.deepEqual(generated.keptGenerated(list, 1, NOW).map((e) => e.id), ["new"]);
  assert.deepEqual(generated.keptGenerated(list, generated.KEEP_FOREVER, NOW).map((e) => e.id), ["new", "mid", "old"]);
  assert.deepEqual(generated.keptGenerated(list, generated.KEEP_NONE, NOW), []);
});

test("JS only ever sees metadata, never the password", async () => {
  await setup({ entries: [entry("g1", "https://signup.example.com", Date.now(), "", "Secret-Value-1")] });
  const [kept] = generated.currentGeneratedPasswords();
  assert.deepEqual(Object.keys(kept).sort(), ["createdAt", "id", "origin", "submitted", "username"]);
  assert.ok(!JSON.stringify(generated.useGeneratedPasswords.getState()).includes("Secret-Value-1"));
});

test("Other Passwords… lists generated passwords first, searchable by site and username", async () => {
  await setup({ entries: [entry("g1", "https://signup.example.com", Date.now() - 1000, "me@example.com"), entry("g2", "https://other.test", Date.now())] });
  native.vaultFakes.items = [{ provider: "bitwarden", id: "b1", title: "Example", username: "saved", urls: ["https://example.com"], hasTotp: false }];
  await store.loadAllVaultItems(true);
  const base = { field: "password", mode: "search", origin: "https://signup.example.com", providers: store.currentVaultProviders(), items: store.allVaultItems(), pending: null, noTotp: new Set() };
  const all = menuRows({ ...base, query: "", generated: generated.searchGenerated(generated.currentGeneratedPasswords(), "", 100) });
  assert.deepEqual(all.map((r) => r.item?.id), ["g2", "g1", "b1"]);
  assert.ok(all.slice(0, 2).every((r) => r.kind === "login" && r.item.provider === generated.GENERATED_PROVIDER && r.userChose));
  const found = menuRows({ ...base, query: "me@example", generated: generated.searchGenerated(generated.currentGeneratedPasswords(), "me@example", 100) });
  assert.deepEqual(found.map((r) => r.item.id), ["g1"]);
  const matches = menuRows({ ...base, mode: "matches", query: "", generated: generated.searchGenerated(generated.currentGeneratedPasswords(), "", 100) });
  assert.ok(!matches.some((r) => r.item?.provider === generated.GENERATED_PROVIDER), "only the search lists them");
});

test("Save to a manager moves the password there and takes it off the list", async () => {
  await setup({ entries: [entry("g1", "https://signup.example.com", Date.now(), "new@example.com")] });
  const result = await generated.saveGenerated("g1", "bitwarden", null);
  assert.equal(result.saved, true);
  assert.deepEqual(generatedFakes.saves, [{ id: "g1", provider: "bitwarden" }]);
  assert.deepEqual(generated.currentGeneratedPasswords(), []);
  await generated.loadGeneratedPasswords();
  assert.deepEqual(generated.currentGeneratedPasswords(), [], "native no longer lists it either");
});

test("an entry with no username asks for one before saving, and saves with what's typed", async () => {
  await setup({ entries: [entry("g1", "https://signup.example.com", Date.now())] });
  assert.deepEqual(await generated.saveGenerated("g1", "bitwarden", "  "), { saved: false, error: generated.NEEDS_USERNAME });
  assert.deepEqual(generatedFakes.saves, [], "nothing reached native");
  const result = await generated.saveGenerated("g1", "bitwarden", " me@example.com ");
  assert.equal(result.saved, true);
  assert.deepEqual(generatedFakes.saves, [{ id: "g1", provider: "bitwarden", username: "me@example.com" }]);
});

test("a failed save keeps the password in the list", async () => {
  await setup({ entries: [entry("g1", "https://signup.example.com", Date.now(), "me@example.com")] });
  generatedFakes.nextSave = { saved: false, error: "locked" };
  assert.equal((await generated.saveGenerated("g1", "bitwarden", null)).saved, false);
  assert.deepEqual(generated.currentGeneratedPasswords().map((e) => e.id), ["g1"]);
});

test("Save to lists only unlocked managers that can save", async () => {
  await setup({ providers: [manager("bitwarden"), manager("1password", "locked"), manager("protonpass", "unlocked", false)] });
  assert.deepEqual(generated.generatedSaveTargets(store.currentVaultProviders()), ["bitwarden"]);
});

test("copy and delete go through native by id", async () => {
  await setup({ entries: [entry("g1", "https://signup.example.com", Date.now())] });
  assert.equal(await generated.copyGenerated("g1"), "copied");
  assert.deepEqual(generatedFakes.copies, ["g1"]);
  assert.equal(await generated.copyGenerated("missing"), "notFound");
  assert.equal(await generated.deleteGenerated("g1"), true);
  assert.deepEqual(generated.currentGeneratedPasswords(), []);
});

test("the retention setting reaches native and Never empties the list", async () => {
  await setup({ entries: [entry("g1", "https://signup.example.com", Date.now() - 2 * DAY)] });
  const { startNativeSettings } = await import("../settings/nativeSettings.ts");
  const stop = startNativeSettings();
  S().updateSettings({ vaultKeepGenerated: 1 });
  assert.equal(generatedFakes.days, 1);
  assert.deepEqual(generated.currentGeneratedPasswords(), [], "a 2-day-old password is past a 1-day retention");
  S().updateSettings({ vaultKeepGenerated: generated.KEEP_FOREVER });
  assert.deepEqual(generated.currentGeneratedPasswords().map((e) => e.id), ["g1"]);
  S().updateSettings({ vaultKeepGenerated: generated.KEEP_NONE });
  assert.equal(generatedFakes.days, 0);
  assert.deepEqual(generated.currentGeneratedPasswords(), []);
  stop();
});

test("Fill is offered only when the active tab's last login field is on the same site", async () => {
  const { tabId } = await setup({ entries: [entry("g1", "https://signup.example.com", Date.now())] });
  const fills = [];
  webviews.set(tabId, { fillFromVault: async (r) => (fills.push(r), { filled: ["password"] }) });
  const field = { frameId: "f1", origin: "https://login.example.com", main: true, kind: "password", focused: true, rect: null, at: 1 };
  useVaultMenus.setState((s) => ({ ...s, fields: { [tabId]: field } }));
  const target = generatedFillTarget(S(), useVaultMenus.getState().fields, "https://signup.example.com");
  assert.deepEqual(target, { tabId, frameId: "f1", origin: "https://login.example.com" });
  assert.equal(generatedFillTarget(S(), useVaultMenus.getState().fields, "https://elsewhere.test"), null);
  assert.equal(await fillGeneratedNow({ id: "g1", origin: "https://signup.example.com" }), "filled");
  assert.deepEqual(fills, [{ frameId: "f1", origin: "https://login.example.com", provider: "generated", id: "g1", fields: ["username", "password"], userChose: true, submit: false }]);
  useVaultMenus.setState((s) => ({ ...s, fields: {} }));
  webviews.delete(tabId);
});

const submitted = (over = {}) => ({ frameId: "f1", origin: "https://signup.example.com", username: "", usernameFrom: "", trusted: true, newPassword: false, generated: false, ...over });
const offerOf = (tabId) => offers.useVaultSaveOffers.getState()[tabId] ?? null;

test("a sign-up with a new password and no username shows the save popover asking for one", async () => {
  const { tabId } = await setup();
  const saves = [];
  webviews.set(tabId, { saveToVault: async (r) => (saves.push(r), { saved: true }), discardVaultCapture: async () => {} });
  await offers.noteVaultSubmitted(tabId, submitted({ newPassword: true }));
  const offer = offerOf(tabId);
  assert.equal(offer?.needsUsername, true);
  assert.equal(offer.editing, true);
  assert.deepEqual(saves, [], "nothing saves without a username");
  offers.dismissVaultOffer(tabId);
  await offers.noteVaultSubmitted(tabId, submitted({ generated: true }));
  assert.equal(offerOf(tabId)?.needsUsername, true, "a generated password asks the same way");
  offers.dismissVaultOffer(tabId);
  webviews.delete(tabId);
});

test("with no manager able to save, there's no popover; the generated password stays in the list", async () => {
  const { tabId } = await setup({ providers: [manager("bitwarden", "locked")], entries: [entry("g1", "https://signup.example.com", Date.now())] });
  webviews.set(tabId, { saveToVault: async () => ({ saved: true }), discardVaultCapture: async () => {} });
  await offers.noteVaultSubmitted(tabId, submitted({ generated: true }));
  assert.equal(offerOf(tabId), null);
  assert.deepEqual(generated.currentGeneratedPasswords().map((e) => e.id), ["g1"]);
  webviews.delete(tabId);
});

test("username suggestions complete what's typed, best first, and the best one fills an empty field", () => {
  const items = [
    { provider: "bitwarden", id: "1", title: "", username: "handle", urls: [], updatedAt: 3 },
    { provider: "bitwarden", id: "2", title: "", username: "me@example.com", urls: [], updatedAt: 2 },
    { provider: "bitwarden", id: "3", title: "", username: "me@example.com", urls: [], updatedAt: 1 },
    { provider: "bitwarden", id: "4", title: "", username: "work@corp.test", urls: [], updatedAt: 4 },
  ];
  const ranked = suggestions.rankedUsernames(items, true);
  assert.equal(ranked[0], "me@example.com", "used most, and an email");
  assert.equal(suggestions.prefilledUsername("", ranked), "me@example.com");
  assert.equal(suggestions.prefilledUsername("typed", ranked), "typed");
  assert.deepEqual(suggestions.usernameCompletions(ranked, "me"), ["me@example.com"]);
  assert.deepEqual(suggestions.usernameCompletions(ranked, "me@example.com"), [], "an exact match needs no completion");
  assert.deepEqual(suggestions.usernameCompletions(["xme", "me@a.test"], "me"), ["me@a.test", "xme"], "prefix matches first");
  assert.equal(suggestions.usernameCompletions(ranked, "").length, Math.min(ranked.length, suggestions.MAX_USERNAME_SUGGESTIONS));
  assert.equal(suggestions.stepCompletion(-1, 3, "down"), 0);
  assert.equal(suggestions.stepCompletion(2, 3, "down"), 0);
  assert.equal(suggestions.stepCompletion(-1, 3, "up"), 2);
  assert.equal(suggestions.stepCompletion(0, 0, "down"), -1);
});

test("the popover's password comes from native as a draft token, and an emptied field can't save", async () => {
  const { tabId } = await setup();
  webviews.set(tabId, { stageVaultPassword: async ({ origin }) => ({ token: origin ? "draft-1" : "", length: 20 }) });
  assert.deepEqual(await stageOfferPassword(tabId, "https://signup.example.com"), { token: "draft-1", length: 20 });
  assert.deepEqual(await stageOfferPassword("no-such-tab", "https://signup.example.com"), { token: "", length: 0 });
  assert.equal(passwordLetsSave(null), true);
  assert.equal(passwordLetsSave(12), true);
  assert.equal(passwordLetsSave(0), false);
  webviews.delete(tabId);
});
