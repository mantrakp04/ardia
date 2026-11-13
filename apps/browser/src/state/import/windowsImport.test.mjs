import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { listSources } from "../../../../../packages/expo-windows/src/import/discovery.ts";
import { bookmarksFromHtml, passwordsFromCsv } from "../../../../../packages/expo-windows/src/import/fileFormats.ts";
import { importProfile, Unlocks } from "../../../../../packages/expo-windows/src/import/importer.ts";
import { lz4Block } from "../../../../../packages/expo-windows/src/import/bytes.ts";
import { pathFromFileUrl } from "../../../../../packages/expo-windows/src/import/host.ts";
import { fakeHost, fixtures, LOCAL } from "./fixtures/windowsHost.mjs";

const quiet = { progress() {}, cancelled: () => false };
const links = (node) => (node.type === "url" ? 1 : (node.children ?? []).reduce((n, c) => n + links(c), 0));

test("Windows discovery finds each fixture browser under its Windows data folder", async () => {
  const sources = await listSources(fakeHost());
  const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(byId).sort(), ["arc", "brave", "braveBeta", "chrome", "firefox", "opera", "zen"]);
  assert.deepEqual(byId.chrome.profiles.map((p) => p.id).sort(), ["Default", "Profile 1"]);
  const chromeDefault = byId.chrome.profiles.find((p) => p.id === "Default");
  assert.deepEqual(chromeDefault.available, ["bookmarks", "history", "tabs", "passwords", "cookies"]);
  assert.equal(chromeDefault.path, `${LOCAL}\\Google\\Chrome\\User Data\\Default`);
  assert.ok(byId.opera.profiles.some((p) => p.id === "."));
  assert.deepEqual(byId.arc.profiles.find((p) => p.id === "Default").available, ["history", "passwords", "spaces", "pinnedTabs", "tabs", "favorites"]);
  for (const s of sources) assert.equal(s.needsKeychain, false);
  assert.ok(byId.firefox.profiles.some((p) => p.id === "Profiles/abcd1234.default-release" && p.available.includes("tabs")));
});

test("A Chrome profile brings its bookmarks, history and open tabs", async () => {
  const progress = [];
  const result = await importProfile(fakeHost(), new Unlocks(), "chrome", "Default", ["bookmarks", "history", "tabs"], {}, { progress: (p) => progress.push(p), cancelled: () => false });
  assert.deepEqual(result.failed, []);
  assert.ok(links(result.bookmarks) > 0);
  assert.ok(result.bookmarks.children.some((c) => c.role === "toolbar"));
  assert.equal(result.historyCount, result.history.length);
  assert.ok(result.history.every((h) => /^https?:/.test(h.url) && h.lastVisit > 0));
  assert.equal(result.tabs.length, 5);
  assert.ok(progress.some((p) => p.kind === "history" && p.phase === "end"));
});

test("A Firefox profile brings bookmarks, history and its session store", async () => {
  const result = await importProfile(fakeHost(), new Unlocks(), "firefox", "Profiles/abcd1234.default-release", ["bookmarks", "history", "tabs"], {}, quiet);
  assert.deepEqual(result.failed, []);
  assert.equal(links(result.bookmarks), 4);
  assert.equal(result.historyCount, 4);
  assert.equal(result.tabs.length, 3);
});

test("History streams in chunks and honours a limit", async () => {
  const chunks = [];
  const result = await importProfile(fakeHost(), new Unlocks(), "firefox", "Profiles/abcd1234.default-release", ["history"], { historyLimit: 3, chunkSize: 2, streamHistory: true }, {
    ...quiet,
    history: (entries) => chunks.push(entries.length),
  });
  assert.equal(result.historyCount, 3);
  assert.deepEqual(chunks, [2, 1]);
  assert.deepEqual(result.history, []);
});

test("Passwords unlock the key once and report what app-bound encryption kept back", async () => {
  const host = fakeHost({ logins: { items: [{ url: "https://a.example/", username: "u", password: "p" }], undecryptable: 1, appBound: 2 } });
  const unlocks = new Unlocks();
  const result = await importProfile(host, unlocks, "chrome", "Default", ["passwords"], {}, quiet);
  await importProfile(host, unlocks, "chrome", "Default", ["passwords"], {}, quiet);
  assert.equal(result.credentials.length, 1);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.warnings.map((w) => w.code), ["undecryptable", "undecryptable"]);
  assert.match(result.warnings[1].message, /2 passwords use Google Chrome's app-bound encryption/);
  assert.equal(host.calls.filter(([c]) => c === "unlock").length, 1);
});

test("Cookies come back as a count and a token, and a browser holding the file is a locked kind", async () => {
  const kept = await importProfile(fakeHost({ cookies: { count: 7, token: "t0k", undecryptable: 0, appBound: 0, dropped: 0 } }), new Unlocks(), "chrome", "Default", ["cookies"], {}, quiet);
  assert.equal(kept.cookieCount, 7);
  assert.equal(kept.vaultToken, "t0k");
  const held = await importProfile(fakeHost({ cookies: { failure: "inUse", count: 0, undecryptable: 0, appBound: 0, dropped: 0 } }), new Unlocks(), "chrome", "Default", ["cookies"], {}, quiet);
  assert.deepEqual(held.failed, ["cookies"]);
  assert.equal(held.warnings[0].code, "locked");
  const keyless = fakeHost({ unlocked: false, cookies: { count: 0, undecryptable: 3, appBound: 0, dropped: 0 } });
  const unlocks = new Unlocks();
  const refused = await importProfile(keyless, unlocks, "chrome", "Default", ["cookies"], {}, quiet);
  assert.deepEqual(refused.failed, ["cookies"]);
  assert.equal(refused.warnings.at(-1).code, "locked");
  await importProfile(keyless, unlocks, "chrome", "Default", ["cookies"], {}, quiet);
  assert.equal(keyless.calls.filter(([c]) => c === "unlock").length, 2);
  assert.equal(keyless.calls.filter(([c]) => c === "cookies").length, 2);
});

test("A kind whose values are all app-bound warns why instead of failing", async () => {
  const result = await importProfile(fakeHost({ cookies: { count: 0, undecryptable: 0, appBound: 40, dropped: 0 } }), new Unlocks(), "chrome", "Default", ["cookies"], {}, quiet);
  assert.deepEqual(result.failed, []);
  assert.equal(result.cookieCount, 0);
  assert.match(result.warnings[0].message, /40 cookies use Google Chrome's app-bound encryption/);
});

test("Kinds Windows can't read yet fail on their own and the rest still import", async () => {
  const result = await importProfile(fakeHost(), new Unlocks(), "firefox", "Profiles/abcd1234.default-release", ["bookmarks", "autofill"], {}, quiet);
  assert.deepEqual(result.failed, ["autofill"]);
  assert.equal(result.warnings[0].code, "unsupported");
  assert.equal(links(result.bookmarks), 4);
});

test("A cancelled import stops", async () => {
  await assert.rejects(importProfile(fakeHost(), new Unlocks(), "chrome", "Default", ["bookmarks"], {}, { progress() {}, cancelled: () => true }), { code: "cancelled" });
});

test("A bookmarks HTML file and a passwords CSV file parse as on the Mac", () => {
  const root = bookmarksFromHtml(readFileSync(join(fixtures, "html/chrome-bookmarks.html"), "utf8"), "chrome-bookmarks.html");
  assert.ok(links(root) > 0);
  assert.ok(root.children.some((c) => c.role === "toolbar"));
  for (const name of ["chrome-passwords.csv", "firefox-passwords.csv", "bitwarden.csv"]) assert.ok(passwordsFromCsv(readFileSync(join(fixtures, "csv", name), "utf8")).length > 0, name);
  assert.throws(() => passwordsFromCsv(readFileSync(join(fixtures, "csv/not-passwords.csv"), "utf8")), { code: "unsupported" });
});

test("LZ4 blocks decode literals and back references", () => {
  const block = Uint8Array.from([0x34, 0x61, 0x62, 0x63, 0x02, 0x00, 0x50, 0x61, 0x62, 0x63, 0x64, 0x65]);
  assert.equal(Buffer.from(lz4Block(block, 16)).toString(), "abcbcbcbcbcabcde");
});

test("History is read in pages from one snapshot, which is closed afterwards", async () => {
  const host = fakeHost();
  const chunks = [];
  const result = await importProfile(host, new Unlocks(), "firefox", "Profiles/abcd1234.default-release", ["history"], { historyPage: 1, chunkSize: 3, streamHistory: true }, {
    ...quiet,
    history: (entries) => chunks.push(entries.length),
  });
  assert.equal(result.historyCount, 4);
  assert.deepEqual(chunks, [3, 1]);
  assert.equal(host.calls.filter(([c]) => c === "openSnapshot").length, 1);
  assert.deepEqual(host.calls.filter(([c]) => c === "querySnapshot").map(([, n]) => n), [2, 1, 1, 1, 1]);
  assert.equal(host.open.size, 0);
});

test("A picked file's address becomes its Windows path, network shares included", () => {
  assert.equal(pathFromFileUrl("file:///C:/Users/t/My%20Bookmarks.html"), "C:\\Users\\t\\My Bookmarks.html");
  assert.equal(pathFromFileUrl("file://server/share/passwords.csv"), "\\\\server\\share\\passwords.csv");
  assert.equal(pathFromFileUrl("C:\\plain.csv"), "C:\\plain.csv");
});

test("A password file that fails beside one that read keeps its passwords and says why some stayed", async () => {
  const items = [{ url: "https://a.example/", username: "u", password: "p" }];
  const held = await importProfile(fakeHost({ logins: { items, undecryptable: 0, appBound: 0, failure: "inUse" } }), new Unlocks(), "chrome", "Default", ["passwords"], {}, quiet);
  assert.deepEqual(held.failed, []);
  assert.equal(held.credentials.length, 1);
  assert.deepEqual(held.warnings.map((w) => [w.kind, w.code]), [["passwords", "locked"]]);
  assert.match(held.warnings[0].message, /Google Chrome is holding one of its password files/);
  const broken = await importProfile(fakeHost({ logins: { items, undecryptable: 0, appBound: 0, failure: "unreadable" } }), new Unlocks(), "chrome", "Default", ["passwords"], {}, quiet);
  assert.deepEqual(broken.warnings.map((w) => w.code), ["skipped"]);
  const none = await importProfile(fakeHost({ logins: { items: [], undecryptable: 0, appBound: 0, failure: "unreadable" } }), new Unlocks(), "chrome", "Default", ["passwords"], {}, quiet);
  assert.deepEqual(none.failed, ["passwords"]);
});
