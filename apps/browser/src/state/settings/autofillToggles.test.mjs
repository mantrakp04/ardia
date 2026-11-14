import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { docs, profileToggles } from "../../test-native/index.ts";
import { autofillEnabled, autofillToggleAsked, passwordAutofill, setAutofillFor, setPasswordAutofillFor } from "./paneData.ts";
import { cached, load } from "./resources.ts";
import { keptByExtensionNote } from "../../components/settings/keptByExtension.ts";

const ASKED_DOC = "autofill-toggles-asked.json";
const asked = (profile, toggle) => load(autofillToggleAsked, [profile, toggle], { fresh: true });

beforeEach(() => {
  profileToggles.user.clear();
  profileToggles.extension.clear();
  docs.delete(ASKED_DOC);
});

test("a toggle an extension holds off shows off after it is turned on, and says why", async () => {
  const profile = "held";
  profileToggles.extension.set(profile, { passwords: false, addresses: false, cards: false });
  await load(passwordAutofill, [profile], { fresh: true });
  await load(autofillEnabled, [profile], { fresh: true });

  await setPasswordAutofillFor(profile, true);
  await setAutofillFor(profile, "addresses", true);
  await setAutofillFor(profile, "cards", true);

  assert.equal(cached(passwordAutofill, [profile]), false);
  assert.deepEqual(cached(autofillEnabled, [profile]), { addresses: false, cards: false });

  const reopened = await load(passwordAutofill, [profile], { fresh: true });
  assert.equal(reopened, false);
  assert.equal(await asked(profile, "passwords"), true);
  assert.match(keptByExtensionNote(reopened, await asked(profile, "passwords")) ?? "", /An extension keeps this off/);
});

test("what was asked for is read from the saved document, so the note is back after a relaunch", async () => {
  const profile = "relaunched";
  profileToggles.extension.set(profile, { passwords: false, cards: false });
  docs.set(ASKED_DOC, JSON.stringify({ profiles: { [profile]: { passwords: true, cards: true } }, version: 1 }));

  const value = await load(passwordAutofill, [profile], { fresh: true });
  const enabled = await load(autofillEnabled, [profile], { fresh: true });
  assert.match(keptByExtensionNote(value, await asked(profile, "passwords")) ?? "", /An extension keeps this off/);
  assert.match(keptByExtensionNote(enabled.cards, await asked(profile, "cards")) ?? "", /An extension keeps this off/);
  assert.equal(keptByExtensionNote(enabled.addresses, await asked(profile, "addresses")), undefined);
});

test("only a toggle that didn't take is saved, per profile and toggle", async () => {
  profileToggles.extension.set("held", { passwords: false });
  await setPasswordAutofillFor("held", true);
  await setPasswordAutofillFor("free", false);
  await setAutofillFor("held", "cards", false);
  assert.deepEqual(JSON.parse(docs.get(ASKED_DOC) ?? "{}").profiles, { held: { passwords: true } });
});

test("a toggle nobody holds keeps the value it was set to and shows no note", async () => {
  const profile = "free";
  await setPasswordAutofillFor(profile, false);
  await setAutofillFor(profile, "cards", false);
  assert.equal(await load(passwordAutofill, [profile], { fresh: true }), false);
  assert.deepEqual(await load(autofillEnabled, [profile], { fresh: true }), { addresses: true, cards: false });
  assert.equal(keptByExtensionNote(false, await asked(profile, "passwords")), undefined);
});

test("two profiles keep their own toggles, and an extension in one doesn't hold the other", async () => {
  profileToggles.extension.set("work", { passwords: false });
  await setPasswordAutofillFor("work", true);
  await setPasswordAutofillFor("home", true);
  await setAutofillFor("home", "addresses", false);

  assert.equal(await load(passwordAutofill, ["work"], { fresh: true }), false);
  assert.equal(await load(passwordAutofill, ["home"], { fresh: true }), true);
  assert.deepEqual(await load(autofillEnabled, ["work"], { fresh: true }), { addresses: true, cards: true });
  assert.deepEqual(await load(autofillEnabled, ["home"], { fresh: true }), { addresses: false, cards: true });
  assert.match(keptByExtensionNote(false, await asked("work", "passwords")) ?? "", /An extension keeps this off/);
  assert.equal(keptByExtensionNote(true, await asked("home", "passwords")), undefined);
});

test("the note goes once the extension lets go", async () => {
  const profile = "released";
  profileToggles.extension.set(profile, { passwords: false });
  await setPasswordAutofillFor(profile, true);
  profileToggles.extension.clear();
  const now = await load(passwordAutofill, [profile], { fresh: true });
  assert.equal(now, true);
  assert.equal(keptByExtensionNote(now, await asked(profile, "passwords")), undefined);
});
