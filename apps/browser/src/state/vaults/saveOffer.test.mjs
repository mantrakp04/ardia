import assert from "node:assert/strict";
import { test } from "node:test";

const { chooseSaveTarget, decideSave, saveTargets, vaultClaimsPasswordPrompt } = await import("./saveOffer.ts");

const caps = (save) => ({ totp: true, save, selfHosted: false, masterPassword: false, touchID: false });
const provider = (id, state = "unlocked", save = true) => ({ id, name: id, state, capabilities: caps(save), install: { command: "", url: "" } });
const item = (provider, username, urls = ["https://example.com"]) => ({ provider, id: `${provider}-${username}`, title: "Example", username, urls, hasTotp: false });
const input = (over = {}) => ({ enabled: true, origin: "https://example.com", username: "me@example.com", providers: [provider("bitwarden")], items: [], preferred: "", ...over });

test("no offer when the login is already in a connected manager, whatever the case of the username", () => {
  assert.deepEqual(decideSave(input({ items: [item("bitwarden", "Me@Example.COM")] })), { offer: false, alreadySaved: true });
  assert.deepEqual(decideSave(input({ origin: "https://login.example.com", items: [item("bitwarden", "me@example.com")] })), { offer: false, alreadySaved: true });
});

test("no offer when it's turned off, the page isn't secure, or nothing unlocked can save", () => {
  assert.equal(decideSave(input({ enabled: false })).offer, false);
  assert.equal(decideSave(input({ origin: "http://example.com" })).offer, false);
  assert.equal(decideSave(input({ providers: [provider("bitwarden", "locked")] })).offer, false);
  assert.equal(decideSave(input({ providers: [provider("onepassword", "unlocked", false)] })).offer, false);
  assert.equal(decideSave(input({ providers: [] })).offer, false);
});

test("an item in a locked manager doesn't count as saved", () => {
  const decision = decideSave(input({ providers: [provider("bitwarden"), provider("1password", "locked")], items: [item("1password", "me@example.com")] }));
  assert.equal(decision.offer, true);
});

test("a different username or another site gets the offer", () => {
  assert.equal(decideSave(input({ items: [item("bitwarden", "other@example.com")] })).offer, true);
  assert.equal(decideSave(input({ items: [item("bitwarden", "me@example.com", ["https://example.org"])] })).offer, true);
});

test("a chosen manager takes every offer; otherwise the person picks, starting with the first", () => {
  const providers = [provider("1password"), provider("bitwarden"), provider("protonpass", "locked")];
  assert.deepEqual(saveTargets(providers), ["1password", "bitwarden"]);
  assert.deepEqual(decideSave(input({ providers, preferred: "bitwarden" })), { offer: true, targets: ["bitwarden"], target: "bitwarden" });
  assert.deepEqual(decideSave(input({ providers })), { offer: true, targets: ["1password", "bitwarden"], target: "1password" });
  assert.equal(decideSave(input({ providers, preferred: "protonpass" })).target, "1password");
  assert.equal(chooseSaveTarget([], "x"), "");
});

test("Chrome's prompt stays for tabs and sites the managers didn't claim", () => {
  assert.equal(vaultClaimsPasswordPrompt("no-such-tab", { origin: "https://example.com", state: "save" }), false);
});
