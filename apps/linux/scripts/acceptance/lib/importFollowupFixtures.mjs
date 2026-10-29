import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromiumBasicKey } from "./importFixtures.mjs";
import { fixtureSecret } from "./fixtureSecrets.mjs";

const WEBKIT_OFFSET = 11644473600000000n;
const IV = Buffer.alloc(16, 0x20);
const webkit = (ms) => BigInt(ms) * 1000n + WEBKIT_OFFSET;

export const KEYRING_SECRET = fixtureSecret("safe-storage-");
export const FAKE_KEYRING = new URL("../../../../../engine/ardiacore-linux/tests/fixtures/fake_keyring.py", import.meta.url);
export const NSS_LOGINS = new URL("../../../../../engine/ardiacore-linux/tests/fixtures/nss_logins.py", import.meta.url);

export const keyringKey = (secret = KEYRING_SECRET) => pbkdf2Sync(secret, "saltysalt", 1, 16, "sha1");

export function encryptChromium(value, { key = chromiumBasicKey(), prefix = "v10" } = {}) {
  const cipher = createCipheriv("aes-128-cbc", key, IV);
  return Buffer.concat([Buffer.from(prefix), cipher.update(Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8")), cipher.final()]);
}

export function decryptChromium(blob, key = chromiumBasicKey()) {
  const bytes = Buffer.from(blob);
  if (!["v10", "v11"].includes(bytes.subarray(0, 3).toString())) return null;
  const decipher = createDecipheriv("aes-128-cbc", key, IV);
  return Buffer.concat([decipher.update(bytes.subarray(3)), decipher.final()]);
}

export const hostHashed = (host, value) => Buffer.concat([createHash("sha256").update(host).digest(), Buffer.from(value, "utf8")]);

function pickle(...parts) {
  const body = Buffer.concat(parts);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([size, body]);
}

function ints(...values) {
  const out = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => out.writeInt32LE(v, i * 4));
  return out;
}

function pickleString(text) {
  const raw = Buffer.from(text, "utf8");
  return Buffer.concat([ints(raw.length), raw, Buffer.alloc((4 - (raw.length % 4)) % 4)]);
}

function pickleString16(text) {
  const raw = Buffer.from(text, "utf16le");
  return Buffer.concat([ints(raw.length / 2), raw, Buffer.alloc((4 - (raw.length % 4)) % 4)]);
}

export function chromiumSession(tabs) {
  const commands = [[9, ints(1, 0)]];
  tabs.forEach((tab, index) => {
    const id = 100 + index;
    commands.push([0, ints(1, id)], [2, ints(id, index)], [6, pickle(ints(id, 0), pickleString(tab.url), pickleString16(tab.title))]);
    if (tab.pinned) commands.push([12, Buffer.concat([ints(id), Buffer.from([1])])]);
  });
  commands.push([8, ints(1, 0)], [255, Buffer.alloc(0)]);
  const header = Buffer.alloc(8);
  header.write("SNSS", 0, "latin1");
  header.writeUInt32LE(3, 4);
  return Buffer.concat([header, ...commands.map(([id, payload]) => {
    const size = Buffer.alloc(2);
    size.writeUInt16LE(payload.length + 1);
    return Buffer.concat([size, Buffer.from([id]), payload]);
  })]);
}

export function mozLz4Literal(data) {
  const parts = [];
  let length = data.length;
  const token = Math.min(length, 15) << 4;
  parts.push(Buffer.from([token]));
  if (length >= 15) {
    length -= 15;
    while (length >= 255) {
      parts.push(Buffer.from([255]));
      length -= 255;
    }
    parts.push(Buffer.from([length]));
  }
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  return Buffer.concat([Buffer.from("mozLz40\0", "latin1"), size, ...parts, data]);
}

export async function writeFollowupFixtures(home, { nowMs = Date.now(), keyring = false } = {}) {
  const config = join(home, ".config", "google-chrome");
  const chrome = join(config, "Default");
  await mkdir(join(chrome, "Network"), { recursive: true });
  await mkdir(join(chrome, "Sessions"), { recursive: true });
  await writeFile(join(chrome, "Preferences"), "{}");
  await writeFile(join(config, "Local State"), JSON.stringify({ profile: { last_used: "Default", info_cache: { Default: { name: "Follow-up" } } } }));
  const tabs = [{ url: "https://tab-one.ardia.test/", title: "Tab One", pinned: true }, { url: "https://tab-two.ardia.test/", title: "Tab Two" }];
  await writeFile(join(chrome, "Sessions", "Session_13370000000000000"), chromiumSession(tabs));

  const cookieValues = { session: fixtureSecret("cookie-"), prefs: fixtureSecret("cookie-") };
  const foxCookieValues = { fox: fixtureSecret("fox-cookie-"), container: fixtureSecret("container-cookie-") };
  const cookies = new DatabaseSync(join(chrome, "Network", "Cookies"));
  cookies.exec("CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR)");
  cookies.exec("INSERT INTO meta VALUES ('version', '24')");
  cookies.exec("CREATE TABLE cookies(creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, encrypted_value BLOB NOT NULL, path TEXT NOT NULL, expires_utc INTEGER NOT NULL, is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL, last_access_utc INTEGER NOT NULL, has_expires INTEGER NOT NULL, is_persistent INTEGER NOT NULL, priority INTEGER NOT NULL, samesite INTEGER NOT NULL, source_scheme INTEGER NOT NULL, source_port INTEGER NOT NULL, last_update_utc INTEGER NOT NULL, source_type INTEGER NOT NULL, has_cross_site_ancestor INTEGER NOT NULL)");
  const insertCookie = cookies.prepare("INSERT INTO cookies VALUES (?, ?, '', ?, '', ?, '/', ?, 1, 1, ?, 1, 1, 1, 1, 2, 443, ?, 0, 0)");
  const expires = webkit(nowMs + 30 * 86400000);
  insertCookie.run(webkit(nowMs - 86400000), ".cookies.ardia.test", "session", encryptChromium(hostHashed(".cookies.ardia.test", cookieValues.session)), expires, webkit(nowMs - 3600000), webkit(nowMs - 3600000));
  insertCookie.run(webkit(nowMs - 86400000), "cookies.ardia.test", "prefs", encryptChromium(hostHashed("cookies.ardia.test", cookieValues.prefs)), expires, webkit(nowMs - 3600000), webkit(nowMs - 3600000));
  cookies.close();

  const cardNumber = "4111111111111111";
  const web = new DatabaseSync(join(chrome, "Web Data"));
  web.exec("CREATE TABLE local_addresses (guid VARCHAR PRIMARY KEY, use_count INTEGER)");
  web.exec("CREATE TABLE local_addresses_type_tokens (guid VARCHAR, type INTEGER, value VARCHAR, verification_status INTEGER, observations BLOB)");
  web.exec("INSERT INTO local_addresses VALUES ('addr-1', 1)");
  const token = web.prepare("INSERT INTO local_addresses_type_tokens VALUES ('addr-1', ?, ?, 0, NULL)");
  for (const [type, value] of [[7, "Ada Acceptance"], [77, "1 Fixture Way"], [33, "Testville"], [35, "12345"], [36, "US"], [9, "ada@ardia.test"]]) token.run(type, value);
  web.exec("CREATE TABLE credit_cards (guid VARCHAR PRIMARY KEY, name_on_card VARCHAR, expiration_month INTEGER, expiration_year INTEGER, card_number_encrypted BLOB, nickname VARCHAR)");
  web.prepare("INSERT INTO credit_cards VALUES ('card-1', 'Ada Acceptance', 12, 2034, ?, 'Fixture')").run(encryptChromium(cardNumber));
  web.close();

  const keyringPasswords = [fixtureSecret("ring-"), fixtureSecret("ring-")];
  if (keyring) {
    const logins = new DatabaseSync(join(chrome, "Login Data"));
    logins.exec("CREATE TABLE logins(origin_url VARCHAR NOT NULL, action_url VARCHAR, username_value VARCHAR, password_value BLOB, signon_realm VARCHAR NOT NULL, date_created INTEGER NOT NULL, blacklisted_by_user INTEGER NOT NULL, times_used INTEGER, date_last_used INTEGER NOT NULL DEFAULT 0)");
    const insert = logins.prepare("INSERT INTO logins VALUES (?, '', ?, ?, ?, ?, 0, 0, 0)");
    insert.run("https://ring-one.ardia.test/", "kay", encryptChromium(keyringPasswords[0], { key: keyringKey(), prefix: "v11" }), "https://ring-one.ardia.test/", webkit(1600000000000));
    insert.run("https://ring-two.ardia.test/", "lee", encryptChromium(keyringPasswords[1], { key: keyringKey(), prefix: "v11" }), "https://ring-two.ardia.test/", webkit(1600000000000));
    logins.close();
  }

  const firefoxRoot = join(home, ".mozilla", "firefox");
  const firefox = join(firefoxRoot, "followup.default");
  await mkdir(firefox, { recursive: true });
  await writeFile(join(firefoxRoot, "profiles.ini"), "[Profile0]\nName=followup\nIsRelative=1\nPath=followup.default\nDefault=1\n");
  const session = Buffer.from(JSON.stringify({ windows: [{ selected: 1, tabs: [{ entries: [{ url: "https://fox-tab.ardia.test/", title: "Fox Tab" }] }] }] }));
  await writeFile(join(firefox, "sessionstore.jsonlz4"), mozLz4Literal(session));
  const foxCookies = new DatabaseSync(join(firefox, "cookies.sqlite"));
  foxCookies.exec("CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, originAttributes TEXT NOT NULL DEFAULT '', name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, lastAccessed INTEGER, creationTime INTEGER, isSecure INTEGER, isHttpOnly INTEGER, inBrowserElement INTEGER DEFAULT 0, sameSite INTEGER DEFAULT 0, rawSameSite INTEGER DEFAULT 0, schemeMap INTEGER DEFAULT 0)");
  const fox = foxCookies.prepare("INSERT INTO moz_cookies (originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite, rawSameSite, schemeMap) VALUES (?, ?, ?, ?, '/', ?, 0, 0, 1, 0, 1, 1, 2)");
  fox.run("", "fox", foxCookieValues.fox, ".fox.ardia.test", Math.floor(nowMs / 1000) + 86400);
  fox.run("^userContextId=3", "container", foxCookieValues.container, ".fox.ardia.test", Math.floor(nowMs / 1000) + 86400);
  foxCookies.close();

  return {
    chrome, firefox, tabs, cookieValues, cardNumber, keyringPasswords,
    secrets: [...Object.values(cookieValues), cardNumber, ...Object.values(foxCookieValues), ...keyringPasswords],
    expected: { chromeTabs: 2, chromeCookies: 2, addresses: 1, cards: 1, firefoxTabs: 1, firefoxCookies: 1, firefoxSkipped: 1, keyringPasswords: 2 },
  };
}

export async function nssProfile(dir, password, rows) {
  await mkdir(dir, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-I", NSS_LOGINS.pathname, dir, password, JSON.stringify(rows)], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`nss_logins.py failed: ${stderr.trim()}`)); });
  });
}

export async function startFakeKeyring(scratch, config) {
  const bus = join(scratch, `keyring-bus-${Date.now()}`);
  const address = `unix:path=${bus}`;
  const daemon = spawn("dbus-daemon", ["--session", "--nofork", `--address=${address}`], { stdio: "ignore" });
  const ready = async (test, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await test()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`${label} didn't start`);
  };
  const { access } = await import("node:fs/promises");
  await ready(() => access(bus).then(() => true, () => false), "dbus-daemon");
  const service = spawn("python3", ["-I", FAKE_KEYRING.pathname, JSON.stringify(config), "--serve"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: address } });
  let output = "";
  service.stdout.on("data", (chunk) => { output += chunk; });
  await ready(async () => output.includes("ready"), "the fake keyring");
  return {
    address,
    async stop() {
      for (const child of [service, daemon]) {
        if (child.exitCode !== null) continue;
        child.kill("SIGTERM");
        await new Promise((resolve) => {
          const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
          child.once("exit", () => { clearTimeout(timer); resolve(); });
        });
      }
    },
  };
}
