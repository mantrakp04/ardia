import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { decodeSetupCode, describeSetupChoices, encodeSetupCode, SETUP_CODE_ERRORS, SETUP_CODE_MAX_INPUT, SETUP_CODE_MAX_LENGTH, SETUP_CODE_PREFIX, SETUP_PIN_SITES, SETUP_SETTING_KEYS } =
  await import("./setupCode.ts");
const { PINNABLE_SITES } = await import("../onboarding/sites.ts");

const ARC = {
  preset: "arc",
  settings: {
    tabLayout: "sidebar",
    addressBar: "sidebar",
    commandBarPlacement: "centred",
    newTabOpens: "commandBar",
    newTabPosition: "top",
    newTabButtonPosition: "top",
    cleanUpInactiveTabsAfterMinutes: 720,
    restoreSession: true,
    shareTabsAcrossWindows: true,
    balancedTopApps: true,
    peekModifier: "shift",
    undoReopensClosedTab: false,
    cmdClickCreatesTabGroup: true,
    appearance: "dark",
    extendWebsiteColor: false,
    hideToolbarWhileScrolling: true,
    bookmarksBar: "never",
  },
  color: "green",
  pins: ["gmail", "github", "spotify"],
};

test("a full set of choices survives a round trip in a short code", () => {
  const code = encodeSetupCode(ARC);
  assert.ok(code.startsWith(SETUP_CODE_PREFIX));
  assert.ok(code.length < 64, `${code} is ${code.length} characters`);
  assert.match(code, /^[a-z0-9-]+$/);
  assert.deepEqual(decodeSetupCode(code), { ok: true, choices: ARC });
});

test("every onboarding layout, look and tab key is in the code, and nothing private is", () => {
  assert.deepEqual([...SETUP_SETTING_KEYS].sort(), Object.keys(ARC.settings).sort());
  for (const key of ["searchEngine", "commandBarPreference", "customSearchUrl", "openLinksInLittleArdia", "shortcuts", "mutedSites"]) {
    assert.ok(!SETUP_SETTING_KEYS.includes(key), `${key} stays out of setup codes`);
  }
});

test("pins are ids from the fixed list only, in a stable order", () => {
  assert.deepEqual(
    PINNABLE_SITES.map((s) => s.id).filter((id) => !SETUP_PIN_SITES.includes(id)),
    [],
    "a new pinnable site needs a slot at the end of SETUP_PIN_SITES",
  );
  const code = encodeSetupCode({ settings: {}, pins: ["https://evil.example/", "youtube", "<b>x</b>", "gmail"] });
  assert.deepEqual(decodeSetupCode(code), { ok: true, choices: { settings: {}, pins: ["gmail", "youtube"] } });
});

test("pasted codes forgive spaces, line breaks and capitals", () => {
  const code = encodeSetupCode(ARC);
  const messy = `  ${code.slice(0, 20).toUpperCase()}\n ${code.slice(20)}  `;
  assert.deepEqual(decodeSetupCode(messy), { ok: true, choices: ARC });
});

test("a huge paste is refused before it is cleaned up, even with a valid code inside", () => {
  const code = encodeSetupCode(ARC);
  assert.deepEqual(decodeSetupCode(" ".repeat(16 * 1024 * 1024) + code), { ok: false, error: SETUP_CODE_ERRORS.shape });
  assert.deepEqual(decodeSetupCode(" ".repeat(SETUP_CODE_MAX_INPUT - code.length) + code), { ok: true, choices: ARC });
});

test("garbage fails with a friendly message", () => {
  assert.deepEqual(decodeSetupCode(""), { ok: false, error: SETUP_CODE_ERRORS.empty });
  assert.deepEqual(decodeSetupCode("   "), { ok: false, error: SETUP_CODE_ERRORS.empty });
  assert.deepEqual(decodeSetupCode("hello there"), { ok: false, error: SETUP_CODE_ERRORS.shape });
  assert.deepEqual(decodeSetupCode("https://ardia.dev/?code=1"), { ok: false, error: SETUP_CODE_ERRORS.shape });
  assert.deepEqual(decodeSetupCode("ardia01-t0-00"), { ok: false, error: SETUP_CODE_ERRORS.shape });
  assert.deepEqual(decodeSetupCode(`ardia1-${"t0".repeat(SETUP_CODE_MAX_LENGTH)}-00`), { ok: false, error: SETUP_CODE_ERRORS.shape });
  assert.deepEqual(decodeSetupCode("ardia2-t0-00"), { ok: false, error: SETUP_CODE_ERRORS.newer });
  assert.deepEqual(decodeSetupCode("ardia1-"), { ok: false, error: SETUP_CODE_ERRORS.damaged });
  assert.deepEqual(decodeSetupCode("ardia1-t0"), { ok: false, error: SETUP_CODE_ERRORS.damaged });
  for (const bad of ["ardia1-{\"t\":0}-00", "ardia1-<script>-00", "ardia1-t0;alert(1)-00", "ardia1-t-00", "ardia1-00-00"]) {
    const result = decodeSetupCode(bad);
    assert.equal(result.ok, false, bad);
  }
});

test("a mistyped or cut-off code is caught by its check", () => {
  const code = encodeSetupCode(ARC);
  const flipped = code.replace("t0", "t1");
  assert.notEqual(flipped, code);
  assert.deepEqual(decodeSetupCode(flipped), { ok: false, error: SETUP_CODE_ERRORS.damaged });
  assert.deepEqual(decodeSetupCode(code.slice(0, -1)), { ok: false, error: SETUP_CODE_ERRORS.damaged });
  assert.deepEqual(decodeSetupCode(code.replace(/-..$/, "-zz")), { ok: false, error: SETUP_CODE_ERRORS.damaged });
});

const signed = (body) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${SETUP_CODE_PREFIX}${body}-${(hash % 1296).toString(36).padStart(2, "0")}`;
};

test("the test signer matches the encoder", () => {
  assert.equal(signed("t1e2"), encodeSetupCode({ settings: { tabLayout: "top", appearance: "dark" } }));
});

test("unknown keys are ignored, unknown values are dropped, repeated keys are refused", () => {
  assert.deepEqual(decodeSetupCode(signed("t1z9q12345")), { ok: true, choices: { settings: { tabLayout: "top" } } });
  assert.deepEqual(decodeSetupCode(signed("t1e7")), { ok: true, choices: { settings: { tabLayout: "top" } } });
  assert.deepEqual(decodeSetupCode(signed("t1e000000002")), { ok: true, choices: { settings: { tabLayout: "top" } } });
  assert.deepEqual(decodeSetupCode(signed("t1t0")), { ok: false, error: SETUP_CODE_ERRORS.damaged });
  assert.deepEqual(decodeSetupCode(signed("z1")), { ok: false, error: SETUP_CODE_ERRORS.nothing });
  assert.deepEqual(decodeSetupCode(signed("f999999")).ok, true, "pin bits past the known sites are ignored");
});

test("the summary names what the code sets, in plain words", () => {
  assert.deepEqual(describeSetupChoices(ARC), [
    "Tabs in the sidebar",
    "Address in the sidebar",
    "⌘T opens the command bar",
    "Always dark",
    "Green theme",
    "3 apps pinned",
  ]);
  assert.deepEqual(describeSetupChoices({ settings: { tabLayout: "top", addressBar: "sidebar" } }), ["Tabs along the top"]);
});
