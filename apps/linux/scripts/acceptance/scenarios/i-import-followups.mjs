import { access, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startBrowser } from "../lib/flows.mjs";
import { digestTree, leftoverImportCopies, savedLogins } from "../lib/importFixtures.mjs";
import { decryptChromium, KEYRING_SECRET, nssProfile, startFakeKeyring, writeFollowupFixtures } from "../lib/importFollowupFixtures.mjs";
import { sessionSeed, writeProfileSeed } from "../lib/seed.mjs";
import { nonce, until } from "../lib/util.mjs";
import { runRequest } from "./f12-import.mjs";
import { fixtureSecret } from "../lib/fixtureSecrets.mjs";

let requests = 0;
const next = (prefix) => `${prefix}-${++requests}`;
const importJob = (shell, browser, profile, kinds) => runRequest(shell, "ArdiaImport.startImport", [next("job"), browser, profile, kinds, {}]);
const unlock = (shell, browser, password = null) => runRequest(shell, "ArdiaImport.unlockBrowser", [next("unlock"), browser, password]);
const writeImported = (shell, token, profile, kinds) => runRequest(shell, "ArdiaImport.writeImported", [next("write"), token, profile, kinds]);
const writePasswords = (shell, token, profile) => runRequest(shell, "ArdiaImport.writePasswords", [next("write"), token, profile]);
const available = (command) => access(command, constants.X_OK).then(() => true, () => false);

function leaks(reply, secrets) {
  const text = JSON.stringify(reply);
  return secrets.filter((secret) => text.includes(secret));
}

function rows(file, scratch, sql) {
  const copy = join(scratch, `read-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return copyFile(file, copy).then(async () => {
    for (const suffix of ["-wal", "-journal"]) await copyFile(file + suffix, copy + suffix).catch(() => {});
    const db = new DatabaseSync(copy, { readOnly: true });
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  }, () => []);
}

async function prepare(t, name, options = {}) {
  const scratch = await t.scratch(name);
  const home = join(scratch, "home");
  const tmp = await t.tempDir("import");
  await writeProfileSeed(scratch, { session: sessionSeed() });
  const fixtures = await writeFollowupFixtures(home, options);
  return { scratch, home, tmp, fixtures };
}

export const i111 = {
  id: "I111",
  issue: 111,
  title: "Import open tabs, cookies, addresses and cards from Linux Chromium and Firefox profiles",
  deadline: 300000,
  manual: [
    { name: "Import window click-through with tabs, cookies and autofill", steps: ["With a real Chrome profile copied into a scratch HOME, open File › Import from Another Browser.", "Choose Tabs, Cookies and Autofill: the Done step shows the counts, the tabs open in an Imported group, a site from the cookies is still signed in, and Settings › Autofill lists the address and card."], reason: "automated in I111W with fixture profiles; a real Chrome profile needs a person" },
  ],
  async run(t) {
    const { scratch, home, tmp, fixtures } = await prepare(t, "import-followups");
    const before = await digestTree(home);
    const { shell } = await startBrowser(t, { name: "import-followups", scratch, env: { TMPDIR: tmp } });

    await t.check("discovery advertises tabs, cookies and autofill where the profile has them", async () => {
      const list = (await shell.invoke("ArdiaImport.listBrowsers", { args: [] })).value ?? [];
      const chrome = list.find((b) => b.id === "chrome")?.profiles[0]?.available ?? [];
      const firefox = list.find((b) => b.id === "firefox")?.profiles[0]?.available ?? [];
      if (["tabs", "cookies", "autofill"].some((k) => !chrome.includes(k)) || ["tabs", "cookies"].some((k) => !firefox.includes(k))) throw new Error(JSON.stringify({ chrome, firefox }));
      return { chrome, firefox };
    }, { critical: true });

    let token;
    await t.check("a Chrome import returns tabs and a vault token, with no cookie value or card number in the reply", async () => {
      const reply = await importJob(shell, "chrome", "Default", ["tabs", "cookies", "autofill"]);
      if (reply.type !== "done") throw new Error(JSON.stringify(reply));
      const result = reply.result;
      const leaked = leaks(reply, fixtures.secrets);
      if (leaked.length) throw new Error(`secrets in the renderer reply: ${leaked.length}`);
      const counts = { tabs: result.tabs.length, cookies: result.cookieCount, addresses: result.addressCount, cards: result.cardCount, failed: result.failed };
      const want = { tabs: 2, cookies: 2, addresses: 1, cards: 1, failed: [] };
      if (JSON.stringify(counts) !== JSON.stringify(want) || !/^[0-9a-f]{32}$/.test(result.vaultToken ?? "")) throw new Error(JSON.stringify({ counts, token: result.vaultToken }));
      if (result.tabs[0].url !== fixtures.tabs[0].url || result.tabs[0].pinned !== true) throw new Error(JSON.stringify(result.tabs));
      token = result.vaultToken;
      return counts;
    }, { critical: true });

    await t.check("writeImported stores the cookies, the address and the card in Ardia's own profile once", async () => {
      const written = await writeImported(shell, token, "", ["cookies", "autofill"]);
      if (written.type !== "importedWritten" || written.cookies !== 2 || written.addresses !== 1 || written.cards !== 1) throw new Error(JSON.stringify(written));
      const reused = await writeImported(shell, token, "", ["cookies", "autofill"]);
      if (reused.type !== "rejected" || reused.code !== "expired") throw new Error(`reused token ${JSON.stringify(reused)}`);
      const cookies = await until(async () => {
        const sql = "SELECT host_key, name, encrypted_value FROM cookies WHERE host_key LIKE '%cookies.ardia.test'";
        const network = await rows(join(scratch, "Default", "Network", "Cookies"), tmp, sql);
        const found = network.length ? network : await rows(join(scratch, "Default", "Cookies"), tmp, sql);
        return found.length === 2 ? found : false;
      }, { timeout: 20000, label: "Ardia's Cookies to hold the imported cookies" });
      const values = cookies.map((row) => decryptChromium(row.encrypted_value)?.subarray(32).toString("utf8")).sort();
      if (JSON.stringify(values) !== JSON.stringify(Object.values(fixtures.cookieValues).sort())) throw new Error("stored cookie values don't match the source");
      const cards = await until(async () => {
        const found = await rows(join(scratch, "Default", "Web Data"), tmp, "SELECT card_number_encrypted FROM credit_cards");
        return found.length ? found : false;
      }, { timeout: 20000, label: "Ardia's Web Data to hold the imported card" });
      if (decryptChromium(cards[0].card_number_encrypted)?.toString("utf8") !== fixtures.cardNumber) throw new Error("stored card doesn't match the source");
      return { written, cookies: cookies.length, cards: cards.length };
    });

    await t.check("private and invalid targets lose the token without writing", async () => {
      const again = await importJob(shell, "chrome", "Default", ["cookies"]);
      const refused = await writeImported(shell, again.result.vaultToken, "incognito:w1@", ["cookies"]);
      const after = await writeImported(shell, again.result.vaultToken, "", ["cookies"]);
      if (refused.code !== "ERR_PROFILE_PRIVATE" || after.code !== "expired") throw new Error(JSON.stringify({ refused, after }));
      return { refused: refused.code };
    });

    await t.check("a Firefox import reads the session store and skips container cookies", async () => {
      const firefox = await importJob(shell, "firefox", "followup.default", ["tabs", "cookies"]);
      const result = firefox.result;
      if (firefox.type !== "done" || result.tabs.length !== 1 || result.cookieCount !== 1 || !result.warnings.some((w) => w.code === "skipped")) throw new Error(JSON.stringify(firefox));
      if (leaks(firefox, fixtures.secrets).length) throw new Error("a Firefox cookie value reached the renderer");
      const written = await writeImported(shell, result.vaultToken, "", ["cookies"]);
      if (written.cookies !== 1) throw new Error(JSON.stringify(written));
      return { tabs: result.tabs.length, cookies: written.cookies };
    });

    await t.check("sources are unchanged and no scratch copy is left behind", async () => {
      const after = await digestTree(home);
      const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((path) => before[path] !== after[path]);
      if (changed.length) throw new Error(`source files changed: ${changed.join(", ")}`);
      const left = await leftoverImportCopies(tmp);
      if (left.length) throw new Error(`left ${left.join(", ")}`);
      return true;
    });
  },
};

export const i110 = {
  id: "I110",
  issue: 110,
  title: "Import Firefox saved passwords (NSS key4.db), with and without a primary password",
  deadline: 300000,
  manual: [
    { name: "A real Firefox profile", steps: ["Copy a current Firefox profile with saved logins into a scratch HOME and import Passwords.", "The count matches about:logins; with a primary password set, the Done step says the passwords are locked."], reason: "fixtures come from the system NSS; a real Firefox profile proves its own NSS version" },
  ],
  async run(t) {
    if (!(await available("/usr/bin/certutil"))) {
      await t.check("NSS certutil is installed", () => { throw new Error("certutil is missing; install nss tools to generate key4.db fixtures"); });
      return;
    }
    const { scratch, home, tmp } = await prepare(t, "firefox-passwords");
    const root = join(home, ".mozilla", "firefox");
    const logins = [{ hostname: "https://nss-one.ardia.test", username: "nina", password: fixtureSecret("nss-") }, { hostname: "https://nss-two.ardia.test", username: "omar", password: fixtureSecret("nss-") }];
    const primary = fixtureSecret("primary-");
    await nssProfile(join(root, "followup.default"), "", logins);
    await nssProfile(join(root, "primary.default"), primary, logins);
    const { appendFile } = await import("node:fs/promises");
    await appendFile(join(root, "profiles.ini"), "\n[Profile1]\nName=primary\nIsRelative=1\nPath=primary.default\n");
    const secrets = logins.map((l) => l.password);
    const { shell } = await startBrowser(t, { name: "firefox-passwords", scratch, env: { TMPDIR: tmp } });

    await t.check("a profile without a primary password imports and saves its passwords", async () => {
      await unlock(shell, "firefox");
      const reply = await importJob(shell, "firefox", "followup.default", ["passwords"]);
      if (reply.type !== "done" || reply.result.passwords?.count !== 2 || leaks(reply, secrets).length) throw new Error(JSON.stringify(reply));
      const written = await writePasswords(shell, reply.result.passwords.token, "");
      if (written.added !== 2) throw new Error(JSON.stringify(written));
      const stored = await until(async () => {
        const found = (await savedLogins(join(scratch, "Default", "Login Data"), tmp)).filter((row) => row.origin.includes("nss-"));
        return found.length === 2 ? found : false;
      }, { timeout: 20000, label: "the Firefox passwords in Ardia's Login Data" });
      return { stored: stored.length };
    }, { critical: true });

    await t.check("a primary-password profile reports locked until the right password unlocks it", async () => {
      const locked = await importJob(shell, "firefox", "primary.default", ["passwords"]);
      if (!locked.result.failed.includes("passwords") || locked.result.warnings[0]?.code !== "locked" || locked.result.passwords) throw new Error(JSON.stringify(locked));
      await unlock(shell, "firefox", "wrong password");
      const wrong = await importJob(shell, "firefox", "primary.default", ["passwords"]);
      if (!wrong.result.failed.includes("passwords") || wrong.result.passwords) throw new Error(JSON.stringify(wrong));
      await unlock(shell, "firefox", primary);
      const right = await importJob(shell, "firefox", "primary.default", ["passwords"]);
      if (right.result.passwords?.count !== 2 || leaks(right, [...secrets, primary]).length) throw new Error(JSON.stringify(right));
      return { locked: locked.result.warnings[0].code, opened: right.result.passwords.count };
    });
  },
};

export const i109 = {
  id: "I109",
  issue: 109,
  title: "Import keyring-protected (v11) Chromium passwords through Secret Service with consent",
  deadline: 300000,
  manual: [
    { name: "GNOME Keyring and KWallet", steps: ["Import passwords from a Chrome profile that uses gnome-libsecret, then one that uses KWallet.", "The import window asks to unlock; the system unlock prompt appears; allowing it imports the passwords, cancelling it imports none and shows the locked note."], reason: "GNOME Keyring is automated in I109K; KWallet's first wallet needs its own first-use wizard" },
  ],
  async run(t) {
    if (!(await available("/usr/bin/dbus-daemon"))) {
      await t.check("dbus-daemon is installed", () => { throw new Error("dbus-daemon is missing"); });
      return;
    }
    const { scratch, home, tmp, fixtures } = await prepare(t, "keyring", { keyring: true });
    const keyring = await startFakeKeyring(await t.tempDir("bus"), {
      locked: true,
      prompts: ["dismiss", "accept"],
      items: [{ attributes: { application: "chrome", "xdg:schema": "chrome_libsecret_os_crypt_password_v2" }, secret: KEYRING_SECRET }],
    });
    try {
      const { shell } = await startBrowser(t, { name: "keyring", scratch, env: { TMPDIR: tmp, DBUS_SESSION_BUS_ADDRESS: keyring.address } });
      await t.check("discovery marks Chrome as needing its Safe Storage key without unlocking anything", async () => {
        const started = Date.now();
        const list = (await shell.invoke("ArdiaImport.listBrowsers", { args: [] }, { timeout: 45000 })).value ?? [];
        const elapsedMs = Date.now() - started;
        const chrome = list.find((b) => b.id === "chrome");
        if (chrome?.needsKeychain !== true || chrome.keychainService !== "Chrome Safe Storage") throw new Error(JSON.stringify({ chrome, elapsedMs }));
        return { needsKeychain: chrome.needsKeychain, elapsedMs };
      }, { critical: true });
      await t.check("without consent, v11 passwords stay locked and nothing is imported", async () => {
        const reply = await importJob(shell, "chrome", "Default", ["passwords"]);
        if (!reply.result.failed.includes("passwords") || reply.result.passwords) throw new Error(JSON.stringify(reply));
        return reply.result.warnings;
      });
      await t.check("a dismissed keyring prompt reports denied and imports nothing", async () => {
        const denied = await unlock(shell, "chrome");
        if (denied.type !== "failed" || denied.code !== "denied") throw new Error(JSON.stringify(denied));
        const reply = await importJob(shell, "chrome", "Default", ["passwords"]);
        if (reply.result.passwords) throw new Error("passwords were imported after a denied prompt");
        return { code: denied.code };
      });
      await t.check("an allowed prompt unlocks the key and the v11 passwords import into Ardia's store", async () => {
        const unlocked = await unlock(shell, "chrome");
        if (unlocked.type !== "unlocked") throw new Error(JSON.stringify(unlocked));
        const reply = await importJob(shell, "chrome", "Default", ["passwords"]);
        if (reply.result.passwords?.count !== 2 || leaks(reply, fixtures.keyringPasswords).length) throw new Error(JSON.stringify(reply));
        const written = await writePasswords(shell, reply.result.passwords.token, "");
        if (written.added !== 2) throw new Error(JSON.stringify(written));
        const stored = await until(async () => {
          const found = (await savedLogins(join(scratch, "Default", "Login Data"), tmp)).filter((row) => row.origin.includes("ring-"));
          return found.length === 2 ? found : false;
        }, { timeout: 20000, label: "the keyring passwords in Ardia's Login Data" });
        if (stored.some((row) => !fixtures.keyringPasswords.includes(row.password))) throw new Error("stored passwords don't match");
        await shell.invoke("ArdiaImport.forgetUnlockedKeys", { args: [] });
        const forgotten = await importJob(shell, "chrome", "Default", ["passwords"]);
        if (forgotten.result.passwords) throw new Error("the key outlived forgetUnlockedKeys");
        return { stored: stored.length };
      });
    } finally {
      await keyring.stop();
    }
  },
};
