import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { listSources } from "../../../../../packages/expo-windows/src/import/discovery.ts";
import { bookmarksFromHtml, passwordsFromCsv } from "../../../../../packages/expo-windows/src/import/fileFormats.ts";
import { importProfile, Unlocks } from "../../../../../packages/expo-windows/src/import/importer.ts";
import { lz4Block } from "../../../../../packages/expo-windows/src/import/bytes.ts";

const fixtures = new URL("../../../../../packages/import/fixtures/", import.meta.url).pathname;
const support = join(fixtures, "home/Library/Application Support");
const LOCAL = "C:\\Users\\tester\\AppData\\Local";
const ROAMING = "C:\\Users\\tester\\AppData\\Roaming";

const MOUNTS = [
  [`${LOCAL}\\Google\\Chrome\\User Data`, join(support, "Google/Chrome")],
  [`${LOCAL}\\BraveSoftware\\Brave-Browser\\User Data`, join(support, "BraveSoftware/Brave-Browser")],
  [`${LOCAL}\\BraveSoftware\\Brave-Browser-Beta\\User Data`, join(support, "BraveSoftware/Brave-Browser-Beta")],
  [`${LOCAL}\\Packages\\TheBrowserCompany.Arc_ttt1ap7aakyb4\\LocalCache\\Local\\Arc\\User Data`, join(support, "Arc/User Data")],
  [`${ROAMING}\\Opera Software\\Opera Stable`, join(support, "com.operasoftware.Opera")],
  [`${ROAMING}\\Mozilla\\Firefox`, join(support, "Firefox")],
  [`${ROAMING}\\zen`, join(support, "zen")],
];

const onDisk = (windowsPath) => {
  for (const [prefix, folder] of MOUNTS) {
    if (windowsPath === prefix || windowsPath.startsWith(`${prefix}\\`)) return join(folder, ...windowsPath.slice(prefix.length).split("\\").filter(Boolean));
  }
  return null;
};

const cell = (value) => (value instanceof Uint8Array ? { blob: Buffer.from(value).toString("base64") } : typeof value === "bigint" ? Number(value) : value);

function fakeHost(secrets = {}) {
  const calls = [];
  return {
    calls,
    localAppData: LOCAL,
    roamingAppData: ROAMING,
    async list(path) {
      const folder = onDisk(path);
      if (!folder || !existsSync(folder) || !statSync(folder).isDirectory()) return null;
      return readdirSync(folder).map((name) => {
        const s = statSync(join(folder, name));
        return { name, dir: s.isDirectory(), size: s.size, modified: s.mtimeMs };
      });
    },
    async readText(path) {
      const file = onDisk(path);
      return file && existsSync(file) ? readFileSync(file, "utf8") : null;
    },
    async readBase64(path) {
      const file = onDisk(path);
      return file && existsSync(file) ? readFileSync(file).toString("base64") : null;
    },
    async query(path, queries) {
      const file = onDisk(path);
      if (!file || !existsSync(file)) return { failure: "missing" };
      const scratch = mkdtempSync(join(tmpdir(), "ardia-import-test-"));
      try {
        copyFileSync(file, join(scratch, "db.sqlite"));
        for (const suffix of ["-wal", "-journal"]) if (existsSync(file + suffix)) copyFileSync(file + suffix, join(scratch, `db.sqlite${suffix}`));
        const db = new DatabaseSync(join(scratch, "db.sqlite"));
        const results = queries.map(({ sql, args = [], limit }) => {
          try {
            const statement = db.prepare(sql);
            statement.setReadBigInts(true);
            const columns = statement.columns().map((c) => c.name);
            const rows = statement.all(...args).slice(0, limit ?? Infinity).map((row) => columns.map((c) => cell(row[c])));
            return { columns, rows };
          } catch (error) {
            return { error: String(error.message) };
          }
        });
        db.close();
        return { results };
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    },
    async unlock(browserId) {
      calls.push(["unlock", browserId]);
      return { unlocked: secrets.unlocked ?? true, appBound: false };
    },
    async logins(browserId, files) {
      calls.push(["logins", browserId, files.length]);
      return secrets.logins ?? { items: [], undecryptable: 0, appBound: 0 };
    },
    async cookies(browserId) {
      calls.push(["cookies", browserId]);
      return secrets.cookies ?? { count: 0, undecryptable: 0, appBound: 0, dropped: 0 };
    },
    async writeCookies() {
      return { cookies: 0, cookiesRejected: 0, cookiesExisting: 0, addresses: 0, cards: 0 };
    },
    discard() {},
    forget() {
      calls.push(["forget"]);
    },
  };
}

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
  assert.ok(!byId.arc.profiles.some((p) => p.available.includes("tabs")));
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
  const result = await importProfile(fakeHost(), new Unlocks(), "firefox", "Profiles/abcd1234.default-release", ["bookmarks", "passwords"], {}, quiet);
  assert.deepEqual(result.failed, ["passwords"]);
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
