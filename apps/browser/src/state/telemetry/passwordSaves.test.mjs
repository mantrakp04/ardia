import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, test } from "node:test";

globalThis.require = createRequire(import.meta.url);
globalThis.__DEV__ = false;
globalThis.fetch = async () => ({ status: 200 });

const REFUSED = "Could not save the password (invalid, or already saved)";
const NOT_LANDED = "The password store didn't take the change";
const answers = { "https://refused.example": REFUSED, "https://slow.example": NOT_LANDED, "https://broken.example": "Not authenticated" };
let csv = [];
globalThis.acTestNativeModules = {
  ArdiaImport: { chooseImportFile: async () => "/scratch/passwords.csv", importPasswordsCSV: async () => JSON.stringify(csv) },
  ArdiaPasswords: {
    save: async (_profile, origin) => {
      if (answers[origin]) throw new Error(answers[origin]);
      return JSON.stringify({ ok: true });
    },
  },
};

const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", appBuild: "300", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
stub.docs.set("telemetry.json", JSON.stringify({ version: 1, sharing: true, decidedAt: 1, askDoneAt: 1, installId: "install-1", crashCursor: 0, lastVersion: "0.3.0", sessionOpen: false }));
const client = await import("./client.ts");
const local = await import("./localStore.ts");
const { importPasswordsCsv } = await import("../site/savedPasswords.ts");
const { applyResult } = await import("../import/apply.ts");
const { useBrowser } = await import("../browser/store.ts");
const { orWarn, passwordFailure } = await import("../../lib/fallback.ts");
client.startClient();
after(() => client.flush());

const sent = () => (local.flushLocal(), stub.telemetryLocal.records().filter((r) => r.event === "password_import"));
const COUNTS = ["source", "tried", "saved", "refused", "not_landed", "other"];
const countsOf = (record) => Object.fromEntries(COUNTS.map((k) => [k, record.properties[k]]));
const login = (url, username, password) => ({ url, username, password });

const SECRETS = ["refused.example", "slow.example", "broken.example", "fine.example", "secret-user-7", "hunter2-xyz", "other-pw-9"];
const mixed = () => [
  login("https://fine.example/login", "secret-user-7", "hunter2-xyz"),
  login("https://refused.example/login", "secret-user-7", "other-pw-9"),
  login("https://slow.example/login", "secret-user-7", "hunter2-xyz"),
  login("https://broken.example/login", "secret-user-7", "other-pw-9"),
  login("/login", "secret-user-7", "hunter2-xyz"),
  login("https://fine.example/again", "secret-user-7", ""),
];

test("a CSV import sends one event with how many saves were refused, not stored in time or failed, and still warns for each", async (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (message) => warnings.push(message));
  csv = mixed();
  const before = sent().length;
  assert.deepEqual(await importPasswordsCsv("work"), { saved: 1, skipped: 5 }, "what the import returns is unchanged");
  const events = sent().slice(before);
  assert.equal(events.length, 1);
  assert.deepEqual(countsOf(events[0]), { source: "csv", tried: 4, saved: 1, refused: 1, not_landed: 1, other: 1 });
  assert.deepEqual(warnings, [`[engine] csv import: ${REFUSED}`, `[engine] csv import: ${NOT_LANDED}`, "[engine] csv import: Not authenticated"]);
  assert.equal(events[0].sent, true);
});

test("an import from another browser sends the same counts with source browser", async (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (message) => warnings.push(message));
  useBrowser.getState().hydrate({});
  const credentials = mixed().map(({ url, username, password }) => ({ url, username, password, realm: undefined }));
  const result = { tabs: [], spaces: [], favorites: [], history: [], credentials, favicons: [], bookmarks: null, vaultToken: null };
  const before = sent().length;
  const counts = await applyResult("default", result, "Chrome", []);
  assert.equal(counts.passwords, 1);
  const events = sent().slice(before);
  assert.equal(events.length, 1);
  assert.deepEqual(countsOf(events[0]), { source: "browser", tried: 4, saved: 1, refused: 1, not_landed: 1, other: 1 });
  assert.deepEqual(warnings, [`[engine] browser import: ${REFUSED}`, `[engine] browser import: ${NOT_LANDED}`, "[engine] browser import: Not authenticated"]);
});

test("an import where every save lands counts them all as saved, with no warning", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  csv = [login("https://one.example", "a", "p1"), login("https://two.example", "b", "p2")];
  const before = sent().length;
  assert.deepEqual(await importPasswordsCsv("work"), { saved: 2, skipped: 0 });
  const events = sent().slice(before);
  assert.equal(events.length, 1);
  assert.deepEqual(countsOf(events[0]), { source: "csv", tried: 2, saved: 2, refused: 0, not_landed: 0, other: 0 });
  assert.equal(warn.mock.callCount(), 0);
});

test("an empty list, or one with nothing to send to the engine, sends no event", async () => {
  const before = sent().length;
  for (const rows of [[], [login("/login", "me", "pw"), login("example.org", "me", "")]]) {
    csv = rows;
    assert.deepEqual(await importPasswordsCsv("work"), { saved: 0, skipped: rows.length });
  }
  assert.equal(sent().length, before);
});

test("the event holds counts and the source, never a site, a username or a password", async (t) => {
  t.mock.method(console, "warn", () => {});
  csv = mixed();
  const before = sent().length;
  await importPasswordsCsv("work");
  const [event] = sent().slice(before);
  const text = JSON.stringify(event);
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `${secret} must not be in the event`);
  for (const key of COUNTS.slice(1)) assert.equal(typeof event.properties[key], "number", key);
  assert.ok(["browser", "csv"].includes(event.properties.source));
  assert.ok(!Object.keys(event.properties).some((k) => /origin|user|pass|url|host|site/i.test(k)), "no property is named for the login");
});

test("an engine password error is sorted by what the engine said", () => {
  assert.equal(passwordFailure(new Error(REFUSED)), "refused-or-already-saved");
  assert.equal(passwordFailure(new Error(NOT_LANDED)), "not-landed-in-time");
  assert.equal(passwordFailure(new Error("Not authenticated")), "other");
  assert.equal(passwordFailure(REFUSED), "refused-or-already-saved", "a thrown string is read the same way");
  assert.equal(passwordFailure(undefined), "other");
});

test("orWarn still logs the engine's message and returns the fallback; a source label only names the action", (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (message) => warnings.push(message));
  assert.equal(orWarn(false)(new Error(REFUSED)), false);
  assert.equal(orWarn(null, "sync delete")(new Error(NOT_LANDED)), null);
  assert.equal(orWarn(false, "settings edit")(new Error(REFUSED)), false);
  assert.equal(orWarn(false, "settings delete")(new Error("No such password")), false);
  assert.deepEqual(warnings, [`[engine] ${REFUSED}`, `[engine] sync delete: ${NOT_LANDED}`, `[engine] settings edit: ${REFUSED}`, "[engine] settings delete: No such password"]);
});
