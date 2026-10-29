import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";

const WEBKIT_OFFSET = 11644473600000000n;
const IV = Buffer.alloc(16, 0x20);

export const chromiumBasicKey = () => pbkdf2Sync("peanuts", "saltysalt", 1, 16, "sha1");

export function encryptV10(password) {
  const cipher = createCipheriv("aes-128-cbc", chromiumBasicKey(), IV);
  return Buffer.concat([Buffer.from("v10"), cipher.update(password, "utf8"), cipher.final()]);
}

export function decryptV10(blob) {
  const bytes = Buffer.from(blob);
  if (bytes.subarray(0, 3).toString() !== "v10") return null;
  const decipher = createDecipheriv("aes-128-cbc", chromiumBasicKey(), IV);
  return Buffer.concat([decipher.update(bytes.subarray(3)), decipher.final()]).toString("utf8");
}

const webkit = (ms) => BigInt(ms) * 1000n + WEBKIT_OFFSET;
const url = (name, href, added = 1700000000000) => ({ type: "url", name, url: href, date_added: String(webkit(added)) });
const folder = (name, children) => ({ type: "folder", name, children, date_added: String(webkit(1600000000000)) });

function history(file, rows) {
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE urls(id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL, typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL)");
  const insert = db.prepare("INSERT INTO urls(url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  for (const row of rows) insert.run(...row);
  db.exec("COMMIT");
  db.close();
}

function logins(file, rows) {
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE logins(origin_url VARCHAR NOT NULL, action_url VARCHAR, username_value VARCHAR, password_value BLOB, signon_realm VARCHAR NOT NULL, date_created INTEGER NOT NULL, blacklisted_by_user INTEGER NOT NULL, times_used INTEGER, date_last_used INTEGER NOT NULL DEFAULT 0)");
  const insert = db.prepare("INSERT INTO logins VALUES (?, '', ?, ?, ?, ?, 0, 0, 0)");
  for (const [origin, username, blob, realm] of rows) insert.run(origin, username, blob, realm, webkit(1600000000000));
  db.close();
}

export async function writeImportFixtures(home, { largeHistory = 40000 } = {}) {
  const config = join(home, ".config", "google-chrome");
  const secrets = ["fixture-pass-one", "fixture-pass-two", "fixture-pass-three", "csv-secret-one", "csv-secret-two"];
  const profile = async (name) => {
    const dir = join(config, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "Preferences"), "{}");
    return dir;
  };
  const chrome = await profile("Default");
  const partial = await profile("Profile 1");
  const large = await profile("Profile 2");
  await writeFile(join(config, "Local State"), JSON.stringify({ profile: { last_used: "Default", profiles_order: ["Default", "Profile 1", "Profile 2"], info_cache: { Default: { name: "Scratch Personal" }, "Profile 1": { name: "Scratch Partial" }, "Profile 2": { name: "Scratch Large" } } } }));
  await writeFile(join(chrome, "Bookmarks"), JSON.stringify({ roots: {
    bookmark_bar: folder("Bookmarks bar", [url("Bar A", "https://bar-a.ardia.test/"), folder("Nested", [url("Nested B", "https://nested-b.ardia.test/"), folder("Deeper", [url("Deeper C", "https://deeper-c.ardia.test/")])])]),
    other: folder("Other bookmarks", [url("Other D", "https://other-d.ardia.test/")]),
    synced: folder("Mobile bookmarks", []),
  }, version: 1 }));
  history(join(chrome, "History"), [
    ["https://visited-1.ardia.test/", "Visited 1", 3, 1, webkit(1700000300000), 0],
    ["https://visited-2.ardia.test/", "Visited 2", 1, 0, webkit(1700000200000), 0],
    ["https://visited-3.ardia.test/", "Visited 3", 1, 0, webkit(1700000100000), 0],
    ["https://hidden.ardia.test/", "Hidden", 1, 0, webkit(1700000000000), 1],
  ]);
  logins(join(chrome, "Login Data"), [
    ["https://login-one.ardia.test/signin", "alice", encryptV10(secrets[0]), "https://login-one.ardia.test/"],
    ["https://login-two.ardia.test/", "bob", encryptV10(secrets[1]), "https://login-two.ardia.test/"],
    ["https://login-three.ardia.test/", "carol", encryptV10(secrets[2]), "https://login-three.ardia.test/"],
    ["https://keyring.ardia.test/", "kay", Buffer.concat([Buffer.from("v11"), randomBytes(32)]), "https://keyring.ardia.test/"],
  ]);
  await writeFile(join(partial, "Bookmarks"), JSON.stringify({ roots: { bookmark_bar: folder("Bar", [url("Partial", "https://partial.ardia.test/")]) } }));
  await writeFile(join(partial, "History"), Buffer.alloc(4096, 0x41));
  history(join(large, "History"), Array.from({ length: largeHistory }, (_, i) => [`https://large-${i}.ardia.test/`, `Large ${i}`, 1, 0, webkit(1700000000000 + i), 0]));

  const firefoxRoot = join(home, ".mozilla", "firefox");
  const firefox = join(firefoxRoot, "scratch.default-release");
  await mkdir(firefox, { recursive: true });
  await writeFile(join(firefoxRoot, "profiles.ini"), "[Profile0]\nName=scratch\nIsRelative=1\nPath=scratch.default-release\n\n[Install1]\nDefault=scratch.default-release\n");
  const places = new DatabaseSync(join(firefox, "places.sqlite"));
  places.exec("CREATE TABLE moz_places(id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0 NOT NULL, typed INTEGER DEFAULT 0 NOT NULL, last_visit_date INTEGER)");
  places.exec("CREATE TABLE moz_bookmarks(id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER DEFAULT NULL, parent INTEGER, position INTEGER, title LONGVARCHAR, dateAdded INTEGER, guid TEXT)");
  const place = places.prepare("INSERT INTO moz_places VALUES (?, ?, ?, ?, 0, 0, ?)");
  place.run(1, "https://fox-a.ardia.test/", "Fox A", 2, 1700000000000000);
  place.run(2, "https://fox-b.ardia.test/", "Fox B", 1, 1690000000000000);
  const mark = places.prepare("INSERT INTO moz_bookmarks VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const row of [[1, 2, null, 0, 0, "", 1, "root________"], [2, 2, null, 1, 0, "toolbar", 1, "toolbar_____"], [3, 2, null, 1, 1, "unfiled", 1, "unfiled_____"],
    [10, 1, 1, 2, 0, "Fox A", 1600000000000000, "fa"], [11, 2, null, 2, 1, "Fox folder", 1600000000000000, "ff"], [12, 1, 2, 11, 0, "Fox B", 1600000000000000, "fb"]]) mark.run(...row);
  places.close();

  const html = join(home, "bookmarks.html");
  await writeFile(html, '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n<DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bar</H3>\n<DL><p>\n<DT><A HREF="https://html-a.ardia.test/">A</A>\n<DT><H3>Sub</H3>\n<DL><p>\n<DT><A HREF="https://html-b.ardia.test/">B</A>\n</DL><p>\n</DL><p>\n</DL><p>\n');
  const csv = join(home, "passwords.csv");
  await writeFile(csv, `name,url,username,password,note\nOne,https://csv-one.ardia.test/,dana,${secrets[3]},\nOne again,https://csv-one.ardia.test/,dana,${secrets[3]},\nTwo,https://csv-two.ardia.test/,erin,${secrets[4]},\nBroken,,frank,nopass,\n`);

  return {
    secrets,
    html,
    csv,
    profiles: { chrome, partial, large, firefox },
    expected: { chromeLinks: 4, chromeHistory: 3, chromePasswords: 3, keyring: 1, firefoxLinks: 2, firefoxHistory: 2, largeHistory, htmlLinks: 2, csvCredentials: 2, csvDuplicates: 1, csvInvalid: 1 },
  };
}

export const ARDIA_OWN_PATHS = [join(".config", "ardia")];

export async function digestTree(root, { skip = ARDIA_OWN_PATHS } = {}) {
  const out = {};
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (skip.includes(relative(root, path))) continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) out[relative(root, path)] = createHash("sha256").update(await readFile(path)).digest("hex");
    }
  };
  await walk(root);
  return out;
}

export async function leftoverImportCopies(tmp) {
  const entries = await readdir(tmp).catch(() => []);
  return entries.filter((name) => name.startsWith("ardia-import-"));
}

export async function savedLogins(loginData, scratch) {
  if (!(await stat(loginData).catch(() => null))) return [];
  const copy = join(scratch, `login-copy-${Date.now()}`);
  await copyFile(loginData, copy);
  for (const suffix of ["-wal", "-journal"]) await copyFile(loginData + suffix, copy + suffix).catch(() => {});
  try {
    const db = new DatabaseSync(copy);
    const rows = db.prepare("SELECT origin_url, username_value, password_value FROM logins").all();
    db.close();
    return rows.map((row) => ({ origin: row.origin_url, username: row.username_value, password: decryptV10(row.password_value) }));
  } finally {
    for (const suffix of ["", "-wal", "-journal", "-shm"]) await rm(copy + suffix, { force: true });
  }
}
